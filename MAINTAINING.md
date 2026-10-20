# dsh-chatgpt-web-local 本地维护分支

这是 `@wlv-zedd/dsh-chatgpt-web` 的本地分支。包名已改为 **`dsh-chatgpt-web-local`**，
插件市场不再把它识别为自己的包：

- 市场里 `@wlv-zedd/dsh-chatgpt-web` 显示为**未安装**（profile 里已无该引用）
- 本地版以 `dsh-chatgpt-web-local` 的身份出现在 profile 的 bundles 列表中
- 市场更新无法覆盖它（`link:` 依赖 + 不同包名，双重隔离）

---

## 1. 它现在装在哪

| 位置 | 作用 |
|---|---|
| `~/.dsh/profiles/desktop/vendor/dsh-chatgpt-web/` | **实际运行的副本**（唯一事实来源） |
| `~/.dsh/profiles/desktop/node_modules/dsh-chatgpt-web-local` | 指向上面那个目录的符号链接 |
| `~/.dsh/profiles/desktop/package.json` | 依赖写成 `"dsh-chatgpt-web-local": "link:vendor/dsh-chatgpt-web"` |

`link:` 依赖的意义：pnpm 只维护一个符号链接，**永远不会**再把市场版本下载回来覆盖你的改动。
这一点和之前 `dsh-our-free-model` 的处理方式一致，那边是踩过坑之后的做法。

### 为什么改了包名

只做 `link:` 还不够：市场界面判断「是否已安装」看的是 profile
`package.json` 里有没有 `@wlv-zedd/dsh-chatgpt-web` 这个 key。
保留原名的话，市场会一直显示「已安装」，点更新/卸载都可能把本地改动冲掉。

改成 `dsh-chatgpt-web-local` 之后：

- 市场侧：原名彻底消失 → 显示未安装，更新按钮不再指向它
- 本地侧：新名字出现在 `dsh.profile.bundles`，DSH 照常加载
- 改动位置只有两处：`package.json` 的 `name`、`cordis.patch.yml` 的 `name`
  （插件源码内部不引用包名，所以改名是安全的）

---

## 2. 改代码的正确流程

源码在 `vendor/dsh-chatgpt-web/src/`，`lib/` 是**构建产物**，不要直接改。

```bash
cd ~/.dsh/profiles/desktop/vendor/dsh-chatgpt-web

# 1. 改 src/ 下的 TypeScript
# 2. 重新构建（bun 已装在 ~/.dsh/plugin-packages/buntool）
~/.dsh/plugin-packages/buntool/node_modules/.bin/bun build \
  src/cli.ts src/plugin.ts --outdir lib --target node --format esm --packages external

# 3. 重启 DSH Desktop 生效
```

构建工具说明：插件作者用 bun 打包（`package.json` 的 `build` 脚本）。
`bun` 不在本机 PATH 里，单独装在 `~/.dsh/plugin-packages/buntool/`，
上面的绝对路径可以直接用。

---

## 3. 已修的问题

原始 1.0.4 在**中文界面下完全不可用**，根因是所有 DOM 选择器都匹配英文字面量。
ChatGPT 按用户语言渲染 `aria-label` 和按钮文案，所以非英文界面全部失配。

| 编号 | 问题 | 位置 | 症状 |
|---|---|---|---|
| 1 | 发送按钮只认 `aria-label="Send"` | `chatgpt-session.ts` | **致命**：永远找不到按钮，20s 超时 |
| 2 | 完成判定只认 `aria-label="Copy"` | `chatgpt-session.ts` | 回复已生成却判 stalled |
| 3 | 停止按钮只认 `"Stop"` | `chatgpt-session.ts` | 中断失效 |
| 4 | 临时聊天弹窗只认 `Not in history` | `browser-worker.ts` | 弹窗挡路未关闭 |
| 5 | 个性化开关只认 `Personalized` | `browser-worker.ts:596` | 启用 connector 后抛错 |
| 6 | 拒绝按钮只认 `"Deny"` | `browser-worker.ts:880` | 权限弹窗卡死 |
| 7 | 授权弹窗只认 `"Allow"` | `browser-worker.ts:865` | 同上 |
| 8 | 订阅失败告警纯英文 | `browser-worker.ts:812` | 401 退化成超时 |
| 9 | `send` 阶段预算只有 20s | `browser-worker.ts` | 慢网/冷标签误判失败 |
| 10 | 完成判定依赖单一证据 | `chatGptTurnIsComplete` | 复制按钮一改全盘失效 |

### 关键设计改动

**新增 `src/ui-text.ts`** —— 所有界面文案的集中匹配表。
问题 1-9 本来是因为同一类错误散布在 9 个地方（修了 4 个还剩 5 个），
现在统一到一张表，加语言只改一处。

