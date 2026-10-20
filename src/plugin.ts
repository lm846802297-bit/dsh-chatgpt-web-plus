import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getConfigPath } from "./config";

export interface CordisContext {
  effect?: (cb: () => void | Promise<void> | (() => void) | (() => Promise<void>)) => void;
  logger?: (name: string) => {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
    debug(msg: string): void;
  };
}

export const name = "dsh-chatgpt-web";
export const inject = [];

export interface ChatGPTWebPluginConfig {
  /** Host to bind or check for health (default: 127.0.0.1). */
  host?: string;
  /** Port the sidecar listens on (default: 17841). */
  port?: number;
  /** Automatically start the sidecar daemon if not running (default: true). */
  autoStart?: boolean;
  /** Maximum milliseconds to wait for the sidecar to report ready (default: 30000). */
  readyTimeoutMs?: number;
  /** Explicit path to the bun executable (optional). */
  bunPath?: string;
}

import { pathToFileURL } from "node:url";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Minimum Node major the sidecar can run on (package.json wants >=22.19.0).
 * Keep this permissive: anything modern enough to run the bundled ESM CLI is fine.
 */
const MIN_NODE_MAJOR = 20;

interface Launcher {
  cmd: string;
  args: string[];
  /** Extra environment variables the child needs (e.g. ELECTRON_RUN_AS_NODE). */
  env: Record<string, string>;
}

/**
 * True when this module is running inside an Electron packager binary.
 *
 * DSH Desktop runs every plugin inside its own Electron process, so
 * `process.execPath` is `DSH Desktop.exe` — NOT node. Spawning it with
 * `[libCliPath, "serve"]` merely relaunches the desktop app, which ignores the
 * arguments and exits, leaving port 17841 forever closed. That was BUG-6.
 */
function isElectronHost(): boolean {
  return typeof process.versions?.electron === "string";
}

/** Returns the major version of a real node binary, or undefined if unusable. */
function probeNodeMajor(bin: string): number | undefined {
  try {
    const result = spawnSync(bin, ["--version"], {
      encoding: "utf8",
      timeout: 4000,
      windowsHide: true,
    });
    if (result.status !== 0 || typeof result.stdout !== "string") return undefined;
    const match = /^v(\d+)\.\d+\.\d+/.exec(result.stdout.trim());
    return match ? Number(match[1]) : undefined;
  } catch {
    return undefined;
  }
}

function candidateNodeBinaries(): string[] {
  const candidates: string[] = [];
  const push = (candidate: string | undefined | null) => {
    if (!candidate || candidates.includes(candidate)) return;
    candidates.push(candidate);
  };

  // 1. Explicit override wins.
  push(process.env.DSH_CHATGPT_WEB_NODE);

  // 2. PATH — how a plain `node cli.js serve` would have resolved.
  const exts = process.platform === "win32" ? [".exe", ""] : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) push(join(dir, `node${ext}`));
  }

  // 3. A non-Electron execPath is already a real node binary.
  if (!isElectronHost()) push(process.execPath);

  if (process.platform === "win32") {
    // 4. Standard installs, which are often missing from a packaged app's PATH.
    push(join(process.env.ProgramFiles ?? "C:\\Program Files", "nodejs", "node.exe"));
    push(join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "nodejs", "node.exe"));
    push(join(process.env.LOCALAPPDATA ?? "", "Programs", "nodejs", "node.exe"));
    push(join(process.env.LOCALAPPDATA ?? "", "Volta", "bin", "node.exe"));
    // nvm-windows: NVM_SYMLINK is the stable "current" junction.
    push(process.env.NVM_SYMLINK ? join(process.env.NVM_SYMLINK, "node.exe") : null);
    push(join(homedir(), "scoop", "apps", "nodejs", "current", "node.exe"));
  } else {
    push("/usr/local/bin/node");
    push("/opt/homebrew/bin/node");
    push("/usr/bin/node");
  }

  return candidates;
}

