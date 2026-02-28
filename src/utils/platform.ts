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
  _isMobileCached = null;
}