**完成判定加备用证据（问题 10）**
原来只认「复制按钮可见」。现在补充：**没有停止按钮 + 文本稳定 ≥2s** 也算完成。
复制按钮是这块 DOM 里最易变的部分（`data-testid` 和 `aria-label` 历史上都改过），
单点依赖会让一次 UI 调整废掉所有回复。

---

## 4. 实测记录

修复后（从 `src/` 完整重建）：

```
chatgpt-web/luna  → status: completed  text: L10N_OK
chatgpt-web/think → status: completed  text: THINK_L10N_OK
```

`send` 阶段耗时从 **20013ms（超时）** 降到 **866ms**。

---

## 5. 升级到上游新版时的注意事项

如果以后想把作者的新版合并进来：

1. **不要**直接改 `package.json` 回版本号 —— 那会用市场的包覆盖你所有修复。
2. 正确做法：把新版下载到临时目录，用 diff 比对 `src/`，手工把上游的**非选择器改动**（新功能、协议调整）挑进来。
3. 选择器相关的改动**不要合并**，用本地 `ui-text.ts` 的版本。

### 已知的上游待修点

如果上游将来修了这些问题，可以参考它的做法，但注意别丢掉本地化和备用证据：

- `browser-worker.ts` 里还有若干 `hasText` 硬编码（个性化菜单的 `^Personalized` 已修，但可能有遗漏）
- `appName` 配置项（`config.json` 里是 `"Codex Native2"`）参与授权弹窗文案匹配，多语言环境下需要额外处理

---

## 6. 回滚

profile 的 `package.json` 和 `pnpm-lock.yaml` 已备份：

```
package.json.bak-before-chatgptweb-vendor-<时间戳>
pnpm-lock.yaml.bak-before-chatgptweb-vendor-<时间戳>
```

回到市场版：把依赖改回 `"@wlv-zedd/dsh-chatgpt-web": "1.0.4"`，
然后 `pnpm install --no-frozen-lockfile`。
但**不建议**——那会退回中文界面不可用的状态。

---

## 7. 压缩机制可选（本地新增）

上游把 Luna 的滚动检查点写死了，本地分支把「用哪种压缩机制」变成可配置项。

### 三种模式

| 模式 | Luna 行为 | 其他路由 |
|---|---|---|
| `auto`（默认） | 滚动检查点 | 原生压缩 |
| `rolling-checkpoint` | 滚动检查点，压缩请求返回 409 | 原生压缩 |
| `native-compaction` | **接受客户端压缩请求**（标准 Responses 契约） | 原生压缩 |

### 切换方式（三种，任选）

**1. 插件设置界面（推荐）**

DSH Desktop → 设置 → ChatGPT Web → **History compression** 卡片，单选后点
"Save compression mode"。**即时生效，不用重启**（服务端会同时更新内存配置）。

**2. CLI**

```bash
dsh-chatgpt-web compression show            # 查看当前
dsh-chatgpt-web compression native          # 用原生压缩
dsh-chatgpt-web compression rolling         # 用滚动检查点
dsh-chatgpt-web compression auto            # 恢复默认
```

CLI 改完需要重启 sidecar 或 DSH Desktop。

**3. 设置界面背后的 HTTP API**

```bash
# 读
curl -H "Authorization: Bearer <controlToken>" http://127.0.0.1:17841/v1/control/config
# 写
curl -X PUT -H "Authorization: Bearer <controlToken>" -H "Content-Type: application/json"   -d '{"compressionMode":"native-compaction"}'   http://127.0.0.1:17841/v1/control/config
```

`controlToken` 在 `~/.dsh/storages/chatgpt-web/config.json`。

**4. setup 参数**

`--native-compaction` / `--rolling-checkpoint` / `--auto-compression`。

> 设置界面的 `PUT /v1/control/config` 会同时写盘并更新内存配置，所以**下一轮立即生效**；
> CLI 只写盘，需要重启进程。

### 两种机制的区别

| | 滚动检查点 | 原生压缩 |
|---|---|---|
| 触发 | 每轮自动 | 客户端发 `{type:"compaction_trigger"}` 时 |
| 摘要生成 | 模型自己写（回答末尾追加私有标记） | 独立压缩轮（`COMPACT_PROMPT`） |
| 历史处理 | 摘要**替换**完整历史 | 返回 `ocx1:` 编码的摘要，客户端下轮重放 |
| 摘要结构 | Objective/State/Evidence/Decisions/Pending | 自由文本 |
| 上限 | 4000 tokens | 无固定上限 |
| 路由支持 | 仅 Luna | 所有路由 |
| 你能否控制 | 改提示词契约 | 客户端完全控制 |

### 实现要点

