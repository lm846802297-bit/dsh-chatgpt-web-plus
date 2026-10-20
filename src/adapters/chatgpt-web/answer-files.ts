/**
 * 从回答文本中提取 markdown 文件并落盘。
 *
 * 背景：免费 Luna 账号只能**间歇性**使用 ChatGPT 自带的文件生成工具
 * （经常回 "It seems like I can't do more advanced data analysis right now"）。
 * 但即使工具不可用，模型通常仍会把整份文档写进回答里——通常在 fenced code block 中。
 * 既然文本已经拿到了，本地直接写盘就能拿到文件，完全不依赖 OpenAI 侧的可用性。
 *
 * 识别三种形态：
 *   1. info string 里带文件名的 fenced block，如 ```md note.md 或 ```markdown filename=note.md
 *   2. fenced block 前一行提到 .md 文件名
 *   3. 整个回答就是一份 markdown 文档（有标题、无 fence、足够长）
 */

export interface SavedAnswerFile {
  fileName: string;
  body: string;
}

/** 从一段回答里找出应当存成 .md 的文件。纯函数，便于单测。 */
export function extractMarkdownFiles(answer: string, turnName: string): SavedAnswerFile[] {
  const out: SavedAnswerFile[] = [];
  const seen = new Set<string>();
  const push = (name: string, body: string): void => {
    const content = body.replace(/^\uFEFF/, "").trim();
    // Guard against empty/one-word fences used inline in prose (```js const x = 1```), but do not
    // reject a legitimately short document: "# 标题\n内容" is a real two-line file.
    if (content.length === 0) return;
    if (content.length < 4 && !content.startsWith("#")) return;
    const fileName = ensureMarkdownExtension(sanitizeName(name || `chatgpt-${turnName}.md`));
    const key = `${fileName}\u0000${content.length}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ fileName, body: content.endsWith("\n") ? content : `${content}\n` });
  };

  // 逐个 fenced block 扫描，用索引手工切分，避免复杂正则的可读性问题。
  const fenceRe = /```([^\n`]*)\n/g;
  let cursor = 0;
  while (true) {
    fenceRe.lastIndex = cursor;
    const open = fenceRe.exec(answer);
    if (!open) break;
    const info = (open[1] ?? "").trim();
    const bodyStart = open.index + open[0].length;
    const closeIdx = answer.indexOf("```", bodyStart);
    if (closeIdx < 0) break;
    const body = answer.slice(bodyStart, closeIdx);
    cursor = closeIdx + 3;

    const inlineName = /(?:filename\s*=\s*)?([\w.-]+\.md)\b/i.exec(info)?.[1];
    if (inlineName) {
      push(inlineName, body);
      continue;
    }

    // fence 前 200 字符内，最后一行提到的 .md 文件名
    const preceding = answer.slice(Math.max(0, open.index - 200), open.index);
    const priorLine = preceding.split("\n").slice(-3).join("\n");
    const priorName = /([\w.-]+\.md)\b/i.exec(priorLine)?.[1];
    if (priorName) {
      push(priorName, body);
      continue;
    }

    // 没有明确文件名，但正文像 markdown 文档：仍保存，每轮一个
    if (body.trim().length > 200 && /^#{1,6}\s/m.test(body)) {
      push(`chatgpt-${turnName}.md`, body);
    }
  }

  if (out.length > 0) return out;

  // 整个回答就是文档，没有任何 fence。
  //
  // ChatGPT 渲染后会留下 "Markdown" 这类代码块标签文字，且真正的 ``` 标记在 markdown 抽取里
  // 已被吃掉、只留下孤立的单个反引号。所以判据退化为：足够长 + 出现 markdown 标题。
  // 标题不要求在行首：渲染抽取会把整段压成单行（"Markdown `# 物理推导 ## 一、…"），
  // 要求 ^# 会永远匹配不到，这正是第一版漏判的原因。
  const trimmed = answer.trim();
  const looksLikeDocument = trimmed.length > 200
    && /#{1,6}[ \t]*[^\s#]/.test(trimmed)
    && (/^#{1,6}[ \t]/m.test(trimmed) || /(?:Markdown|markdown|md)[ \t`]+#/.test(trimmed) || /[。.!?][ \t]*`?#{1,6}[ \t]/.test(trimmed));
  if (!trimmed.includes("```") && looksLikeDocument) {
    push(`chatgpt-${turnName}.md`, reflowMarkdown(stripCodeBlockLabel(trimmed)));
  }
  return out;
}

/**
 * 去掉渲染残留的代码块语言标签（"Markdown" / "markdown" / "md"）——它本该是 ``` 后面的 info
 * string，在纯文本抽取里退化成了一个孤立的词，留在文件开头会破坏 markdown 结构。
 */
function stripCodeBlockLabel(text: string): string {
  return text.replace(/^(?:Markdown|markdown|md)[ \t]*\n+/, "").replace(/^(?:Markdown|markdown|md)[ \t`]*(?=#)/, "");
}

/**
 * 把被压成单行的渲染文本还原成多行 markdown。
 *
 * ChatGPT 的 DOM→Markdown 抽取会把整段折叠成一行（块级元素之间只剩空格），
 * 结果文件虽然内容完整但完全不可读。这里在**明确的块级边界**重新插入换行：
 * 标题（#…）、列表项（- / * / 数字.）、以及紧邻 `\(`/`\[` 公式之前的位置。
 * 只在原本没有换行的长行上生效，避免破坏本来就正常的输出。
 */
function reflowMarkdown(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (line.length < 120) { out.push(line); continue; }
    let fixed = line
      // 标题前断行："…内容 ## 二、" → "…内容\n## 二、"
      .replace(/([^\n#])(#{2,6}[ \t]*[^\s#])/g, "$1\n$2")
      // 行首的第一个标题保持原样
      .replace(/^`?(#{1,6})[ \t]*/, (m, hashes) => `${hashes} `)
      // 列表项前断行，并把 "- " 与内容留在同一行
      .replace(/([^\n])([ \t]+)-[ \t]+(?=[^\s])/g, "$1\n- ")
      // 编号列表
      .replace(/([^\n])([ \t]+)(\d+\.[ \t]+)(?=[^\s])/g, "$1\n$3")
      // 反斜杠公式前断行
      .replace(/([^\n])(\\[([].)/g, "$1\n$2");
    // 修掉"标题符号独占一行"和"列表符号独占一行"这两种断裂
    fixed = fixed
      .replace(/\n(#{1,6})[ \t]*\n+/g, "\n$1 ")
      .replace(/\n-[ \t]*\n+/g, "\n- ");
    out.push(fixed);
  }
  return out.join("\n");
}

function ensureMarkdownExtension(name: string): string {
  return /\.[A-Za-z0-9]{1,8}$/.test(name) ? name : `${name}.md`;
}

function sanitizeName(name: string): string {
  const base = (name || "chatgpt").split(/[\\/]/).pop() ?? "chatgpt";
  return base.replace(/[\u0000-\u001f<>:"|?*]/g, "_").slice(0, 120) || "chatgpt";
}
