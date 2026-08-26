/**
 * NFC NDEF URI Record 解析 + 白名单指令提取 + payload hash 计算
 *
 * 关键约定：
 * - URI Record TNF=1, type=0x55；payload[0] 为 prefix code，余下为 UTF-8 URI 字节
 * - 自定义 scheme `huanvae://` 用 prefix code 0x00（无前缀）
 * - payload_hash = SHA-256 hex of 整个 payload bytes（含 prefix code）
 *   — prefix code 变化也算 payload 变化，更严格防卡片改写
 *
 * 不做的事：
 * - 不解码非 URI Record（TNF=1 type=T 文本 Record 等）—— 调用方负责筛选
 * - 不调 Tauri command（纯函数，可单元测试）
 */

import type { NfcAction } from './types';

/** NDEF URI Record prefix code 表（仅含 v1 需要的子集） */
const URI_PREFIX_TABLE: Record<number, string> = {
  0x00: '',
  0x01: 'http://www.',
  0x02: 'https://www.',
  0x03: 'http://',
  0x04: 'https://',
};

/** byte 数组 → 小写 hex（无分隔符） */
export function bytesToHex(bytes: number[]): string {
  return bytes.map((b) => (b & 0xff).toString(16).padStart(2, '0')).join('');
}

/**
 * NDEF URI Record payload → 完整 URI 字符串
 * 越界 prefix code 或 payload 长度不足 → 返 ''（调用方判定为无效）
 */
export function decodeNdefUriPayload(payload: number[]): string {
  const prefixCode = payload?.[0];
  if (prefixCode === undefined) {
    return '';
  }
  const prefix = URI_PREFIX_TABLE[prefixCode];
  if (prefix === undefined) {
    return '';
  }
  const rest = payload.slice(1);
  if (rest.length === 0) {
    return prefix;
  }
  try {
    const decoder = new TextDecoder('utf-8', { fatal: false });
    return prefix + decoder.decode(new Uint8Array(rest));
  } catch {
    return '';
  }
}

/**
 * 计算 NDEF payload 的 SHA-256 hash（hex 字符串）
 * 范围 = 整个 payload bytes（含 prefix code byte）—— 更严格防卡片改写
 */
export async function computePayloadHash(payload: number[]): Promise<string> {
  const buf = new Uint8Array(payload).buffer;
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return bytesToHex(Array.from(new Uint8Array(digest)));
}

/**
 * base64 字符串 → 任意 JSON（解析失败抛错）
 * v1 仅给 http/request 的 body 字段使用
 */
function decodeBase64Json(b64: string): unknown {
  // 浏览器 atob：base64 → binary string；再 TextEncoder→UTF-8 → JSON.parse
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) { bytes[i] = bin.charCodeAt(i); }
  const json = new TextDecoder('utf-8').decode(bytes);
  return JSON.parse(json);
}

/**
 * URI → 白名单 NfcAction
 * 不在白名单 / 参数缺失 / URL 不合法 / body 解码失败 → 返 null
 */
/**
 * 群 ID 形态（后端 `Uuid`，`GET /{group_id}/qr` 的 payload 里那一段）。
 *
 * 大小写都收：`Uuid::to_string()` 出的是小写，但二维码经第三方扫码器转手时被大写化过的样本存在。
 */
const GROUP_ID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function parseAction(uri: string): NfcAction | null {
  if (!uri.startsWith('huanvae://')) { return null; }

  // 用 URL 解析时把 huanvae:// 替换为 https:// 临时 host 解析；保留原 path/query
  // 这是为了避免某些 URL 实现对自定义 scheme 处理不一致
  let parsed: URL;
  try {
    parsed = new URL(uri.replace(/^huanvae:\/\//, 'https://placeholder.invalid/'));
  } catch {
    return null;
  }
  // pathname 形如 /miniapp/open
  const path = parsed.pathname.replace(/^\//, '');
  const query = parsed.searchParams;

  if (path === 'miniapp/open') {
    const id = query.get('id');
    if (!id) { return null; }
    return { kind: 'miniapp/open', miniappId: id };
  }

  if (path === 'group/join') {
    const id = query.get('id');
    if (!id) { return null; }
    // 🔴 必须校验 UUID 形态：这个值会被直接拼进 `GET /api/groups/{id}/public` 的路径。
    // 不校验的话，任意串都会被当群 ID 发出去 —— 而"群不存在"的 404 与"我给了个垃圾串"
    // 在界面上完全同形，用户只会看到一句无法解释的失败。
    if (!GROUP_ID_RE.test(id)) { return null; }
    return { kind: 'group/join', groupId: id };
  }

  if (path === 'http/request') {
    const url = query.get('url');
    const method = (query.get('method') ?? 'GET').toUpperCase();
    const body64 = query.get('body');
    if (!url) { return null; }
    try {
      // 校验 url 是合法 HTTP/HTTPS URL
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') { return null; }
    } catch {
      return null;
    }
    if (method !== 'GET' && method !== 'POST') { return null; }
    let body: unknown | null = null;
    if (body64) {
      // GET 不允许携带 body：fetch 规范禁止 GET+body，且攻击者借此可在 modal 摘要看不到处藏数据
      if (method === 'GET') { return null; }
      try {
        body = decodeBase64Json(body64);
      } catch {
        return null;
      }
    }
    return { kind: 'http/request', url, method, body };
  }

  return null;
}

/** Action → 用户可读摘要（modal 显示用）
 *
 * http/request 显示 host + path 截断版（>40 字符截断），让用户能判断"打到哪个 endpoint"
 * 而非仅看域名 — 仅 host 不足以暴露恶意 path（如 /admin/delete?id=42）。
 */
export function summarizeAction(action: NfcAction): string {
  if (action.kind === 'miniapp/open') {
    return `打开小程序: ${action.miniappId}`;
  }
  if (action.kind === 'group/join') {
    // 只说"打开群详情"，不说"加入群聊" —— 这一步不加任何群，加不加由用户在详情面板上再点一次。
    return `打开群聊: ${action.groupId}`;
  }
  // http/request — 显示 host + 截断 path
  let display = action.url;
  try {
    const u = new URL(action.url);
    const path = u.pathname.length > 40 ? `${u.pathname.slice(0, 40)}…` : u.pathname;
    display = `${u.host}${path}`;
  } catch {
    // 已在 parseAction 中校验，此处理论不会落入
  }
  return `${action.method} 请求: ${display}`;
}