- 设置界面：`client.js` 的 "History compression" 卡片（单选 + 保存）
- control API：`GET/PUT /v1/control/config` 的 `compressionMode` 字段
- `AppConfig.compressionMode` + `provider.chatgptWeb.compressionMode` 双通道透传
- `server.ts`：`lunaNativeCompactionEnabled(config)` 决定是否 409
- `prompt.ts`：`allowLunaNativeCompaction` 选项放行 Luna 压缩轮
- `index.ts`：`lunaRollingCheckpointEnabled()` 决定是否捕获检查点
- `usage.ts`：token 估算同步该模式（否则预估阶段就抛错）

两机制天然互斥：`captureLunaCheckpoint` 已排除 `_compactionRequest`。

### 踩过的坑

改这个功能时最容易漏的是 **token 估算路径**（`usage.ts`）。它在真正的 compile 之外独立调用了一次
`compileChatGptWebPrompt`，如果不同步传 `allowLunaNativeCompaction`，会看到这样的怪现象：

```
诊断显示 allowFlag=true，但错误仍然抛出
```

因为真正抛错的是预估那次调用，不是主路径。以后改 compile 选项时记得三处一起看：
主路径（`compileOptionsFor`）、`usage.ts` 的 `estimateChatGptWebInputTokens`、以及所有 `estimateChatGptWebUsage` 调用点。

---

## 8. 文件完整性核对（必做）

### 为什么需要它

这个包最初是靠**手动列举文件名**从官方 tarball 复制过来的，结果漏掉了：

- `client.js` —— 整个设置界面
- `assets/` —— 截图与 demo
- `screenshots.json`

漏掉 `client.js` 的症状极其隐蔽：**命令行一切正常，sidecar 正常启动，模型正常对话**，
只是设置页里看不到这个插件的面板。运行时不会报任何错。

所以每次复制、迁移、升级之后，都必须对照官方 tarball 跑一次核对。

### 怎么跑

```bash
cd ~/.dsh/profiles/desktop/vendor/dsh-chatgpt-web
node scripts/verify-integrity.mjs            # 用缓存基线
node scripts/verify-integrity.mjs --refresh  # 重新下载官方基线
```

全部通过时退出码 0，输出 `结果：完整。`；有问题时退出码 1 并逐条列出。

### 它检查什么

| 项 | 内容 |
|---|---|
| 1 | 官方 tarball 基线（`npm pack` 到临时目录并缓存） |
| 2 | 列举本地文件，排除本地新增（`MAINTAINING.md`、`src/ui-text.ts`、`package-lock.json`、`node_modules/`、`scripts/`） |
| 3 | **官方有、本地缺** —— `client.js`/`assets/`/`screenshots.json` 缺失会标「严重：UI 资源」 |
| 4 | 本地有、官方没有 —— 应全部是本地修复，逐条列出供确认 |
| 5 | 关键文件存在且非空（`client.js`、`lib/plugin.js`、`lib/cli.js`、`cordis.patch.yml`、`package.json`） |
| 6 | 包名一致：`package.json` 的 `name`、`version` 带 local 标记、`cordis.patch.yml` 引用新名、无旧名残留（**只查有效 YAML 行，注释里说明改名来源不算**） |
| 7 | profile 侧：依赖是 `link:vendor/...`、已列入 `bundles`、无 `@wlv-zedd` 残留、`node_modules` 链接存在 |

### 已验证有效

故意移走 `client.js` 后运行，脚本准确报出：

```
✗ client.js  ← 严重：UI 资源
✗ client.js 不存在 — 设置界面（缺失则设置页无此插件）
结果：发现 2 个问题。
```

### 复制新版本时的正确做法

**不要**手动列举文件名。用 tarball 完整解压再同步：

```bash
cd /tmp && rm -rf pkgbase && mkdir pkgbase && cd pkgbase
npm pack @wlv-zedd/dsh-chatgpt-web@<版本>
tar -xzf *.tgz
# 对照 package/ 目录逐项处理，而不是凭印象挑文件
rsync -a --exclude node_modules package/ ~/.dsh/profiles/desktop/vendor/dsh-chatgpt-web/
```

然后**立刻**跑 `scripts/verify-integrity.mjs` 确认。

---

## 9. 会话模式（本地新增）：temporary vs standard

### 为什么加这个

上游的每一轮都跑在**全新临时聊天**里。这是刻意的（不污染账号历史），但代价是
**ChatGPT 在两轮之间什么都不记得**——包括它正在维护的文档。所以「让 ChatGPT 持续维护
一份 md，然后下载」在上游版本里根本做不到：文件在下一轮开始前就没了。

### 两种模式

| 模式 | 行为 | 适用 |
|---|---|---|
| `temporary`（默认） | 每轮全新临时聊天，不写入历史 | 一般对话、隐私优先 |
| `standard` | **一个普通对话跨轮存活**，文件保留在 ChatGPT 侧 | 需要 ChatGPT 维护文档并下载 |

`standard` 模式的实现要点：

