/**
 * Standard-conversation support: keep one ChatGPT conversation alive across turns and capture the
 * files ChatGPT produces in it.
 *
 * Why this exists
 * ---------------
 * The published bridge runs every turn on a fresh Temporary Chat (`?temporary-chat=true`). That is
 * deliberate — it keeps DSH turns from polluting account history — but it means ChatGPT forgets
 * everything between turns, including any document it was asked to maintain. A workflow like
 * "let ChatGPT keep updating one Markdown file, download it when it's ready" is impossible there:
 * the file is gone before the next turn starts.
 *
 * This module adds an opt-in `standard` conversation: one normal chat per DSH thread, reused for
 * every turn of that thread, with Playwright downloads captured to a local directory.
 *
 * Scope and safety
 * ----------------
 * - Only `browserHost: managed-chrome` is supported. The managed browser is ours, so holding one of
 *   its tabs open between turns is safe. The launcher host has its own retained-conversation
 *   lifecycle and must not be double-managed here.
 * - The tab map is in-memory and bounded; a persisted `conversations.json` only records the URL so
 *   a restart can re-attach instead of silently starting a second conversation.
 * - Failures never corrupt a turn: a missing/unreachable stored conversation degrades to a fresh
 *   chat, exactly like `temporary` mode.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { BrowserContext, Page } from "playwright-core";
import { extractMarkdownFiles } from "./answer-files";

/** A normal (non-temporary) ChatGPT conversation. */
export const CHATGPT_STANDARD_CHAT_URL = "https://chatgpt.com/";

const MAX_RECORDED_CONVERSATIONS = 256;
const CONVERSATION_TTL_MS = 30 * 24 * 60 * 60_000;

export interface RecordedConversation {
  /** DSH thread id this ChatGPT conversation belongs to. */
  threadId: string;
  /** Canonical conversation URL, e.g. https://chatgpt.com/c/<id>. */
  url: string;
  updatedAt: number;
}

interface ConversationStateFile {
  version: 1;
  conversations: RecordedConversation[];
}

/** Stable key for one DSH thread's standard conversation. */
export function conversationSlotKey(threadId: string, namespace: string): string {
  return createHash("sha256").update(`${namespace}\u0000${threadId}`).digest("hex").slice(0, 32);
}

/**
 * Persisted thread → conversation-URL map. Stores only the URL: the live tab stays in
 * {@link StandardConversationBroker} so a crash can never leave a dangling page reference on disk.
 */
export class ConversationStateStore {
  private loaded: ConversationStateFile = { version: 1, conversations: [] };

  constructor(private readonly path: string | undefined) {
    this.load();
  }

  private load(): void {
    if (!this.path || !existsSync(this.path)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as Partial<ConversationStateFile>;
      if (parsed?.version !== 1 || !Array.isArray(parsed.conversations)) return;
      const now = Date.now();
      this.loaded = {
        version: 1,
        conversations: parsed.conversations.filter((entry): entry is RecordedConversation => (
          entry !== null && typeof entry === "object"
          && typeof entry.threadId === "string" && entry.threadId.length > 0
          && typeof entry.url === "string" && /^https:\/\/chatgpt\.com\/c\/[\w-]+$/.test(entry.url)
          && typeof entry.updatedAt === "number" && now - entry.updatedAt < CONVERSATION_TTL_MS
        )),
      };
    } catch {
      this.loaded = { version: 1, conversations: [] };
    }
  }

  private flush(): void {
    if (!this.path) return;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const pending = `${this.path}.tmp`;
      const trimmed = this.loaded.conversations
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_RECORDED_CONVERSATIONS);
      this.loaded = { version: 1, conversations: trimmed };
      // Same-directory rename keeps the swap atomic on the same volume.
      writeFileSync(pending, `${JSON.stringify(this.loaded, null, 2)}\n`, { mode: 0o600 });
      renameSync(pending, this.path);
    } catch { /* recording is advisory; never fail a turn over it */ }
  }

  get(threadId: string): RecordedConversation | undefined {
    return this.loaded.conversations.find(entry => entry.threadId === threadId);
  }

  record(threadId: string, url: string): void {
    const rest = this.loaded.conversations.filter(entry => entry.threadId !== threadId);
    rest.push({ threadId, url, updatedAt: Date.now() });
    this.loaded = { version: 1, conversations: rest };
    this.flush();
  }

  forget(threadId: string): void {
    const rest = this.loaded.conversations.filter(entry => entry.threadId !== threadId);
    if (rest.length === this.loaded.conversations.length) return;
    this.loaded = { version: 1, conversations: rest };
    this.flush();
  }
}

