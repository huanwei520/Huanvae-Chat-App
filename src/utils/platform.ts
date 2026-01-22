/**
 * 平台检测工具
 *
 * 用于区分移动端和桌面端，实现条件渲染
 *
 * @module utils/platform
 */

/**
 * 检测当前是否为移动端平台
 *
 * 检测逻辑：
 * 1. 检查 User-Agent 是否包含移动端标识
 * 2. 检查屏幕宽度是否小于 768px
 *
 * @returns 是否为移动端
 */
export function isMobile(): boolean {
  // 检查 User-Agent
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

  const isMobileUA = mobileKeywords.some((keyword) =>
    userAgent.includes(keyword),
  );

  // 检查屏幕宽度（备用检测）
  const isSmallScreen = window.innerWidth < 768;

  return isMobileUA || isSmallScreen;
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