- 按 DSH thread 维持一个 ChatGPT 标签页（`StandardConversationBroker`）
- 会话 URL 持久化到 `runtime/conversations.json`，重启后可重新接上
- 挂 `context.on('download')` 捕获文件，落到 `<configDir>/downloads`
- 只支持 `browserHost: managed-chrome`（launcher 有自己的生命周期）

### 切换方式

**优先用设置界面**：DSH Desktop → 设置 → ChatGPT Web → **Conversation surface** 卡片。

也可用 CLI（需重启 sidecar）：

```bash
dsh-chatgpt-web conversation show
dsh-chatgpt-web conversation standard
dsh-chatgpt-web conversation temporary
```

或 HTTP：

```bash
curl -X PUT -H "Authorization: Bearer <controlToken>" -H "Content-Type: application/json"   -d '{"conversationMode":"standard"}' http://127.0.0.1:17841/v1/control/config
curl -H "Authorization: Bearer <controlToken>" http://127.0.0.1:17841/v1/control/downloads
curl -X POST -H "Authorization: Bearer <controlToken>" http://127.0.0.1:17841/v1/control/open-downloads
```

### 让 ChatGPT 生成 md 的正确提示词

**不要指定 Python**——免费版调不到 Python 工具，会回「无法调用 Python 文件生成工具」。

| 提示词 | 结果 |
|---|---|
| 「请创建一个 markdown 文件，文件名 note.md，内容…」 | ✅ 生成并提供下载链接 |
| 「Create a markdown file named x.md …」（英文） | ✅ 成功 |
| 「用 python 创建…」 | ❌ 工具不可用 |

而且文件工具是**间歇性**的：同一措辞有时成功有时失败，属 OpenAI 侧限制，重试即可。

### 已知未完成项：自动点击下载

`captureTurnDownloads()` 会在回复完成后扫描 `a[href]` 找文件链接并点击以触发下载。
实测中它**执行了但找到 0 个链接**——dump 出的 11 个链接全是侧边栏对话链接。

说明文件下载控件的 DOM 形态与假设不同（可能不是 `<a href>`，而是按钮 + JS 事件，
或在折叠区域里）。需要针对真实 DOM 再定位。

**当前替代方案**：standard 模式下对话会进入你的 ChatGPT 历史，直接打开网页版找到该对话，
手动点「下载 note.md」即可。这已经比上游版本（对话根本不可见）好很多。

### 副作用提醒

`standard` 模式会**往你的 ChatGPT 历史写入对话记录**。不想留痕就切回 `temporary`。

---

## 10. 在 DSH 内直接拿到 md 文件（本地新增）

### 解决什么问题

免费 Luna 账号**只能间歇性**调用 ChatGPT 的文件生成工具（常回
`It seems like I can't do more advanced data analysis right now`）。即使工具可用，
上游版本每轮都换新的临时聊天，文件下一刻就没了。

要「在 DSH 里直接下载、不用打开网页」，需要两条腿：

1. **standard 会话模式** —— 一个对话跨轮存活（见第 9 节）
2. **从回答里落盘** —— 工具不可用时，模型仍会把整篇文档写进回答

第 2 条才是关键：**不依赖 OpenAI 侧的文件工具**。

### 实现

新增 `src/adapters/chatgpt-web/answer-files.ts`：

```
extractMarkdownFiles(answer, turnName) -> SavedAnswerFile[]
```

识别三种形态：

| 形态 | 例子 |
|---|---|
| fence 的 info 串里带文件名 | 三个反引号后写 `md note.md`，或 `markdown filename=note.md` |
| fence 前一行提到 .md 文件名 | 「以下是 derivation.md：」后面接代码块 |
| 整篇回答就是文档（无 fence） | 见下方坑 1 |

由 `StandardConversationBroker.saveMarkdownFromAnswer()` 在 turn 完成时调用，
文件落到 `<configDir>/downloads/`，并在设置页的 **Recent downloads** 表里列出。

### 三个必须记住的坑

**坑 1：渲染会把 code fence 标记吃掉**

ChatGPT 的 DOM→Markdown 抽取把 fence 标记丢了，只在开头残留一个
`Markdown` 标签词和孤立的反引号。所以判断「这是不是文档」**不能要求含 fence 标记**，
只能靠「足够长 + 出现 markdown 标题」。

**坑 2：整段会被压成一行**

抽取结果没有换行，4983 字节的文档挤在一行里，内容完整但不可读。
`reflowMarkdown()` 在明确边界（`#` 标题、`- ` 列表、`\[` / `\(` 公式前）重新插入换行，
只对长度 > 120 的行生效，避免破坏本来正常的输出。

**坑 3：标题不在行首**

渲染后标题前有 `Markdown` 前缀（两个空格 + 反引号），
所以 `^#` 永远匹配不到。第一版就栽在这里——**文件内容是完整的，但一个字都没存**。