/** One live conversation tab plus the files captured from it this session. */
interface ConversationSlot {
  page: Page;
  threadId: string;
  url: string;
  /** Absolute paths of files downloaded during turns on this slot, most recent last. */
  downloads: string[];
  /** Conversation id of the last completed turn (for backend-api file downloads). */
  lastConversationId?: string;
  /** Assistant message id of the last completed turn. */
  lastMessageId?: string;
  lastUsedAt: number;
}

export interface CapturedDownload {
  fileName: string;
  absolutePath: string;
  bytes: number;
  capturedAt: number;
}

const CONVERSATION_URL_PATTERN = /^https:\/\/chatgpt\.com\/(?:c\/[\w-]+|)(?:\?.*)?$/;

/** True when the page sits on a normal ChatGPT conversation (not a Temporary Chat). */
export function isStandardConversationUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.origin !== "https://chatgpt.com") return false;
    if (url.searchParams.get("temporary-chat") === "true") return false;
    return url.pathname === "/" || /^\/c\/[\w-]+$/.test(url.pathname);
  } catch {
    return false;
  }
}

/**
 * Owns the managed-browser tabs used by `standard` conversation mode, one per DSH thread, and
 * captures every download Playwright sees on those pages.
 *
 * A single broker instance lives on the browser worker, so the tab map survives across turns even
 * though the worker creates a fresh page object for `temporary` mode.
 */
export class StandardConversationBroker {
  private readonly slots = new Map<string, ConversationSlot>();
  private downloadListenerInstalled = false;

  constructor(
    private readonly options: {
      downloadDirectory: string;
      statePath?: string;
      log?: (message: string) => void;
    },
  ) {
    this.store = new ConversationStateStore(options.statePath);
    mkdirSync(this.options.downloadDirectory, { recursive: true });
  }

  readonly store: ConversationStateStore;

  /** Attach download capture once per context; safe to call for every turn. */
  ensureDownloadCapture(context: BrowserContext): void {
    if (this.downloadListenerInstalled) return;
    this.downloadListenerInstalled = true;
    context.on("page", page => this.watchPageDownloads(page));
    for (const page of context.pages()) this.watchPageDownloads(page);
  }

