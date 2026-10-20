/**
 * Client half of dsh-chatgpt-web-local: a "ChatGPT Web" page in the DSH Web GUI settings
 * panel. It reads the sidecar control API (status, tuning config, recent browser turns) and lets
 * the user tune the browser transport limits without touching config files.
 *
 * Plain JS (no build step): React comes from the browser module table, text goes through the
 * Client locale service, and styling uses only --dsw-alias-* theme tokens rendered as a
 * component-local <style> element so unmounting removes it.
 */
window.__ModuleLoader__.load({
  id: 'dsh-chatgpt-web-local',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const TOKEN_KEY = 'dsh-chatgpt-web.controlToken';
    const BASE = 'http://127.0.0.1:17841';

    const DICT_EN = {
      'section.title': 'ChatGPT Web',
      'conn.title': 'Connection',
      'conn.token': 'Control token',
      'conn.tokenHint': 'The sidecar control token (config.json controlToken). Stored only in this browser.',
      'conn.tokenPlaceholder': 'Paste the controlToken from config.json',
      'conn.reload': 'Reload',
      'status.title': 'Sidecar status',
      'status.offline': 'Sidecar offline',
      'status.offlineHint': 'No chatgpt-web sidecar answered on 127.0.0.1:17841. Start it with "dsh-chatgpt-web serve" and reload this page.',
      'status.tokenMissing': 'No control token yet.',
      'status.tokenMissingHint': 'Paste the controlToken from config.json into the field above, then click Reload.',
      'status.tokenInvalid': 'Wrong control token.',
      'status.tokenInvalidHint': 'The sidecar answered but rejected the token. Paste the controlToken from config.json again.',
      'status.unreachable': 'Cannot reach the sidecar.',
      'status.unreachableHint': 'A token is set, but the request to 127.0.0.1:17841 failed. Check that the sidecar is running ("dsh-chatgpt-web serve") and that your browser is not blocking the cross-origin request.',
      'tuning.title': 'Transport limits',
      'tuning.hint': 'Applied from the next browser turn; no sidecar restart needed. Blank = default.',
      'tuning.save': 'Save',
      'tuning.restore': 'Restore defaults',
      'tuning.composerCharLimit': 'Composer character limit',
      'tuning.responseDomGraceMs': 'First-token grace floor (ms)',
      'tuning.responseDomGraceMaxMs': 'First-token grace ceiling (ms)',
      'tuning.responseDomGracePerCharMs': 'Grace growth per prompt char (ms)',
      'tuning.sendEnableGraceMs': 'Send-button grace (ms)',
      'tuning.turnTimeoutMs': 'Turn timeout (ms)',
      'turns.title': 'Recent browser turns',
      'turns.empty': 'No recorded turns yet.',
      'turns.time': 'Time',
      'turns.result': 'Result',
      'turns.turns': 'User / Assistant turns',
      'turns.error': 'Error',
      'convo.title': 'Conversation surface',
      'convo.hint': 'Where each turn runs. "Standard conversation" keeps one normal chat alive per DSH thread, so ChatGPT retains a document it is maintaining and can offer it for download every turn.',
      'convo.temporary': 'Temporary chat — a fresh chat every turn (nothing retained)',
      'convo.standard': 'Standard conversation — one chat kept alive, files persist on ChatGPT',
      'convo.temporaryNote': 'Nothing is written to your ChatGPT history, and generated files do not survive between turns.',
      'convo.standardNote': 'Chats are kept in your ChatGPT history. Downloads are saved to the sidecar downloads folder.',
      'convo.save': 'Save conversation mode',
      'convo.saved': 'Conversation mode saved. Takes effect from the next turn.',
      'convo.downloads': 'Recent downloads',
      'convo.noDownloads': 'No files downloaded yet.',
      'convo.downloadDir': 'Download folder',
      'convo.refresh': 'Refresh downloads',
      'convo.openFolder': 'Open folder',
      'convo.opened': 'Opened the downloads folder.',
      'summary.title': 'Active configuration',
      'summary.conversation': 'Conversation',
      'summary.compression': 'Compression',
      'summary.host': 'Browser host',
      'summary.dir': 'ChatGPT login',
      'convo.unavailable': 'Standard conversation needs the managed Chrome browser. This profile uses the launcher host, so the option is unavailable.',
      'convo.file': 'File',
      'convo.size': 'Size',
      'convo.time': 'Captured',
      'convo.path': 'Path',
      'compress.title': 'History compression',
      'compress.hint': 'How Luna carries conversation history across turns. Applies from the next turn; no sidecar restart needed.',
      'compress.auto': 'Auto (rolling checkpoint for Luna, native compaction elsewhere)',
      'compress.rolling': 'Rolling checkpoint — model writes a summary into every answer',
      'compress.native': 'Native compaction — client-issued compaction turns (standard Responses contract)',
      'compress.current': 'Current',
      'compress.rollingNote': 'Luna compaction turns are rejected with HTTP 409 while a rolling-checkpoint mode is active.',
      'compress.nativeNote': 'The client decides when to compact. DSH/Codex issues the standard compaction turn.',
      'compress.save': 'Save compression mode',
      'compress.saved': 'Compression mode saved. Applies from the next turn.',
      'notice.saved': 'Saved. New limits apply from the next turn.',
      'notice.reloaded': 'Reloaded.',
    };

    // 中文界面文案。键与 DICT_EN 一一对应；缺键时 locale 服务回退英文，
    // 所以这里必须与 DICT_EN 同步维护（见 scripts 校验）。
const DICT_ZH = {
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


    const CSS = `
      .cwg-root { display: flex; flex-direction: column; gap: 14px; padding: 4px 2px; box-sizing: border-box; max-width: 720px; }
      .cwg-root *, .cwg-root *::before, .cwg-root *::after { box-sizing: border-box; }
      .cwg-root h2 { margin: 0; font-size: 18px; font-weight: 600; color: var(--dsw-alias-label-primary); }
      .cwg-root h3 { margin: 0 0 10px; font-size: 13px; font-weight: 600; letter-spacing: .02em; color: var(--dsw-alias-label-secondary); text-transform: uppercase; }
      .cwg-card { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 14px; background: var(--dsw-alias-bg-layer-1); }
      .cwg-offline { border-color: var(--dsw-alias-border-l2); }
      .cwg-row { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
      .cwg-actions { justify-content: flex-start; }
      .cwg-muted { font-size: 12px; color: var(--dsw-alias-label-secondary); line-height: 1.4; }
      .cwg-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
      .cwg-label { font-size: 12px; color: var(--dsw-alias-label-primary); }
      .cwg-input { font-size: 13px; padding: 6px 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); min-width: 0; }
      .cwg-input:focus { outline: none; border-color: var(--dsw-alias-brand-primary); }
      .cwg-btn { font-size: 13px; padding: 6px 14px; border: 1px solid var(--dsw-alias-brand-primary); border-radius: 6px; background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); cursor: pointer; }
      .cwg-btn:disabled { opacity: .5; cursor: default; }
      .cwg-btn.cwg-secondary { background: transparent; color: var(--dsw-alias-brand-primary); }
      .cwg-notice { font-size: 12px; }
      .cwg-notice.cwg-ok { color: var(--dsw-alias-state-success-primary); }
      .cwg-notice.cwg-err { color: var(--dsw-alias-state-error-primary); }
      .cwg-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; }
      .cwg-cell { border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 8px 10px; background: var(--dsw-alias-bg-base); }
      .cwg-cell-label { font-size: 11px; color: var(--dsw-alias-label-secondary); margin-bottom: 2px; }
      .cwg-cell-value { font-size: 13px; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .cwg-table { width: 100%; border-collapse: collapse; font-size: 12px; }
      .cwg-table th { text-align: left; padding: 6px 8px; color: var(--dsw-alias-label-secondary); border-bottom: 1px solid var(--dsw-alias-border-l1); font-weight: 600; }
      .cwg-table td { padding: 6px 8px; color: var(--dsw-alias-label-primary); border-bottom: 1px solid var(--dsw-alias-border-l1); }
      .cwg-table .cwg-err { color: var(--dsw-alias-state-error-primary); }
      .cwg-table .cwg-ok { color: var(--dsw-alias-state-success-primary); }
      .cwg-radio { display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-base); cursor: pointer; margin-bottom: 8px; }
      .cwg-radio.cwg-selected { border-color: var(--dsw-alias-brand-primary); }
      .cwg-radio input { margin-top: 2px; }
      .cwg-radio-text { display: flex; flex-direction: column; gap: 2px; }
      .cwg-tag { font-size: 11px; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
    `;

    const NS = 'dsh-chatgpt-web';

    /** Wrap the bound translate so a missing key never throws and always yields a string. */
    function makeT(translate) {
      return (key, fallback) => {
        try {
          const value = typeof translate === 'function' ? translate(key) : undefined;
          return typeof value === 'string' && value ? value : fallback;
        } catch {
          return fallback;
        }
      };
    }

    function readToken() {
      try { return window.localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
    }
    function writeToken(value) {
      try { window.localStorage.setItem(TOKEN_KEY, value); } catch { /* private mode */ }
    }

    async function api(token, path, options) {
      const headers = { Authorization: `Bearer ${token}` };
      if (options && options.body) headers['Content-Type'] = 'application/json';
      const res = await fetch(BASE + path, { ...options, headers });
      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          if (data && typeof data.error === 'string') message = data.error;
        } catch { /* keep status message */ }
        // Carry the status so the caller can tell "the sidecar answered but rejected the
        // token" apart from "the sidecar did not answer at all".
        const error = new Error(message);
        error.status = res.status;
        throw error;
      }
      if (res.status === 204) return null;
      return res.json();
    }

    const TUNING_FIELDS = [
      ['composerCharLimit', 'tuning.composerCharLimit'],
      ['responseDomGraceMs', 'tuning.responseDomGraceMs'],
      ['responseDomGraceMaxMs', 'tuning.responseDomGraceMaxMs'],
      ['responseDomGracePerCharMs', 'tuning.responseDomGracePerCharMs'],
      ['sendEnableGraceMs', 'tuning.sendEnableGraceMs'],
      ['turnTimeoutMs', 'tuning.turnTimeoutMs'],
    ];

    function ChatGptWebSettings(t) {
      const [token, setToken] = React.useState(readToken);
      const [status, setStatus] = React.useState(null);
      const [configInfo, setConfigInfo] = React.useState(null);
      const [turns, setTurns] = React.useState([]);
      const [form, setForm] = React.useState({});
      const [convMode, setConvMode] = React.useState('temporary');
      const [convDraft, setConvDraft] = React.useState('temporary');
      const [convNotice, setConvNotice] = React.useState(null);
      const [downloads, setDownloads] = React.useState([]);
      const [downloadDir, setDownloadDir] = React.useState('');
      const [downloadsBusy, setDownloadsBusy] = React.useState(false);
      const [compressMode, setCompressMode] = React.useState('auto');
      const [compressDraft, setCompressDraft] = React.useState('auto');
      const [compressNotice, setCompressNotice] = React.useState(null);
      const [notice, setNotice] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      /**
       * Why no status is shown: 'tokenMissing' (nothing pasted yet), 'tokenInvalid'
       * (the sidecar answered 401) or 'unreachable' (the sidecar did not answer at all).
       * Before this existed every failure rendered the same "sidecar offline" card, which
       * told the user to start a sidecar that was already running.
       */
      const [statusError, setStatusError] = React.useState(null);

      async function loadAll(currentToken) {
        if (!currentToken) { setStatus(null); setStatusError('tokenMissing'); return; }
        setBusy(true);
        try {
          const [st, cfg, rt] = await Promise.all([
            api(currentToken, '/v1/control/status'),
            api(currentToken, '/v1/control/config'),
            api(currentToken, '/v1/control/recent-turns?limit=10'),
          ]);
          setStatus(st);
          setConfigInfo(cfg);
          const mode = cfg.compressionMode || (st && st.compressionMode) || 'auto';
          setCompressMode(mode);
          setCompressDraft(mode);
          const conv = cfg.conversationMode || 'temporary';
          setConvMode(conv);
          setConvDraft(conv);
          try {
            const dl = await api(currentToken, '/v1/control/downloads');
            setDownloads(Array.isArray(dl.files) ? dl.files : []);
            setDownloadDir(typeof dl.directory === 'string' ? dl.directory : '');
          } catch { setDownloads([]); setDownloadDir(''); }
          setTurns(rt.turns || []);
          const next = {};
          for (const [field] of TUNING_FIELDS) {
            next[field] = cfg.tuning && cfg.tuning[field] !== undefined ? String(cfg.tuning[field]) : '';
          }
          setForm(next);
          setStatusError(null);
        } catch (error) {
          setStatus(null);
          // A 401 means the sidecar is alive but the token is wrong; a network failure
          // means we never reached it. The two need different advice.
          const status = error && typeof error.status === 'number' ? error.status : undefined;
          setStatusError(status === 401 ? 'tokenInvalid' : 'unreachable');
          setNotice({ kind: 'err', text: error instanceof Error ? error.message : String(error) });
        } finally {
          setBusy(false);
        }
      }

      React.useEffect(() => { loadAll(token); }, [token]);

      async function save(tuning) {
        setBusy(true);
        try {
          await api(token, '/v1/control/config', { method: 'PUT', body: JSON.stringify({ tuning }) });
          setNotice({ kind: 'ok', text: t('notice.saved', '已保存，新限制从下一轮起生效。') });
          await loadAll(token);
        } catch (error) {
          setNotice({ kind: 'err', text: error instanceof Error ? error.message : String(error) });
        } finally {
          setBusy(false);
        }
      }

      async function openDownloadsFolder() {
        if (!token) return;
        try {
          await api(token, '/v1/control/open-downloads', { method: 'POST' });
          setConvNotice({ kind: 'ok', text: t('convo.opened', '已打开下载目录。') });
        } catch (error) {
          setConvNotice({ kind: 'err', text: error instanceof Error ? error.message : String(error) });
        }
      }

      async function refreshDownloads() {
        if (!token) return;
        setDownloadsBusy(true);
        try {
          const dl = await api(token, '/v1/control/downloads');
          setDownloads(Array.isArray(dl.files) ? dl.files : []);
          setDownloadDir(typeof dl.directory === 'string' ? dl.directory : '');
        } catch (error) {
          setConvNotice({ kind: 'err', text: error instanceof Error ? error.message : String(error) });
        } finally {
          setDownloadsBusy(false);
        }
      }

      async function saveConversation(mode) {
        setBusy(true);
        setConvNotice(null);
        try {
          await api(token, '/v1/control/config', { method: 'PUT', body: JSON.stringify({ conversationMode: mode }) });
          setConvMode(mode);
          setConvDraft(mode);
          setConvNotice({ kind: 'ok', text: t('convo.saved', '会话模式已保存，从下一轮起生效。') });
          await loadAll(token);
        } catch (error) {
          setConvNotice({ kind: 'err', text: error instanceof Error ? error.message : String(error) });
        } finally {
          setBusy(false);
        }
      }

      async function saveCompression(mode) {
        setBusy(true);
        setCompressNotice(null);
        try {
          await api(token, '/v1/control/config', { method: 'PUT', body: JSON.stringify({ compressionMode: mode }) });
          setCompressMode(mode);
          setCompressDraft(mode);
          setCompressNotice({ kind: 'ok', text: t('compress.saved', '压缩方式已保存，从下一轮起生效。') });
          await loadAll(token);
        } catch (error) {
          setCompressNotice({ kind: 'err', text: error instanceof Error ? error.message : String(error) });
        } finally {
          setBusy(false);
        }
      }

      function onSave() {
        const tuning = {};
        for (const [field] of TUNING_FIELDS) {
          const raw = (form[field] || '').trim();
          if (raw) tuning[field] = Number(raw);
        }
        if (Object.keys(tuning).length === 0) {
          setNotice({ kind: 'err', text: '请至少填写一项限制再保存。' });
          return;
        }
        save(tuning);
      }

      function onRestore() {
        if (configInfo && configInfo.defaults) save({ ...configInfo.defaults });
      }

      const fmtUptime = (seconds) => {
        const s = Math.floor(seconds);
        const hr = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        return hr > 0 ? `${hr}h ${m}m` : `${m}m ${s % 60}s`;
      };

      const rows = status ? [
        ['版本', status.version],
        ['进程 ID', String(status.pid)],
        ['运行时长', fmtUptime(status.uptime)],
        ['接受新任务', status.accepting_turns ? '是' : '否'],
        ['进行中的 HTTP / 浏览器轮次', `${status.active_http_turns} / ${status.active_browser_turns}`],
        ['登录状态', status.storageStatePresent ? '已验证' : '缺失'],
        ['存储目录', status.storageDir],
        ['Chrome 路径', status.chromeExecutablePath],
        ['可视化窗口', status.headed ? '是' : '否'],
        ['Sol / Pro 账号', `${status.solAvailable ? '是' : '否'} / ${status.proAvailable ? '是' : '否'}`],
      ] : [];

      return h('div', { className: 'cwg-root' },
        h('style', null, CSS),
        h('h2', null, t('section.title', 'ChatGPT 网页版')),

        h('section', { className: 'cwg-card' },
          h('h3', null, t('conn.title', '连接')),
          h('label', { className: 'cwg-field' },
            h('span', { className: 'cwg-label' }, t('conn.token', '控制令牌')),
            h('input', {
              className: 'cwg-input',
              type: 'password',
              value: token,
              // This used to be a hardcoded "FJ86_" + ellipsis, which read like a real
              // (partial) token and sent users hunting for a token that does not exist.
              // Say what to paste instead.
              placeholder: t('conn.tokenPlaceholder', '粘贴 config.json 里的 controlToken'),
              onChange: (e) => { setToken(e.target.value); writeToken(e.target.value); },
            }),
          ),
          h('div', { className: 'cwg-row' },
            h('span', { className: 'cwg-muted' }, t('conn.tokenHint', '侧车控制令牌（config.json 中的 controlToken），只保存在本浏览器。')),
          ),
          h('div', { className: 'cwg-row cwg-actions' },
            h('button', {
              className: 'cwg-btn',
              disabled: busy || !token,
              onClick: () => { loadAll(token); setNotice({ kind: 'ok', text: t('notice.reloaded', '已重新加载。') }); },
            }, t('conn.reload', '重新加载')),
            notice ? h('span', { className: `cwg-notice cwg-${notice.kind}` }, notice.text) : null,
          ),
        ),

        configInfo
          ? h('section', { className: 'cwg-card' },
              h('h3', null, t('summary.title', '当前配置')),
              h('div', { className: 'cwg-grid' },
                [
                  [t('summary.conversation', '会话模式'), convMode === 'standard'
                    ? t('convo.standard', '标准会话')
                    : t('convo.temporary', '临时聊天')],
                  [t('summary.compression', '压缩方式'), compressMode],
                  [t('summary.host', '浏览器宿主'),
                    (status && status.browserHost) ? status.browserHost : 'managed-chrome'],
                  [t('summary.dir', 'ChatGPT 登录'),
                    (status && status.storageStatePresent) ? 'verified' : 'missing'],
                ].map(([label, value]) => h('div', { key: label, className: 'cwg-cell' },
                  h('div', { className: 'cwg-cell-label' }, label),
                  h('div', { className: 'cwg-cell-value', title: String(value) }, String(value)),
                )),
              ),
            )
          : null,

        status
          ? h('section', { className: 'cwg-card' },
              h('h3', null, t('status.title', '侧车状态')),
              h('div', { className: 'cwg-grid' },
                rows.map(([label, value]) => h('div', { key: label, className: 'cwg-cell' },
                  h('div', { className: 'cwg-cell-label' }, label),
                  h('div', { className: 'cwg-cell-value', title: String(value) }, String(value)),
                )),
              ),
            )
          : h('section', { className: 'cwg-card cwg-offline' },
              h('h3', null, statusError === 'tokenMissing'
                ? t('status.tokenMissing', '尚未填写控制令牌。')
                : statusError === 'tokenInvalid'
                  ? t('status.tokenInvalid', '控制令牌不正确。')
                  : t('status.offline', '侧车未运行')),
              h('p', { className: 'cwg-muted' }, statusError === 'tokenMissing'
                ? t('status.tokenMissingHint', '请把 config.json 里的 controlToken 粘贴到上面的输入框，然后点「重新加载」。')
                : statusError === 'tokenInvalid'
                  ? t('status.tokenInvalidHint', '侧车已响应，但拒绝了当前令牌。请重新粘贴 config.json 里的 controlToken。')
                  : t('status.unreachableHint', '令牌已填，但访问 127.0.0.1:17841 失败。请确认侧车正在运行（"dsh-chatgpt-web serve"），并检查浏览器是否拦截了跨域请求。')),
            ),

        configInfo
          ? h('section', { className: 'cwg-card' },
              h('h3', null, t('convo.title', '会话模式')),
              h('p', { className: 'cwg-muted' }, t('convo.hint', '决定每一轮在哪里运行。「标准会话」会为每个 DSH 会话保留一个常驻的普通对话，ChatGPT 因此能保留它正在维护的文档，并在每轮提供下载。')),
              ['temporary', 'standard'].map((mode) => {
                const labelKey = mode === 'standard' ? 'convo.standard' : 'convo.temporary';
                const fallback = mode === 'standard'
                  ? 'Standard conversation — one chat kept alive, files persist on ChatGPT'
                  : 'Temporary chat — a fresh chat every turn (nothing retained)';
                return h('label', {
                  key: mode,
                  className: 'cwg-radio' + (convDraft === mode ? ' cwg-selected' : ''),
                },
                  h('input', {
                    type: 'radio', name: 'cwg-convo', value: mode,
                    checked: convDraft === mode,
                    onChange: () => setConvDraft(mode),
                  }),
                  h('span', { className: 'cwg-radio-text' },
                    h('span', null, t(labelKey, fallback)),
                    convMode === mode ? h('span', { className: 'cwg-tag' }, t('compress.current', '当前')) : null,
                  ),
                );
              }),
              h('p', { className: 'cwg-muted' },
                convDraft === 'standard'
                  ? t('convo.standardNote', '对话会保留在 ChatGPT 历史中。下载的文件保存在侧车的下载目录。')
                  : t('convo.temporaryNote', '不会写入你的 ChatGPT 历史，生成的文件在下一轮之前就会消失。'),
              ),
              h('div', { className: 'cwg-row cwg-actions' },
                h('button', {
                  className: 'cwg-btn',
                  disabled: busy || convDraft === convMode,
                  onClick: () => saveConversation(convDraft),
                }, t('convo.save', '保存会话模式')),
                convNotice ? h('span', { className: 'cwg-notice cwg-' + convNotice.kind }, convNotice.text) : null,
              ),
              convMode === 'standard'
                ? h('div', null,
                    h('div', { className: 'cwg-row', style: { marginTop: '12px', alignItems: 'baseline', gap: '8px' } },
                      h('span', { className: 'cwg-muted', style: { fontWeight: 600 } }, t('convo.downloads', '最近下载')),
                      h('button', {
                        className: 'cwg-btn cwg-secondary',
                        style: { padding: '2px 10px', fontSize: '12px' },
                        disabled: downloadsBusy,
                        onClick: refreshDownloads,
                      }, t('convo.refresh', '刷新列表')),
                      h('button', {
                        className: 'cwg-btn cwg-secondary',
                        style: { padding: '2px 10px', fontSize: '12px' },
                        onClick: openDownloadsFolder,
                      }, t('convo.openFolder', '打开文件夹')),
                      h('span', { className: 'cwg-muted' }, `${downloads.length}`),
                    ),
                    downloadDir
                      ? h('p', { className: 'cwg-muted', style: { marginTop: '4px', wordBreak: 'break-all' } },
                          `${t('convo.downloadDir', '下载目录')}: ${downloadDir}`)
                      : null,
                    downloads.length === 0
                      ? h('p', { className: 'cwg-muted', style: { marginTop: '6px' } }, t('convo.noDownloads', '还没有下载任何文件。'))
                      : h('table', { className: 'cwg-table', style: { marginTop: '6px' } },
                          h('thead', null, h('tr', null,
                            h('th', null, t('convo.file', '文件名')),
                            h('th', null, t('convo.size', '大小')),
                            h('th', null, t('convo.time', '保存时间')),
                            h('th', null, t('convo.path', '完整路径')),
                          )),
                          h('tbody', null, downloads.map((d) => h('tr', { key: d.absolutePath },
                            h('td', null, d.fileName),
                            h('td', null, typeof d.bytes === 'number' ? `${Math.max(1, Math.round(d.bytes / 1024))} KB` : ''),
                            h('td', null, d.capturedAt ? new Date(d.capturedAt).toLocaleString() : ''),
                            h('td', { title: d.absolutePath, style: { maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, d.absolutePath),
                          ))),
                        ),
                  )
                : null,
            )
          : null,

        configInfo
          ? h('section', { className: 'cwg-card' },
              h('h3', null, t('compress.title', '历史压缩方式')),
              h('p', { className: 'cwg-muted' }, t('compress.hint', '决定 Luna 如何在轮次之间携带对话历史。从下一轮起生效，无需重启侧车。')),
              ['auto', 'rolling-checkpoint', 'native-compaction'].map((mode) => {
                const labelKey = mode === 'native-compaction' ? 'compress.native' : mode === 'rolling-checkpoint' ? 'compress.rolling' : 'compress.auto';
                const fallback = mode === 'native-compaction'
                  ? 'Native compaction — client-issued compaction turns (standard Responses contract)'
                  : mode === 'rolling-checkpoint'
                    ? 'Rolling checkpoint — model writes a summary into every answer'
                    : 'Auto (rolling checkpoint for Luna, native compaction elsewhere)';
                return h('label', {
                  key: mode,
                  className: 'cwg-radio' + (compressDraft === mode ? ' cwg-selected' : ''),
                },
                  h('input', {
                    type: 'radio',
                    name: 'cwg-compress',
                    value: mode,
                    checked: compressDraft === mode,
                    onChange: () => setCompressDraft(mode),
                  }),
                  h('span', { className: 'cwg-radio-text' },
                    h('span', null, t(labelKey, fallback)),
                    compressMode === mode ? h('span', { className: 'cwg-tag' }, t('compress.current', '当前')) : null,
                  ),
                );
              }),
              h('p', { className: 'cwg-muted' },
                compressDraft === 'native-compaction'
                  ? t('compress.nativeNote', '由客户端决定何时压缩，DSH/Codex 会发起标准的压缩轮。')
                  : t('compress.rollingNote', '当前为滚动检查点模式，Luna 的压缩请求会返回 HTTP 409。'),
              ),
              h('div', { className: 'cwg-row cwg-actions' },
                h('button', {
                  className: 'cwg-btn',
                  disabled: busy || compressDraft === compressMode,
                  onClick: () => saveCompression(compressDraft),
                }, t('compress.save', '保存压缩方式')),
                compressNotice ? h('span', { className: 'cwg-notice cwg-' + compressNotice.kind }, compressNotice.text) : null,
              ),
            )
          : null,

        configInfo
          ? h('section', { className: 'cwg-card' },
              h('h3', null, t('tuning.title', '传输限制')),
              h('p', { className: 'cwg-muted' }, t('tuning.hint', '从下一轮对话起生效，无需重启侧车。留空表示使用默认值。')),
              h('div', null,
                TUNING_FIELDS.map(([field, key]) => h('label', { key: field, className: 'cwg-field' },
                  h('span', { className: 'cwg-label' },
                    t(key, field),
                    configInfo.effective && configInfo.effective[field] !== undefined
                      ? h('span', { className: 'cwg-muted' }, ` (effective ${configInfo.effective[field]})`)
                      : null,
                  ),
                  h('input', {
                    className: 'cwg-input',
                    type: 'number',
                    value: form[field] || '',
                    placeholder: configInfo.effective && configInfo.effective[field] !== undefined ? String(configInfo.effective[field]) : '',
                    onChange: (e) => setForm({ ...form, [field]: e.target.value }),
                  }),
                )),
              ),
              h('div', { className: 'cwg-row cwg-actions' },
                h('button', { className: 'cwg-btn', disabled: busy, onClick: onSave }, t('tuning.save', '保存')),
                h('button', { className: 'cwg-btn cwg-secondary', disabled: busy, onClick: onRestore }, t('tuning.restore', '恢复默认')),
              ),
            )
          : null,

        h('section', { className: 'cwg-card' },
          h('h3', null, t('turns.title', '最近的浏览器轮次')),
          turns.length === 0
            ? h('p', { className: 'cwg-muted' }, t('turns.empty', '暂无记录。'))
            : h('table', { className: 'cwg-table' },
                h('thead', null, h('tr', null,
                  h('th', null, t('turns.time', '时间')),
                  h('th', null, t('turns.result', '结果')),
                  h('th', null, t('turns.turns', '用户 / 助手轮次')),
                  h('th', null, t('turns.error', '错误')),
                )),
                h('tbody', null, turns.map((turn) => h('tr', { key: turn.traceId },
                  h('td', null, turn.capturedAt ? new Date(turn.capturedAt).toLocaleString() : '—'),
                  h('td', { className: turn.error ? 'cwg-err' : 'cwg-ok' }, turn.checkpoint || '—'),
                  h('td', null, `${turn.userTurns} / ${turn.assistantTurns}`),
                  h('td', { className: 'cwg-muted', title: turn.error || '' }, turn.error ? (turn.error.length > 80 ? `${turn.error.slice(0, 80)}…` : turn.error) : '—'),
                ))),
              ),
        ),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        // Register this plugin's English dictionary; the locale service owns the active locale.
        ctx.effect(() => {
          try {
            return ctx.locale.register(NS, { en: DICT_EN, zh: DICT_ZH, 'zh-CN': DICT_ZH });
          } catch {
            return () => {};
          }
        }, 'dsh-chatgpt-web: dictionaries');
        let translate;
        try {
          translate = ctx.locale.bind(NS);
        } catch {
          translate = undefined;
        }
        const t = makeT(translate);
        const Page = () => ChatGptWebSettings(t);
        return ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'chatgpt-web',
          order: 35,
          label: () => t('section.title', 'ChatGPT 网页版'),
        }, Page));
      },
    };
  },
});