### 验证方法

`extractMarkdownFiles` 是纯函数，可直接单测：

```js
import { extractMarkdownFiles } from './src/adapters/chatgpt-web/answer-files.ts'
const files = extractMarkdownFiles('```md note.md\n# 标题\n内容\n```', 'test')
// files[0].fileName === 'note.md'
// files[0].body === '# 标题\n内容\n'
```

覆盖用例：fence+info名、fence+前置名、无 fence 整篇、纯对话（应 0）、
内联短码（应 0）、真实渲染单行文本。当前 5/5 通过。

### 让 ChatGPT 输出文档的提示词

**明确要求用代码块**，成功率更高：

> 请把物理推导写成 markdown 文档。直接用 markdown 代码块输出完整内容，
> 第一行是 # 物理推导，包含 E=mc^2 的说明。不要创建文件，只要代码块。

这样即使文件工具挂了，回答里也有完整文本，本地照样能落盘。

### 实测记录

```
输入: 1366 字符的渲染后回答（无 fence，标题不在行首）
输出: 35 行、2553 字节的 derivation md
位置: ~/.dsh/storages/chatgpt-web/downloads/<时间戳>-<thread>-chatgpt-<trace>.md
格式: 标题、列表、公式均已正确分行
```

### 未完成：ChatGPT 原生文件链接

`captureTurnDownloads()` 会扫 `a[href]` 找文件链接并点击，但实测找到 0 个——
dump 出的 11 个链接全是侧边栏对话链接，说明原生下载控件不是 `<a href>`。

**但这条路已经不重要了**：回答落盘方案不依赖它。

---

## 11. 设置界面中文化（本地新增）

### 机制

`client.js` 通过 DSH 的 locale 服务注册词典：

```js
ctx.locale.register(NS, { en: DICT_EN, zh: DICT_ZH, 'zh-CN': DICT_ZH })
```

界面语言为中文时，`ctx.locale.bind(NS)` 自动取 `zh` 字典；键缺失时回退英文，
**不会报错**——所以必须靠键集合比对来发现遗漏，不能靠运行时观察。

### 文件与位置

| 内容 | 位置 |
|---|---|
| 英文词典 | `client.js` 的 `DICT_EN`（上游原有） |
| 中文词典 | `client.js` 的 `DICT_ZH`（本地新增，60 词条） |
| 中文词典草稿/校对源 | `src/client-locale-zh.js`（与 DICT_ZH 内容一致） |
| 状态卡动态值 | 「是/否」「已验证/缺失」等，直接改 `rows` 数组 |
| fallback 文本 | 所有 `t('key', 'fallback')` 的第二参数也已中文化 |

### 为什么 fallback 也要翻译

`locale` 服务正常时永远走字典，fallback 不可见。但两种情况会露出英文：

1. 新增词条后忘了加进 `DICT_ZH`（回退）
2. DSH 的 locale 服务加载失败（`translate === undefined`，整个 t() 走 fallback）

所以规范是：**加词条时三处同步**——`DICT_EN`、`DICT_ZH`、调用点的 fallback。

### 校验方法

```js
// 从 client.js 提取两个词典的键并比对
const extract = (name) => { /* 见 patch-client-zh.mjs 的 keysOf */ }
// en 与 zh 的键集合必须完全一致
```

也可直接扫描残留：

```js
// 所有 t('key', 'fallback') 中不含中文的 fallback 就是漏网之鱼
const re = /t\('([a-z][a-z.]*)',\s*'([^']+)'\)/g
```

当前状态：**全部中文化 ✓**（60 词条对齐，fallback 0 残留）。

### 界面卡片（中文）

| 卡片 | 内容 |
|---|---|
| 连接 | 控制令牌 |
| 当前配置 | 会话模式 / 压缩方式 / 浏览器宿主 / ChatGPT 登录 |
| 侧车状态 | 版本、进程 ID、运行时长、接受新任务、登录状态等 |
| 会话模式 | 临时聊天 / 标准会话 + 最近下载表 + 刷新/打开文件夹 |
| 历史压缩方式 | 自动 / 滚动检查点 / 原生压缩 |
| 传输限制 | 输入框字符上限、各宽限毫秒数、单轮超时 |
| 最近的浏览器轮次 | 时间 / 结果 / 轮次 / 错误 |

### 修改流程

1. 改 `client.js`（无构建，直接生效于下次页面加载）
2. 若加了新词条：`DICT_EN`、`DICT_ZH`、fallback 三处同步
3. `node --check client.js` 确认语法
4. 跑 `scripts/verify-integrity.mjs` 确认文件完整
5. 同步到 `chatgpt-web-local-source/` 备份

---

## 12. Bug 检查记录（sandbox 下载改造后）

本次对「backend-api 下载」改造做了一轮系统性 bug 排查，发现并修复 3 个问题、确认 4 项无恙。

### BUG-1（严重，已修）：scanFrameForSandboxPaths 引用未定义变量

`standard-conversation.ts` 的 `scanFrameForSandboxPaths()` 里残留了一行调试代码：

```js
if (recon.length > 0) this.options.log?.(`... DL-RECON ...`)
```

`recon` 在该作用域**不存在**（清理 recon 时只删了定义没删引用）。后果：
每次 frame 扫描都抛 `ReferenceError`，被外层 `catch {}` 静默吞掉——
**sandbox 下载整体失效，且无任何错误输出**。

这正是之前「文件生成了但下载日志为空」的第二个原因（第一个是时序 bug）。

**教训**：删除调试代码必须删干净；`catch {}` 会把这类错误变成静默失效，
关键路径上要么不用空 catch，要么在 catch 里留一行日志。

### BUG-2（逻辑，已修）：重试循环的死代码与矛盾退出

`extractSandboxFilePaths()` 的重试循环里：

- `hasAssistant` 查询了主文档的 assistant 数量，但**结果从未被使用**（死代码）；
  而且它只查 `page.evaluate`（主文档），与 iframe 扫描语义不一致
- 循环末尾 `else return paths` 在最后一次迭代必然触发，使循环等价于固定 6 次
- 实际上无论哪条路径退出，返回值都应为「最后一次扫描结果」

修正为直白形态：扫到即返回；窗口耗尽返回最后一次结果（通常是空，属正常——
多数轮没有文件）。

### BUG-3（可靠性，已修）：下载失败会拖垮 turn 完成

`extractSandboxFilePaths` / `downloadSandboxFiles` 在 `turn-completed` 处理链中
**没有 try/catch**。抛错会跳过 turn 完成日志、打断正常返回——而此时
**回答文本已经成功交付**，文件只是锦上添花。

修正：整段包裹 try/catch，失败只打一行 error 日志。

### 确认无恙的检查项

| 检查 | 结果 |
|---|---|
| DICT_EN / DICT_ZH 双词典完好，无重复定义、无空 fallback | ✓ |
| standard 模式下 slot 页面不被 finally 关闭（`managedPage` 赋值条件正确） | ✓ |
| maintenancePage 与 standard 模式不冲突（参数传入，互斥正确） | ✓ |
| client.js 无硬编码英文标签残留、无空 fallback | ✓ |

### 运行时验证

构建后真实跑了一轮 standard 模式对话：

```
status: completed | 答: 正常
turn completed (markdownChars=2, domFullScans=4, domCacheHits=22)
无 failed / error 日志
```

### BUG-4（加载，已修）：插件市场更新把 bundle 从 profile 里丢了

现象：`node lib/cli.js doctor` → `✗ Responses proxy is not reachable / fetch failed`，
`Doctor result: not ready`；17841 没有任何监听。手动 `node lib/cli.js serve` 完全正常
（打印 `listening on http://127.0.0.1:17841/v1 (browser-only)`，/healthz 返回 ok）——
**说明构建本身是健康的，问题在「没人去启动它」**。