/**
 * Resolve an executable that can actually run `lib/cli.js`.
 *
 * Preference order: explicit override → a real node on PATH → a well-known
 * install location → the Electron binary re-executed via ELECTRON_RUN_AS_NODE
 * (the same last-resort trick DSH's own tooling uses).
 */
function resolveNodeRuntime(): { cmd: string; env: Record<string, string> } {
  for (const candidate of candidateNodeBinaries()) {
    if (!existsSync(candidate)) continue;
    const major = probeNodeMajor(candidate);
    if (major !== undefined && major >= MIN_NODE_MAJOR) {
      return { cmd: candidate, env: {} };
    }
  }

  if (isElectronHost()) {
    // Electron embeds Node; this flag makes the app binary behave like `node`.
    return { cmd: process.execPath, env: { ELECTRON_RUN_AS_NODE: "1" } };
  }

  return { cmd: process.execPath, env: {} };
}

function resolveLauncher(customBunPath?: string): Launcher {
  const node = resolveNodeRuntime();
  const libCliPath = resolve(ROOT_DIR, "lib", "cli.js");
  if (existsSync(libCliPath)) {
    return {
      cmd: node.cmd,
      args: [libCliPath, "serve"],
      env: node.env,
    };
  }

  // Development fallback: check for bun or tsx
  if (customBunPath && existsSync(customBunPath)) {
    return { cmd: customBunPath, args: ["run", "src/cli.ts", "serve"] };
  }

  const winBun = join(homedir(), ".bun", "bin", "bun.exe");
  if (existsSync(winBun)) {
    return { cmd: winBun, args: ["run", "src/cli.ts", "serve"] };
  }

  // Portable Node ESM resolution for tsx
  try {
    const tsxUrl = import.meta.resolve("tsx");
    return {
      cmd: node.cmd,
      args: ["--import", tsxUrl, "src/cli.ts", "serve"],
      env: node.env,
    };
  } catch {
    // tsx not resolvable via standard ESM package resolution
  }

  const localTsx = resolve(ROOT_DIR, "node_modules/tsx/dist/esm/index.mjs");
  if (existsSync(localTsx)) {
    return {
      cmd: node.cmd,
      args: ["--import", pathToFileURL(localTsx).href, "src/cli.ts", "serve"],
      env: node.env,
    };
  }

  const siblingTsx = resolve(ROOT_DIR, "../deepseek-harness/node_modules/tsx/dist/esm/index.mjs");
  if (existsSync(siblingTsx)) {
    return {
      cmd: node.cmd,
      args: ["--import", pathToFileURL(siblingTsx).href, "src/cli.ts", "serve"],
      env: node.env,
    };
  }

  return { cmd: node.cmd, args: ["src/cli.ts", "serve"], env: node.env };
}

async function isSidecarHealthy(host: string, port: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`http://${host}:${port}/healthz`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return false;
    const body = (await res.json()) as { status?: string };
    return body.status === "ok";
  } catch {
    return false;
  }
}