  private watchPageDownloads(page: Page): void {
    const handler = async (download: import("playwright-core").Download) => {
      const fileName = sanitizeDownloadName(download.suggestedFilename());
      const slot = this.slotForPage(page);
      try {
        const absolutePath = join(
          this.options.downloadDirectory,
          slot ? `${Date.now()}-${slot.threadId.slice(0, 8)}-${fileName}` : `${Date.now()}-${fileName}`,
        );
        await download.saveAs(absolutePath);
        const bytes = statSync(absolutePath).size;
        if (slot) slot.downloads.push(absolutePath);
        this.options.log?.(
          `chatgpt-web: captured download ${fileName} (${bytes.toLocaleString("en-US")} bytes) -> ${absolutePath}`,
        );
      } catch (error) {
        this.options.log?.(
          `chatgpt-web: failed to save download ${fileName}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };
    page.on("download", (download) => { void handler(download); });
  }

  private slotForPage(page: Page): ConversationSlot | undefined {
    for (const slot of this.slots.values()) if (slot.page === page) return slot;
    return undefined;
  }

  /**
   * Reuse the live tab for this thread, or open one. Reattaches to a recorded conversation URL when
   * the tab is gone (browser restart) so the maintained document is not lost.
   */
  async acquire(
    context: BrowserContext,
    threadId: string,
    namespace: string,
  ): Promise<{ page: Page; reused: boolean; conversationUrl?: string }> {
    const key = conversationSlotKey(threadId, namespace);
    const existing = this.slots.get(key);
    if (existing && !existing.page.isClosed()) {
      existing.lastUsedAt = Date.now();
      return { page: existing.page, reused: true, conversationUrl: existing.url };
    }
    if (existing) this.slots.delete(key);

    const recorded = this.store.get(threadId);
    const page = await context.newPage();
    this.ensureDownloadCapture(context);
    let url = recorded?.url;
    if (url) {
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      } catch {
        // Recorded conversation is unreachable (deleted, different account): fall back to a new one.
        url = undefined;
      }
    }
    this.slots.set(key, {
      page,
      threadId,
      url: url ?? "",
      downloads: [],
      lastUsedAt: Date.now(),
    });
    this.options.log?.(`chatgpt-web: standard conversation tab opened for thread ${threadId.slice(0, 8)}${url ? ` (reattached ${url})` : ""}`);
    return { page, reused: false, conversationUrl: url };
  }

  /**
   * Record the conversation URL ChatGPT navigated to once a turn produced content, so the next turn
   * (or a restarted process) can reattach to the same conversation. Also remembers the message id
   * of the finished assistant turn, which is the second half of the key needed to hit ChatGPT's
   * file-download endpoint for anything that turn produced.
   */
  noteConversationUrl(page: Page, threadId: string, sourceTurnId?: string): string | undefined {
    const current = page.url();
    if (!/^https:\/\/chatgpt\.com\/c\/[\w-]+/.test(current)) return undefined;
    const canonical = current.split("?")[0];
    const conversationId = canonical.split("/c/")[1] ?? "";
    if (sourceTurnId) {
      const slot = [...this.slots.entries()].find(([, s]) => s.page === page)?.[1];
      if (slot) {
        slot.lastConversationId = conversationId;
        slot.lastMessageId = sourceTurnId;
      }
    }
    const key = [...this.slots.entries()].find(([, slot]) => slot.page === page)?.[0];
    if (key) {
      const slot = this.slots.get(key)!;
      slot.url = canonical;
    }
    this.store.record(threadId, canonical);
    return canonical;
  }

  /**
   * Build the authenticated URL that downloads a file from ChatGPT's interpreter sandbox.
   *
   * ChatGPT renders generated files as `sandbox:/mnt/data/<name>` anchors; the real download goes
   * through `/backend-api/conversation/{conversationId}/interpreter/download?message_id=...&sandbox_path=...`
   * (this is the same endpoint the site's own download button hits). The page's session cookies
   * authorise it, so fetching it **from inside the page** reuses the logged-in session without
   * touching tokens.
   *
   * Returns null when the turn produced no sandbox links.
   */
  async extractSandboxFilePaths(page: Page, options: { retries?: number; waitMs?: number } = {}): Promise<string[]> {
    // 刚完成渲染时 DOM 可能还没把消息挂上（SPA 过渡 / "无法加载此回复" 瞬态）。
    // 轮询窗口内重试；找到文件链接立即返回，窗口耗尽返回空（属正常：多数轮没有文件）。
    const retries = options.retries ?? 5;
    const waitMs = options.waitMs ?? 1200;
    let lastPaths: string[] = [];
    for (let attempt = 0; attempt <= retries; attempt++) {
      lastPaths = await this.extractSandboxFilePathsOnce(page);
      if (lastPaths.length > 0) return lastPaths;
      if (attempt < retries) await page.waitForTimeout(waitMs).catch(() => {});
    }
    return lastPaths;
  }

  private async extractSandboxFilePathsOnce(page: Page): Promise<string[]> {
    // 文件链接可能在主文档，也可能在代码执行的 iframe（"DIL execution sandbox"）里。
    const allPaths: string[] = [];
    for (const frame of page.frames()) {
      try {
        const found = await this.scanFrameForSandboxPaths(frame);
        allPaths.push(...found);
      } catch { /* frame may be cross-origin or not ready */ }
    }
    return [...new Set(allPaths)];
  }

  private async scanFrameForSandboxPaths(frame: import("playwright-core").Frame): Promise<string[]> {
    const paths = await frame.evaluate(() => {
      const found: string[] = [];
      const scan = (root: ParentNode) => {
        for (const anchor of root.querySelectorAll("a[href]")) {
          const href = anchor.getAttribute("href") ?? "";
          const match = /^sandbox:(\/mnt\/data\/.+)$/i.exec(href);
          if (match) found.push(match[1]);
        }
        // ChatGPT also embeds file links in code-run output blocks that are not anchors.
        for (const el of root.querySelectorAll("[data-sandbox-path]")) {
          const value = el.getAttribute("data-sandbox-path");
          if (value) found.push(value);
        }
      };
      scan(document);
      return [...new Set(found)];
    }).catch(() => [] as string[]);
    return paths;
  }

  /**
   * Download every listed sandbox file for the conversation currently loaded on the page.
   * Fetches through `page.evaluate(fetch)` so the request carries the logged-in cookies.
   */
  async downloadSandboxFiles(
    page: Page,
    sandboxPaths: string[],
    threadId: string,
  ): Promise<CapturedDownload[]> {
    if (sandboxPaths.length === 0) return [];
    const conversationUrl = page.url();
    const conversationId = /^https:\/\/chatgpt\.com\/c\/([\w-]+)/.exec(conversationUrl)?.[1];
    if (!conversationId) return [];
    const written: CapturedDownload[] = [];
    for (const sandboxPath of sandboxPaths) {
      // The model sometimes quotes a filename from its own answer; only accept well-formed paths.
      if (!/^\/mnt\/data\/[\w.\- ]+$/.test(sandboxPath)) continue;
      const fileName = sandboxPath.split("/").pop() ?? "download";
      const endpoint = `https://chatgpt.com/backend-api/conversation/${conversationId}/interpreter/download?sandbox_path=${encodeURIComponent(sandboxPath)}`;
      try {
        const result = await page.evaluate(async (url: string) => {
          const response = await fetch(url, { credentials: "include" });
          if (!response.ok) return { ok: false as const, status: response.status };
          const blob = await response.blob();
          const buffer = new Uint8Array(await blob.arrayBuffer());
          return { ok: true as const, bytes: Array.from(buffer) };
        }, endpoint);
        if (!result.ok) {
          this.options.log?.(`chatgpt-web: sandbox download ${fileName} -> HTTP ${result.status}`);
          continue;
        }
        const target = join(
          this.options.downloadDirectory,
          `${Date.now()}-${threadId.slice(0, 8)}-${fileName}`,
        );
        mkdirSync(this.options.downloadDirectory, { recursive: true });
        writeFileSync(target, Buffer.from(result.bytes));
        const bytes = statSync(target).size;
        written.push({ fileName, absolutePath: target, bytes, capturedAt: Date.now() });
        this.options.log?.(`chatgpt-web: downloaded ${fileName} (${bytes} bytes) via backend-api -> ${target}`);
      } catch (error) {
        this.options.log?.(
          `chatgpt-web: sandbox download failed for ${fileName}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return written;
  }

  /** Files captured during this session for one thread, newest first. */
  downloadsFor(threadId: string): CapturedDownload[] {
    const slot = [...this.slots.values()].find(entry => entry.threadId === threadId);
    if (!slot) return [];
    return slot.downloads
      .slice()
      .reverse()
      .flatMap((absolutePath) => {
        try {
          return [{
            fileName: absolutePath.split(/[\\/]/).pop() ?? "download",
            absolutePath,
            bytes: statSync(absolutePath).size,
            capturedAt: statSync(absolutePath).mtimeMs,
          }];
        } catch {
          return [];
        }
      });
  }

  /**
   * Pull every file the finished assistant turn links to.
   *
   * ChatGPT does not download files on its own: it renders a link (usually a `sandbox:/mnt/data/...`
   * anchor) and waits for a click. Doing that click ourselves is what turns "ChatGPT maintained a
   * document" into "the file is on disk". Download events are captured by the listener installed in
   * {@link ensureDownloadCapture}, so this method only has to trigger them.
   *
   * Returns the number of links clicked. Never throws: a turn that produced no files is normal.
   */
  async captureTurnDownloads(page: Page, turnStartMs: number): Promise<number> {
    const candidates = await page.evaluate(() => {
      const anchors = [...document.querySelectorAll<HTMLAnchorElement>("a[href]")];
      return anchors
        .filter(anchor => {
          const href = anchor.getAttribute("href") ?? "";
          // ChatGPT file links come in two shapes: a `sandbox:`/`/mnt/data` anchor, or a direct
          // download endpoint. Everything else (citations, in-page anchors) is ignored.
          const looksLikeFile = /^sandbox:/i.test(href)
            || /\/mnt\/data\//.test(href)
            || /\/backend-api\/(?:files|content)/.test(href)
            || anchor.hasAttribute("download");
          if (!looksLikeFile) return false;
          const rect = anchor.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })
        .map(anchor => ({
          href: anchor.getAttribute("href") ?? "",
          text: (anchor.textContent ?? "").trim().slice(0, 120),
        }));
      // Deduplicate: the same file is often rendered twice (inline + action row).
      const seen = new Set<string>();
      return anchors.length > 0
        ? candidates.filter(c => (seen.has(c.href) ? false : (seen.add(c.href), true)))
        : [];
    }).catch(() => [] as Array<{ href: string; text: string }>);

    if (candidates.length === 0) return 0;
    let clicked = 0;
    for (const candidate of candidates) {
      try {
        // Prefer a real click so Playwright raises `download`; fall back to navigating the anchor,
        // which still surfaces Content-Disposition responses as downloads.
        const locator = page.locator(`a[href="${candidate.href.replace(/"/g, '\\"')}"]`).first();
        if (await locator.count() > 0) {
          await locator.click({ timeout: 10_000, noWaitAfter: true });
        } else {
          await page.goto(candidate.href, { waitUntil: "domcontentloaded", timeout: 30_000 });
        }
        clicked += 1;
        this.options.log?.(`chatgpt-web: requested download "${candidate.text || candidate.href}"`);
        // Give the download a moment to start before clicking the next one.
        await page.waitForTimeout(600).catch(() => {});
      } catch (error) {
        this.options.log?.(
          `chatgpt-web: download click failed for "${candidate.text || candidate.href}": `
          + `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (clicked > 0) {
      // Let in-flight downloads finish saving before the turn returns.
      await page.waitForTimeout(1_200).catch(() => {});
    }
    this.options.log?.(`chatgpt-web: turn finished with ${clicked} download link(s) for turn started at ${turnStartMs}`);
    return clicked;
  }

  /**
   * 把模型写进回答里的 markdown 存成文件。
   *
   * 免费 Luna 账号只能间歇性调用 ChatGPT 的文件生成工具，工具不可用时模型仍会把整份文档
   * 写进回答。文本既然已经拿到，本地写盘就能交付文件，不依赖 OpenAI 侧可用性。
   */
  saveMarkdownFromAnswer(answer: string, threadId: string, turnName: string): CapturedDownload[] {
    const written: CapturedDownload[] = [];
    for (const file of extractMarkdownFiles(answer, turnName)) {
      const target = join(
        this.options.downloadDirectory,
        `${Date.now()}-${threadId.slice(0, 8)}-${file.fileName}`,
      );
      try {
        mkdirSync(this.options.downloadDirectory, { recursive: true });
        writeFileSync(target, file.body, "utf8");
        const bytes = statSync(target).size;
        written.push({ fileName: file.fileName, absolutePath: target, bytes, capturedAt: Date.now() });
        this.options.log?.(`chatgpt-web: saved ${file.fileName} from answer (${bytes} bytes) -> ${target}`);
      } catch (error) {
        this.options.log?.(`chatgpt-web: could not save ${file.fileName}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return written;
  }

  /** Drop one thread's slot. The tab is closed; the recorded URL is kept unless `forget`. */
  async release(threadId: string, options: { forget?: boolean } = {}): Promise<void> {
    const entries = [...this.slots.entries()].filter(([, slot]) => slot.threadId === threadId);
    for (const [key, slot] of entries) {
      this.slots.delete(key);
      await slot.page.close().catch(() => {});
    }
    if (options.forget) this.store.forget(threadId);
  }

  async closeAll(): Promise<void> {
    for (const [key, slot] of [...this.slots.entries()]) {
      this.slots.delete(key);
      await slot.page.close().catch(() => {});
    }
  }
}

/** Strip path separators and control characters so a suggested filename is safe on disk. */
function sanitizeDownloadName(name: string): string {
  const base = (name || "download").split(/[\\/]/).pop() ?? "download";
  const cleaned = base.replace(/[\u0000-\u001f<>:"|?*]/g, "_").trim();
  return cleaned.length > 0 ? cleaned.slice(0, 150) : "download";
}

/**
 * Absolute directory ChatGPT downloads are written to. Defaults to `<configDir>/downloads`, and is
 * created lazily so a fresh install needs no extra setup step.
 */
export function resolveDownloadDirectory(configured: string | undefined, configDir: string): string {
  const target = configured && configured.trim().length > 0
    ? resolve(configured)
    : join(configDir, "downloads");
  mkdirSync(target, { recursive: true });
  return target;
}

/** Remove the recorded conversation state file. Used by uninstall/tests. */
export function clearConversationState(path: string | undefined): void {
  if (!path) return;
  try { rmSync(path, { force: true }); } catch { /* best effort */ }
}