根因：`~/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles` 缺了
`dsh-chatgpt-web-local`。备份链证明：

| 文件 | bundles 尾部 |
|---|---|
| `package.json.bak-before-plugin-update-20261019-000619` | …`dsh-claude-style`, `dsh-codex-subscription`, **`dsh-chatgpt-web-local`** |
| `package.json.bak-before-plugin-update-20261019-022518` | …`dsh-claude-style`（**已丢失**） |

即 2026-10-19 01:30–02:29 之间的一次插件市场更新重写了 package.json
（package.json 02:28、pnpm-lock 02:29、node_modules 02:29）并丢掉了这一项。
bundle 不在列表里 → 插件的 `cordis.patch.yml` insert 不被应用 → cordis.yml 里没有
`- id: dsh-chatgpt-web-local` 层 → 没有任何层执行 `plugin.ts apply()` → sidecar 永不启动。

`dependencies` 里的 `link:vendor/dsh-chatgpt-web` 一直都在，所以 **pnpm 链接和
node_modules 看起来都是好的，只有 bundles 列表是坏的**——这是最容易被漏掉的一点。

修复：把 `dsh-chatgpt-web-local` 重新加回 `dsh.profile.bundles` 末尾
（备份 `package.json.bak-before-bundle-restore-20261019-031001`）。
保存后 cordis.yml 立即被重新生成，其中出现：

```yaml
- id: dsh-chatgpt-web-local
  name: dsh-chatgpt-web-local
```

**每次插件市场更新后都要重跑 `scripts/verify-integrity.mjs`**——它的第 [7] 项
「已列入 dsh.profile.bundles」就是专门盯这个回归的。本次修复后脚本输出
`结果：完整。所有官方文件在位，包名一致，链接正常。`

