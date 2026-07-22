/**
 * 沙箱逃逸阀(R3)— App 侧机制。**默认关闭、仅机制就位**。
 *
 * 声明式白名单渲染器表达不了的富交互卡片,走独立 WebviewWindow(非主窗 iframe):
 * - **来源白名单**:仅 http/https 且 origin ∈ SANDBOX_ESCAPE_ALLOWED_ORIGINS 才允许打开,
 *   默认空名单 = 全拒;总开关 SANDBOX_ESCAPE_ENABLED 默认 false,开启是显式产品决策。
 * - **initData 式 HMAC 鉴权**:开窗 URL 携带 auth_date/nonce(可选 card_id)字段 +
 *   对字段字典序 data-check-string 的 HMAC-SHA256 签名(hash query 参数),子窗口内容侧
 *   用共享 secret 验签后信任初始数据。
 * - **逐卡 gate**:sandbox 节点渲染处按开关判定,关闭时一律惰性占位,绝不渲染卡片自带 url。
 * - **URL 收口**:开窗 URL 一律经 proxyRequestUrl(私有 CA 回环反代)改写。
 * - 严格 CSP(frame-src/script-src 白名单)由反代/服务端在内容响应头上强制,
 *   非 App 侧职责——App 侧只做来源白名单 + 签名 + 独立窗口。
 *
 * URL/签名编解码抽成纯函数(isSandboxEscapeAllowed / buildSandboxDataCheckString /
 * signSandboxInitData / buildSandboxWindowUrl),避开 WebviewWindow 静态方法的测试 mock 缺口,
 * 单测零 Tauri 依赖(对齐 stocks/window 先例)。
 */

import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { proxyRequestUrl } from '../../services/secureProxy';
import { isMobile } from '../../utils/platform';

/** 逃逸阀总开关:默认关闭。开启是显式产品决策,非配置项外泄。 */
export const SANDBOX_ESCAPE_ENABLED = false;

/** 允许打开的内容来源 origin 白名单:默认空(全拒)。 */
export const SANDBOX_ESCAPE_ALLOWED_ORIGINS: readonly string[] = [];

/** 逃逸窗口 label(getByLabel 聚焦复用,全 App 单例) */
const SANDBOX_WINDOW_LABEL = 'card-sandbox';

/**
 * 判定目标 URL 是否允许经逃逸阀打开。
 * - 开关关闭 → 全拒;仅 http/https;new URL 解析失败 → false
 * - u.origin 必须 ∈ origins(含 scheme,https://a.example ≠ http://a.example)
 */
export function isSandboxEscapeAllowed(
  url: string,
  opts?: { enabled?: boolean; origins?: readonly string[] },
): boolean {
  const enabled = opts?.enabled ?? SANDBOX_ESCAPE_ENABLED;
  const origins = opts?.origins ?? SANDBOX_ESCAPE_ALLOWED_ORIGINS;
  if (!enabled) {
    return false;
  }
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return false;
  }
  return origins.includes(u.origin);
}

/** initData 风格 data-check-string:key 字典序排序后 `k=v` 以 '\n' 连接 */
export function buildSandboxDataCheckString(fields: Record<string, string>): string {
  return Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
}

/** HMAC-SHA256(secret 为 key,签名 data-check-string)→ 小写 hex */
export async function signSandboxInitData(fields: Record<string, string>, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const data = new TextEncoder().encode(buildSandboxDataCheckString(fields));
  const sig = await crypto.subtle.sign('HMAC', key, data);
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 构建逃逸窗口 URL:fields 各键值 + `hash=signature` 并入 targetUrl 的 query,
 * 再经 proxyRequestUrl(私有 CA 反代收口)返回。
 */
export function buildSandboxWindowUrl(targetUrl: string, fields: Record<string, string>, signature: string): string {
  const u = new URL(targetUrl);
  for (const [k, v] of Object.entries(fields)) {
    u.searchParams.set(k, v);
  }
  u.searchParams.set('hash', signature);
  return proxyRequestUrl(u.toString());
}

/**
 * 打开沙箱逃逸窗口(仅桌面端,且需通过来源白名单)。已有窗口则聚焦。
 * 返回是否成功发起(被 gate 拒绝 → false)。
 */
export async function openSandboxEscapeWindow(opts: {
  url: string;
  title?: string;
  secret: string;
  cardId?: string;
}): Promise<boolean> {
  if (!isSandboxEscapeAllowed(opts.url)) {
    console.warn('[SandboxEscape] 逃逸阀关闭或来源不在白名单,拒绝打开');
    return false;
  }
  if (isMobile()) {
    console.warn('[SandboxEscape] 移动端不支持独立卡片窗口');
    return false;
  }

  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    nonce: crypto.randomUUID(),
  };
  if (opts.cardId) {
    fields.card_id = opts.cardId;
  }
  const signature = await signSandboxInitData(fields, opts.secret);

  // 已有窗口直接聚焦
  const existing = await WebviewWindow.getByLabel(SANDBOX_WINDOW_LABEL);
  if (existing) {
    await existing.setFocus();
    return true;
  }

  const win = new WebviewWindow(SANDBOX_WINDOW_LABEL, {
    url: buildSandboxWindowUrl(opts.url, fields, signature),
    title: opts.title ?? '卡片',
    width: 960,
    height: 640,
    center: true,
    resizable: true,
    focus: true,
  });

  win.once('tauri://error', (e) => {
    console.error('[SandboxEscape] 创建卡片窗口失败:', e);
  });
  return true;
}
