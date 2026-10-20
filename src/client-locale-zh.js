/**
 * 中文词典。与 DICT_EN 的键一一对应。
 *
 * 单独成文件便于校对：键缺失时 locale 服务会回退到英文，不会报错，所以必须靠
 * 键集合比对来发现遗漏（见 scripts/verify-locale.mjs）。
 */
export const DICT_ZH = {
  'section.title': 'ChatGPT 网页版',

  'conn.title': '连接',
  'conn.token': '控制令牌',
  'conn.tokenHint': '侧车控制令牌（config.json 中的 controlToken），只保存在本浏览器。',
  'conn.tokenPlaceholder': '粘贴 config.json 里的 controlToken',
  'conn.reload': '重新加载',

  'status.title': '侧车状态',
  'status.offline': '侧车未运行',
  'status.offlineHint': '在 127.0.0.1:17841 上没有侧车响应。请先运行 "dsh-chatgpt-web serve"，然后重新加载本页。',
  'status.tokenMissing': '尚未填写控制令牌。',
  'status.tokenMissingHint': '请把 config.json 里的 controlToken 粘贴到上面的输入框，然后点「重新加载」。',
  'status.tokenInvalid': '控制令牌不正确。',
  'status.tokenInvalidHint': '侧车已响应，但拒绝了当前令牌。请重新粘贴 config.json 里的 controlToken。',
  'status.unreachable': '连不上侧车。',
  'status.unreachableHint': '令牌已填，但访问 127.0.0.1:17841 失败。请确认侧车正在运行（"dsh-chatgpt-web serve"），并检查浏览器是否拦截了跨域请求。',

  'summary.title': '当前配置',
  'summary.conversation': '会话模式',
  'summary.compression': '压缩方式',
  'summary.host': '浏览器宿主',
  'summary.dir': 'ChatGPT 登录',

  'tuning.title': '传输限制',
  'tuning.hint': '从下一轮对话起生效，无需重启侧车。留空表示使用默认值。',
  'tuning.save': '保存',
  'tuning.restore': '恢复默认',
  'tuning.composerCharLimit': '输入框字符上限',
  'tuning.responseDomGraceMs': '首字宽限下限（毫秒）',
  'tuning.responseDomGraceMaxMs': '首字宽限上限（毫秒）',
  'tuning.responseDomGracePerCharMs': '每字符宽限增量（毫秒）',
  'tuning.sendEnableGraceMs': '发送按钮宽限（毫秒）',
  'tuning.turnTimeoutMs': '单轮超时（毫秒）',

  'turns.title': '最近的浏览器轮次',
  'turns.empty': '暂无记录。',
  'turns.time': '时间',
  'turns.result': '结果',
  'turns.turns': '用户 / 助手轮次',
  'turns.error': '错误',

  'convo.title': '会话模式',
  'convo.hint': '决定每一轮在哪里运行。「标准会话」会为每个 DSH 会话保留一个常驻的普通对话，ChatGPT 因此能保留它正在维护的文档，并在每轮提供下载。',
  'convo.temporary': '临时聊天 —— 每轮都是全新对话（不保留任何内容）',
  'convo.standard': '标准会话 —— 常驻同一个对话，文件保留在 ChatGPT 侧',
  'convo.temporaryNote': '不会写入你的 ChatGPT 历史，生成的文在下一轮之前就会消失。',
  'convo.standardNote': '对话会保留在 ChatGPT 历史中。下载的文件保存在侧车的下载目录。',
  'convo.save': '保存会话模式',
  'convo.saved': '会话模式已保存，从下一轮起生效。',
  'convo.downloads': '最近下载',
  'convo.noDownloads': '还没有下载任何文件。',
  'convo.downloadDir': '下载目录',
  'convo.refresh': '刷新列表',
  'convo.openFolder': '打开文件夹',
  'convo.opened': '已打开下载目录。',
  'convo.unavailable': '标准会话需要托管 Chrome 宿主；当前配置使用启动器宿主，因此该选项不可用。',
  'convo.file': '文件名',
  'convo.size': '大小',
  'convo.time': '保存时间',
  'convo.path': '完整路径',

  'compress.title': '历史压缩方式',
  'compress.hint': '决定 Luna 如何在轮次之间携带对话历史。从下一轮起生效，无需重启侧车。',
  'compress.auto': '自动（Luna 用滚动检查点，其他路由用原生压缩）',
  'compress.rolling': '滚动检查点 —— 模型在每次回答末尾写入摘要',
  'compress.native': '原生压缩 —— 由客户端发起压缩轮（标准 Responses 契约）',
  'compress.current': '当前',
  'compress.rollingNote': '当前为滚动检查点模式，Luna 的压缩请求会返回 HTTP 409。',
  'compress.nativeNote': '由客户端决定何时压缩，DSH/Codex 会发起标准的压缩轮。',
  'compress.save': '保存压缩方式',
  'compress.saved': '压缩方式已保存，从下一轮起生效。',

  'notice.saved': '已保存，新限制从下一轮起生效。',
  'notice.reloaded': '已重新加载。',
}
