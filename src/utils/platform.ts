/**
 * 平台检测工具
 *
 * 用于区分移动端和桌面端，实现条件渲染。
 *
 * 检测策略（Tauri 原生应用）：
 * - 仅通过 User-Agent 关键词判断平台类型
 * - 结果在首次调用时缓存，后续直接返回（平台不会在运行时变化）
 * - 不使用屏幕宽度判断，避免桌面端窗口缩小时误判为移动端
 *
 * @module utils/platform
 */

let _isMobileCached: boolean | null = null;

/**
 * 检测当前是否为移动端平台
 *
 * 通过 User-Agent 中的移动端关键词判断，结果会被缓存。
 * 不依赖屏幕宽度，因为桌面端窗口可以被用户调整到任意大小。
 *
 * @returns 是否为移动端
 */
export function isMobile(): boolean {
  if (_isMobileCached !== null) {
    return _isMobileCached;
  }

  const userAgent = navigator.userAgent.toLowerCase();
  const mobileKeywords = [
    'android',
    'iphone',
    'ipad',
    'ipod',
    'mobile',
    'webos',
    'blackberry',
    'opera mini',
    'windows phone',
  ] as const;

  _isMobileCached = mobileKeywords.some((keyword) =>
    userAgent.includes(keyword),
  );

  return _isMobileCached;
}

/**
 * 检测当前是否为桌面端平台
 *
 * @returns 是否为桌面端
 */
let _isMacOSCached: boolean | null = null;

/**
 * 检测是否为 macOS 桌面端
 *
 * 用途（目前唯一）：本地视频要不要走 127.0.0.1 的本地 HTTP 媒体服务器。
 * macOS 上 wry 用 WKURLSchemeHandler 注册 `asset://`，而 WKWebView **不会**把 Range 头
 * 交给自定义协议处理器（WebKit Bug 203302）⇒ <video> 拿不到分段、只剩灰块没有封面。
 *
 * 与 isMobile 同样按 UA 判定并缓存（平台运行期不变）。iPhone/iPad 的 UA 也含 "mac"，
 * 故必须**先排除移动端**，否则 iOS 会被误判成 macOS。
 */
export function isMacOS(): boolean {
  if (_isMacOSCached !== null) {
    return _isMacOSCached;
  }
  _isMacOSCached = !isMobile() && /mac/.test(navigator.userAgent.toLowerCase());
  return _isMacOSCached;
}

export function isDesktop(): boolean {
  return !isMobile();
}

/**
 * 获取当前平台类型
 *
 * @returns 平台类型字符串
 */
export function getPlatformType(): 'mobile' | 'desktop' {
  return isMobile() ? 'mobile' : 'desktop';
}

/**
 * 重置平台检测缓存（仅供测试使用）
 *
 * @internal
 */
export function _resetPlatformCache(): void {
  _isMacOSCached = null;
  _isMobileCached = null;
}