### BUG-5（配置，已修）：config.json 里的 runtimeCommand 指向已删除的路径

`~/.dsh/storages/chatgpt-web/config.json` 里存的是：

```json
"runtimeCommand": [
  "C:\\Program Files\\nodejs\\node.exe",
  "C:\\Users\\84680\\.dsh\\profiles\\desktop\\node_modules\\@wlv-zedd\\dsh-chatgpt-web\\lib\\cli.js"
]
```

`node_modules/@wlv-zedd` 早已不存在（包改名 + 改 vendor 目录）。凡是
`loadConfig()` 之后再使用 `runtimeCommand` 的路径都会踩雷：

- `src/service.ts:61` `[...config.runtimeCommand, "serve"]`（launchd plist）
- `src/config.ts:646` `assertDurableRuntimeCommand(parsed.runtimeCommand)` 只校验
  `command[0]` 存在，所以 node.exe 在 → **加载期不报错，使用期才炸**
- `src/codex-interrupt-hook.ts:56`、`src/tunnel.ts:224` 同理

注：`src/plugin.ts resolveLauncher()` **不读** `runtimeCommand`，它用 `process.execPath`
+ `resolve(ROOT_DIR,"lib","cli.js")`，所以修好 bundles 之后 sidecar 就能起来；但
runtimeCommand 仍是一个潜伏的陷阱，必须一并修掉。
（更正：这句「修好 bundles 之后 sidecar 就能起来」的推断是**错的**——bundle 修好后
sidecar 仍然起不来，因为 `process.execPath` 在 DSH Desktop 里指向的是 Electron 主程序。
见 BUG-6。）

修复：指向 vendor 副本
`C:\Users\84680\.dsh\profiles\desktop\vendor\dsh-chatgpt-web\lib\cli.js`
（备份 `config.json.bak-before-runtimecommand-fix-20261019-031500`）。

### BUG-6（启动，已修）：auto-start 用 Electron 主程序当 node 跑 sidecar

这是 17841 一直不通的**最后一层**原因，也是最隐蔽的一层。修完 BUG-4（bundle 归位）后
DSH 日志已经证明插件**确实被加载了**，但 sidecar 依然没起来：

```
2026-10-19 03:10:51.052 [I] [chatgpt-web] [dsh-chatgpt-web] Starting dsh-chatgpt-web daemon via
  C:\Users\84680\AppData\Local\Programs\DSH Desktop\DSH Desktop.exe at http://127.0.0.1:17841/v1...
2026-10-19 03:11:21.283 [E] [chatgpt-web] [dsh-chatgpt-web] Sidecar did not become healthy within 30000ms
```

根因：`src/plugin.ts` 的 `resolveLauncher()` 里写的是 `cmd: process.execPath`。
在 **DSH Desktop 里，插件跑在 Electron 进程内**，`process.execPath` 是
`...\DSH Desktop\DSH Desktop.exe`，不是 `node.exe`。于是 spawn 的实际命令变成

```
"DSH Desktop.exe" <...>\lib\cli.js serve
```

Electron 主程序把它当成「再开一个桌面窗口」的请求，几十毫秒内退出（`exit code 1`），
17841 永远不 bind，然后就是上面那行 30 秒超时。

这个 bug 之所以长期没被发现：**在纯 node 环境下 `process.execPath` 恰好就是 node.exe**，
所以 `node lib/cli.js serve` 手动跑一切正常（doctor 也全绿），只有在真正的宿主机
（Electron）里才暴露。手动起 sidecar 能绕过它，所以「明明能连上」和「插件起不来」可以同时成立。

修复（`src/plugin.ts`）：新增 `resolveNodeRuntime()`，按优先级挑一个**真能跑 ESM CLI 的
可执行文件**，并把需要额外注入的环境变量一起返回：

1. `DSH_CHATGPT_WEB_NODE` 环境变量（显式覆盖，排障用）
2. `PATH` 上的每个 `node` / `node.exe`，用 `node --version` 探测主版本号
3. `process.execPath`（仅当**不在** Electron 里，即 `process.versions.electron` 为空）
4. Windows 常见安装位置：`%ProgramFiles%\nodejs`、`%ProgramFiles(x86)%\nodejs`、
   `%LOCALAPPDATA%\Programs\nodejs`、Volta、nvm-windows 的 `NVM_SYMLINK`、scoop
5. 兜底：仍用 `process.execPath`，但**注入 `ELECTRON_RUN_AS_NODE=1`**，让 Electron 主程序
   以纯 node 模式运行（这是 DSH 自己的 `main.js` 打包 pnpm 时用的同一招）

最低主版本 `MIN_NODE_MAJOR = 20`（package.json 的 engines 要求 >=22.19.0，这里放宽以兼容）。
`Launcher` 接口从 `{cmd,args}` 扩展为 `{cmd,args,env}`，`spawn()` 处改成
`env: { ...process.env, ...launcher.env }`——对真 node 是空对象，无副作用。