export function apply(ctx: CordisContext, config: ChatGPTWebPluginConfig = {}): void {
  const host = config.host || "127.0.0.1";
  const port = config.port || 17841;
  const autoStart = config.autoStart !== false;
  const readyTimeoutMs = config.readyTimeoutMs || 30_000;
  const logger = typeof ctx.logger === "function" ? ctx.logger("chatgpt-web") : console;

  let spawnedProcess: ChildProcess | undefined;
  /** Set while the plugin is being torn down, so exits do not trigger restarts. */
  let stopping = false;
  /** Consecutive failed starts, used to pick a backoff step. */
  let failureCount = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  /** Backoff schedule for restarting a sidecar that died (BUG-7). */
  const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

  /**
   * Restart the sidecar after it died, unless we are shutting down.
   *
   * The original code only ever started the sidecar once per plugin load and
   * merely logged the exit, so a crash (or a user killing it) meant the port
   * stayed closed until DSH Desktop itself was restarted.
   */
  const scheduleRestart = (reason: string) => {
    if (stopping || !autoStart || retryTimer) return;

    if (failureCount >= RETRY_DELAYS_MS.length) {
      logger.error(
        `[dsh-chatgpt-web] Sidecar ${reason}; giving up after ${failureCount} failed restart attempts. ` +
          `Restart DSH Desktop or run 'node lib/cli.js serve' in ${ROOT_DIR}.`,
      );
      return;
    }

    const delay = RETRY_DELAYS_MS[failureCount];
    failureCount += 1;
    logger.warn(
      `[dsh-chatgpt-web] Sidecar ${reason}; restarting in ${delay}ms ` +
        `(attempt ${failureCount}/${RETRY_DELAYS_MS.length})`,
    );

    const timer = setTimeout(() => {
      retryTimer = undefined;
      void startDaemon();
    }, delay);
    // Do not hold the host process open just for a retry timer.
    if (typeof (timer as { unref?: () => void }).unref === "function") {
      (timer as { unref: () => void }).unref();
    }
    retryTimer = timer;
  };

  const startDaemon = async () => {
    if (stopping) return;

    const alreadyHealthy = await isSidecarHealthy(host, port);
    if (alreadyHealthy) {
      if (failureCount > 0) {
        logger.info(`[dsh-chatgpt-web] Sidecar is healthy again at http://${host}:${port}/v1`);
        failureCount = 0;
      } else {
        logger.info(`[dsh-chatgpt-web] Sidecar already running and healthy at http://${host}:${port}/v1`);
      }
      return;
    }

    if (!autoStart) {
      logger.warn(`[dsh-chatgpt-web] Sidecar is offline and autoStart is false. Start it manually with 'bun run src/cli.ts serve'`);
      return;
    }

    const launcher = resolveLauncher(config.bunPath);
    // Say so explicitly: the fallback logs the very same "DSH Desktop.exe" path that
    // used to mean BUG-6 was back. Without this suffix the two situations are
    // indistinguishable in the log.
    const viaSuffix = launcher.env.ELECTRON_RUN_AS_NODE
      ? " (Electron run-as-node fallback: no standalone node found)"
      : "";
    logger.info(
      `[dsh-chatgpt-web] Starting dsh-chatgpt-web daemon via ${launcher.cmd}${viaSuffix} at http://${host}:${port}/v1...`,
    );

    const child = spawn(launcher.cmd, launcher.args, {
      cwd: ROOT_DIR,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        // The Electron last resort needs this; harmless for a real node binary.
        ...launcher.env,
      },
    });

    spawnedProcess = child;

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text && typeof logger.debug === "function") logger.debug(`[sidecar] ${text}`);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text && typeof logger.debug === "function") logger.debug(`[sidecar:err] ${text}`);
    });

    child.on("error", (err) => {
      logger.error(`[dsh-chatgpt-web] Failed to launch sidecar process: ${err.message}`);
      // A spawn failure may never emit "exit", so schedule from here as well.
      spawnedProcess = undefined;
      scheduleRestart(`failed to launch (${err.message})`);
    });

    child.on("exit", (code, signal) => {
      spawnedProcess = undefined;
      if (stopping) return; // deliberate shutdown — never restart
      const detail =
        code === 0 || code === null
          ? `exited (code: ${code}, signal: ${signal})`
          : `exited with code ${code} (signal: ${signal})`;
      scheduleRestart(detail);
    });

    // Wait for healthcheck
    const deadline = Date.now() + readyTimeoutMs;
    while (Date.now() < deadline) {
      if (await isSidecarHealthy(host, port)) {
        logger.info(`[dsh-chatgpt-web] Sidecar ready and accepting turns at http://${host}:${port}/v1`);
        failureCount = 0;
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    logger.error(`[dsh-chatgpt-web] Sidecar did not become healthy within ${readyTimeoutMs}ms`);
    // It may still come up late, but do not leave the host without a sidecar forever.
    scheduleRestart(`did not become healthy within ${readyTimeoutMs}ms`);
  };

  /** How long the sidecar may spend finishing in-flight turns before we stop waiting. */
  const GRACEFUL_SHUTDOWN_MS = 8_000;
  /** How long to wait for the process to actually exit after it accepts the shutdown. */
  const EXIT_WAIT_MS = 3_000;

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  /**
   * Read the control token so /admin/* accepts our requests.
   *
   * These endpoints require a bearer token; without one they answer 401, which is why the
   * old shutdown request could never work. Read it fresh from config.json (the sidecar is
   * handed the same file) instead of caching, so a token rotation cannot strand us.
   */
  const readControlToken = (): string | undefined => {
    try {
      const parsed = JSON.parse(readFileSync(getConfigPath(), "utf8")) as { controlToken?: unknown };
      return typeof parsed.controlToken === "string" && parsed.controlToken.length > 0
        ? parsed.controlToken
        : undefined;
    } catch {
      return undefined;
    }
  };

  const waitForExit = (child: ChildProcess, timeoutMs: number): Promise<boolean> =>
    new Promise<boolean>((resolveExit) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolveExit(true);
        return;
      }
      const onExit = () => {
        clearTimeout(timer);
        resolveExit(true);
      };
      const timer = setTimeout(() => {
        child.removeListener("exit", onExit);
        resolveExit(false);
      }, timeoutMs);
      child.once("exit", onExit);
    });

  const stopDaemon = async () => {
    stopping = true;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = undefined;
    }
    const child = spawnedProcess;
    if (!child) return;

    logger.info("[dsh-chatgpt-web] Stopping sidecar daemon...");

    const token = readControlToken();
    if (!token) {
      logger.warn(
        "[dsh-chatgpt-web] No control token in config.json; terminating the sidecar without a graceful shutdown",
      );
    } else {
      const callAdmin = async (path: string, timeoutMs: number): Promise<Response | undefined> => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          return await fetch(`http://${host}:${port}${path}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          });
        } catch {
          return undefined;
        } finally {
          clearTimeout(timer);
        }
      };

      // Drain first. /admin/shutdown deliberately refuses (409) unless the sidecar is already
      // draining AND has no active turn, so skipping this step would always be refused even
      // with a valid token.
      await callAdmin("/admin/drain", 2_000);

      // Then ask for a clean shutdown, retrying while in-flight turns wind down.
      const deadline = Date.now() + GRACEFUL_SHUTDOWN_MS;
      let accepted = false;
      let refusal: number | undefined;
      while (Date.now() < deadline) {
        const response = await callAdmin("/admin/shutdown", 2_000);
        if (!response) break; // the sidecar is already gone
        if (response.ok) {
          accepted = true;
          break;
        }
        if (response.status !== 409) {
          refusal = response.status;
          break;
        }
        await sleep(250); // 409 = active turns remain; give them a moment and retry
      }

      if (accepted) {
        // shutdown() closes the browser workers and the listener, then the process exits.
        if (await waitForExit(child, EXIT_WAIT_MS)) {
          logger.info("[dsh-chatgpt-web] Sidecar shut down cleanly");
          spawnedProcess = undefined;
          return;
        }
        logger.warn(
          `[dsh-chatgpt-web] Sidecar accepted shutdown but did not exit within ${EXIT_WAIT_MS}ms; terminating it`,
        );
      } else if (refusal !== undefined) {
        logger.warn(`[dsh-chatgpt-web] Sidecar refused a graceful shutdown (HTTP ${refusal}); terminating it`);
      } else if (Date.now() >= deadline) {
        logger.warn(
          `[dsh-chatgpt-web] Sidecar still had active turns after ${GRACEFUL_SHUTDOWN_MS}ms; terminating it`,
        );
      }
    }

    if (!child.killed) child.kill("SIGTERM");
    spawnedProcess = undefined;
  };

  if (typeof ctx.effect === "function") {
    ctx.effect(() => {
      void startDaemon();
      // Return the promise rather than detaching it: the graceful shutdown polls the sidecar
      // for up to GRACEFUL_SHUTDOWN_MS, and a host that awaits its disposers (cordis does)
      // must be able to wait for that work instead of tearing the process down mid-flight.
      return () => stopDaemon();
    });
  } else {
    void startDaemon();
    process.once("beforeExit", () => void stopDaemon());
  }
}

export default {
  name,
  inject,
  apply,
};
