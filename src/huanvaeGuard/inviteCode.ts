/**
 * VPN 群组邀请码的合成与解析（纯逻辑，零 import）
 *
 * ## 为什么单独成文件
 * 本仓测试规范要求：纯逻辑抽到无依赖模块才能零 mock 单测
 * （HuanvaeGuardPage.tsx 顶层 import 了 `@tauri-apps/plugin-os` / `@tauri-apps/api/event`，
 *  从它 import 任何东西都会拖起整条 Tauri 模块加载链）。
 * 所以本文件**不得**引入任何 import —— React / Tauri / 本仓其它模块一概不许。
 *
 * ## 解决的问题
 * 邀请方拿到 `groupId` + `invite_token` **两个**值，被邀请方过去要在两个输入框里分别粘贴两次，
 * 粘错一个就报"参数错误"且看不出是哪一个错。合成成一个可识别、带版本前缀的码之后，
 * 粘一次即可；解析失败则原样落回手动分别输入（**不猜、不兜底**）。
 *
 * ## 暴露面（必须守住）
 * 🔴 码内**只含 groupId + token 两个值**，与用户今天已经在分享的完全相同，
 * **不夹带任何其它字段**（用户 ID / 服务器地址 / 设备信息一概不许进来）。
 * 合成本身不增加任何暴露面 —— 这是本模块的设计前提，改动时必须重新审视这一条。
 *
 * ## 码的形态
 * `HGG1-<base64url(JSON.stringify([groupId, token]))>`
 * - `HGG1` = HuanvaeGuard Group v1：既可被人一眼认出，也给将来留了版本位
 * - base64url = 标准 base64 后 `+`→`-`、`/`→`_`、去掉尾部 `=`（可安全出现在 URL / 聊天消息里）
 */

/** 群组邀请码的版本化前缀。解析时**必须**命中它，否则一律判为非邀请码。 */
export const GROUP_INVITE_PREFIX = 'HGG1-';

/** UTF-8 安全的 base64url 编码（groupId / token 理论上是 ASCII，但不做此假设）。 */
function encodeBase64Url(text: string): string {
  const base64 = btoa(unescape(encodeURIComponent(text)));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url 解码；任何不合规输入（非法字符 / 长度不对 / 非 UTF-8 字节）一律返回 null。 */
function decodeBase64Url(payload: string): string | null {
  // 先按字符集严格校验：atob 会忽略空白字符，不先拦一道就会把 `HGG1-a b c` 这类脏码放进来
  if (!/^[A-Za-z0-9_-]+$/.test(payload)) {
    return null;
  }
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  try {
    return decodeURIComponent(escape(atob(`${base64}${padding}`)));
  } catch {
    // atob 的 InvalidCharacterError / decodeURIComponent 的 URIError —— 都说明这不是我们发的码
    return null;
  }
}

/**
 * 把 groupId + token 合成一个邀请码。
 *
 * @returns 两者都非空（trim 后）才产出邀请码；否则返回 null（调用方应跳过展示，不许渲染 "null"）
 */
export function encodeGroupInvite(groupId: string, token: string): string | null {
  if (groupId.trim() === '' || token.trim() === '') {
    return null;
  }
  return `${GROUP_INVITE_PREFIX}${encodeBase64Url(JSON.stringify([groupId, token]))}`;
}

/**
 * 解析邀请码。
 *
 * 严格校验，**任何**不合规形态一律返回 null，调用方落回手动输入 ——
 * 这里刻意不做任何"猜测式修复"（补前缀 / 补padding 之外的容错 / 取数组前两项），
 * 猜错的后果是把用户导向一个错误的群组，比直接说"认不出来"糟得多。
 *
 * 校验链：前缀 → base64url → JSON → 必须是数组 → 长度恰好 2 → 两元素均为 trim 后非空字符串。
 */
export function decodeGroupInvite(code: string): { groupId: string; token: string } | null {
  // 用户从聊天窗口复制常带首尾空白，这一层容错是"清洗"不是"猜测"，允许
  const trimmed = code.trim();
  if (!trimmed.startsWith(GROUP_INVITE_PREFIX)) {
    return null;
  }
  const json = decodeBase64Url(trimmed.slice(GROUP_INVITE_PREFIX.length));
  if (json === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) {
    return null;
  }
  const [groupId, token] = parsed as unknown[];
  if (typeof groupId !== 'string' || typeof token !== 'string') {
    return null;
  }
  if (groupId.trim() === '' || token.trim() === '') {
    return null;
  }
  return { groupId, token };
}