验证（`test-plugin-electron-launcher.mjs`，伪造 `process.versions.electron` + 伪造
`process.execPath` 指向 `DSH Desktop.exe`，完全复刻宿主环境）：

```
faked execPath = C:\Users\84680\AppData\Local\Programs\DSH Desktop\DSH Desktop.exe
INFO  [dsh-chatgpt-web] Starting dsh-chatgpt-web daemon via C:\Program Files\nodejs\node.exe ...
post-check healthy = true
healthz pid = 53104 accepting = true
sidecar command line = "C:\Program Files\nodejs\node.exe" ...\vendor\dsh-chatgpt-web\lib\cli.js serve
RESULT: PASS
```

顺带确认兜底路径可用：`ELECTRON_RUN_AS_NODE=1 "DSH Desktop.exe" --version` → `v24.18.1`，
即宿主自带的 Node 是 24.x，即便机器上一个 node 都没有，第 5 条也能兜住。

两条兜底分支都做了实测（`test-launcher-no-path-node.mjs`，故意把 `PATH` 清成
`C:\Windows\system32;C:\Windows`，让 node 只能从已知安装位置找）：

- `MODE=known-locations`：`via C:\Program Files\nodejs\node.exe`，真 node，PASS
- `MODE=electron-fallback`（连安装目录也藏掉）：`via ...\DSH Desktop.exe (Electron
  run-as-node fallback: no standalone node found)`，PASS

那句 `(Electron run-as-node fallback: ...)` 后缀是刻意加的：**备选方案下日志里出现的
文件名和 BUG-6 的故障现场一模一样**，没有这个后缀，日后回看日志就分不清「正常走了兜底」
和「BUG-6 复发」。

教训（与 BUG-4/BUG-5 合起来看）：**一个症状可以是三层 bug 叠加**——
bundle 没加载 → 加载了但启动器指错可执行文件 → 配置里的 runtimeCommand 还是死路径。
每修一层都要重新拿**真实宿主的日志**验证，不能用手动 `node lib/cli.js serve` 的成功
来替代插件自动启动的验证：手动跑的是 node，插件跑的是 Electron。

### BUG-7（健壮性，已修）：sidecar 挂了不会自动重启

`startDaemon()` 只在插件加载时试一次；子进程 `exit` 事件里只有一行 `logger.warn`，
没有任何重生逻辑。所以 sidecar 崩溃、被用户手动 kill、或者第一次启动刚好赶上
Chrome 启动失败，就只能靠重启整个 DSH Desktop 恢复。

修复：在 `child.on("exit")` 和 `child.on("error")` 里加指数退避重试。

- 只在**非主动停止**时重试（`stopDaemon()` 会先置 `stopping = true`，插件卸载/turn
  结束不掉进重试循环）
- 退避 `1s → 2s → 4s → 8s → 16s → 30s` 封顶，连续失败 6 次后放弃并打 error
  （带上恢复方法：重启 DSH Desktop 或手跑 `node lib/cli.js serve`）
- 重试前先 `isSidecarHealthy()`：如果端口上已经有健康的 sidecar（例如用户自己手起的），
  直接认为恢复成功，不再 spawn，避免两个进程抢 17841
- 一旦健康就重置失败计数，下次崩溃重新从 1s 开始
- 重试定时器 `unref()`，不因为等重试而拖住宿主进程退出
- 启动超时（`readyTimeoutMs` 到了还不健康）同样进入重试，而不是就此永久放弃

验证（`test-plugin-respawn.mjs`，两个阶段）：

```
PASS  phase1: sidecar came up initially — pid 17320
>>> killing sidecar pid 17320 to simulate a crash
WARN  ... Sidecar exited with code 1 (signal: null); restarting in 1000ms (attempt 1/6)
PASS  phase1: sidecar was really down after the kill — port closed at least once
PASS  phase1: plugin auto-restarted the sidecar — new pid 52656 (was 17320)
PASS  phase1: restart used backoff logging
>>> disposing the plugin (simulated DSH Desktop shutdown)
INFO  ... Stopping sidecar daemon...
PASS  phase2: teardown stopped the sidecar
PASS  phase2: no zombie respawn after teardown
--- 6/6 checks passed ---  RESULT: PASS
```

这样判断「插件是否健康」就只看 17841 能不能答 `/healthz`，不再依赖 DSH Desktop 是否
重启过。

### 本次最大的教训

**之前 sandbox 下载「静默失效」由两个独立 bug 叠加造成**：
时序错误（扫描在 send-accepted，锚点尚未渲染）+ ReferenceError（扫描一执行就崩）。
两个都修掉后功能才可能工作——**只修一个时看起来像没修**。
多 bug 叠加时，逐个隔离验证比整体观察快得多。
