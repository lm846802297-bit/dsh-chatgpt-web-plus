/**
 * 集中式界面文案匹配表。
 *
 * 这个插件原本把英文字面量散落在各处选择器里（`aria-label="Send"`、
 * `getByRole("button", { name: "Deny" })` ……）。ChatGPT 网页按用户语言渲染
 * aria-label 与按钮文案，所以任何非英文界面都会让这些匹配静默失效，症状是
 * 阶段超时或「找不到控件」，而不是明确的语言错误。
 *
 * 所有界面文案的匹配都从这里取，新增语言只改这一处。
 */

/** 把若干候选词合成一个大小写不敏感的完整匹配正则（用于 getByRole name）。 */
export function exactName(...names: string[]): RegExp {
  return new RegExp(`^(?:${names.map(escapeRe).join("|")})$`, "i");
}

/** 把若干候选词合成一个大小写不敏感的子串匹配正则（用于 hasText / filter）。 */
export function anyText(...names: string[]): RegExp {
  return new RegExp(names.map(escapeRe).join("|"), "i");
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 发送消息的按钮。作为 aria-label 出现。 */
export const SEND_LABELS = [
  "Send",
  "发送", "發送",
  "送信",
  "Отправить",
  "Enviar",
  "Envoyer",
  "Senden",
] as const;

/** 停止生成的按钮。 */
export const STOP_LABELS = [
  "Stop",
  "停止", "停止生成", "停止回應", "停止回应", "中止",
  "中止生成",
  "Остановить",
  "Detener",
  "Arrêter",
] as const;

/** 复制回复的按钮——同时是「本轮已生成完毕」的唯一信号（见 BUG-6）。 */
export const COPY_LABELS = [
  "Copy",
  "复制", "複製",
  "コピー",
  "Копировать",
  "Copiar",
  "Copier",
] as const;

/** 临时聊天首次进入时的确认弹窗正文片段（用于识别弹窗本体）。 */
export const TEMPORARY_CHAT_DIALOG_TEXT = [
  "Not in history",
  "不会显示在历史记录中",
  "不會顯示在歷史記錄中",
  "履歴に表示されません",
  "не сохраняется в истории",
  "no aparecerá en el historial",
] as const;

/** 上面那个弹窗的确认按钮。 */
export const CONTINUE_LABELS = [
  "Continue",
  "继续", "繼續",
  "継続",
  "Продолжить",
  "Continuar",
  "Continuer",
] as const;

/** 临时聊天的个性化开关：已开启态。 */
export const PERSONALIZED_LABELS = [
  "Personalized",
  "个性化", "個人化", "已个性化", "已個人化",
  "パーソナライズ済み",
  "Персонализировано",
  "Personalizado",
] as const;

/** 临时聊天的个性化开关：未开启态。 */
export const UNPERSONALIZED_LABELS = [
  "Unpersonalized",
  "非个性化", "未个性化", "未個人化",
  "パーソナライズされていない",
  "Не персонализировано",
  "Sin personalizar",
] as const;

/** 个性化下拉里「切换到个性化」的选项（以这些词开头）。 */
export const PERSONALIZED_CHOICE_PREFIXES = [
  "Personalized",
  "个性化", "個人化", "已个性化", "已個人化",
  "パーソナライズ",
  "Персонализировать",
] as const;

/** 权限/授权弹窗的拒绝按钮。 */
export const DENY_LABELS = [
  "Deny",
  "拒绝", "拒絕", "不允许", "不允許", "拒绝并继续", "拒絕並繼續",
  "拒否",
  "Отклонить",
  "Denegar",
  "Refuser",
] as const;

/** 「允许 ChatGPT 使用 <应用名>」这类授权弹窗正文。 */
export const ALLOW_APP_TEXT = [
  (appName: string) => `Allow ChatGPT to use ${appName}`,
  (appName: string) => `允许 ChatGPT 使用 ${appName}`,
  (appName: string) => `允許 ChatGPT 使用 ${appName}`,
  (appName: string) => `ChatGPT が ${appName} を使用することを許可`,
  (appName: string) => `Разрешить ChatGPT использовать ${appName}`,
] as const;

/** 订阅信息加载失败的告警。 */
export const SUBSCRIPTION_FAILURE_TEXT = [
  "Failed to load subscription",
  "加载订阅信息失败", "載入訂閱資訊失敗", "订阅信息加载失败",
  "サブスクリプションの読み込みに失敗",
  "Не удалось загрузить подписку",
] as const;

/** 会话过期告警。 */
export const SESSION_EXPIRED_TEXT = [
  "Your session has expired",
  "你的会话已过期", "您的会话已过期",
  "你的工作階段已過期", "您的工作階段已過期",
  "会话已失效", "工作階段已失效",
  "登录已过期", "登入已過期",
  "セッションの有効期限が切れ",
  "Срок действия сеанса истёк",
] as const;

/** 限流弹窗。 */
export const RATE_LIMIT_TITLE_TEXT = [
  "Too many requests", "太多要求", "太多请求", "请求过于频繁",
  "リクエストが多すぎます",
] as const;

export const RATE_LIMIT_BODY_TEXT = [
  "making requests too quickly", "过于频繁", "過於頻繁",
  "リクエストの頻度が高すぎます",
] as const;

/** 限流弹窗的确认按钮。 */
export const GOT_IT_LABELS = ["Got it", "知道了", "了解", "OK", "确定", "確定"] as const;

/** 生成中（用于 BUG-6 的备用完成证据）。 */
export const GENERATING_HINTS_TEXT = [
  "Thinking", "思考", "推理中",
  "思考中", "実行中", "Думает",
] as const;
