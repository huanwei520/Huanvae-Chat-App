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
 * 会议内设备平台标识（#9 任务条：tile 左上角平台图标）
 *
 * 与 {@link isMobile} 同源（UA 判定 + 缓存）。取值域是**闭集**，服务端/对端只认这几个值：
 * - `windows` / `android` / `macos` / `linux` —— 四端互见实测的四种目标平台
 * - `ios` —— 移动端但非 Android（本轮无 iOS 图标，渲染端不画徽章，但字段照发：
 *   不发言等于让对端无法区分「iOS」与「旧版本没上报」）
 * - `unknown` —— 认不出来（既非移动端也非已知桌面 UA）
 *
 * **不要用 isMacOS() 代替 macos 判定**：isMacOS 只为「本地视频走不走本地媒体服务器」
 * 服务，语义不同；本函数自带桌面端细分（win/mac/linux），两者不是同一个问题。
 */
export type PlatformName = 'windows' | 'android' | 'macos' | 'linux' | 'ios' | 'unknown';

/**
 * 该平台是否**可被控制**（#7 目标能力门控，owner 2026-09-14 二次评审②）。
 *
 * ## 判据：控制 daemon 只在桌面端存在
 * 远程控制要落地必须有对端 `hv-control-daemon`（arm/授权/注入/急停全在它手里）。
 * 该 daemon 的服务化打包只有 Windows / macOS / Linux 三支（见 HuanvaeRemote 的
 * 服务化打包与安装器携带清单）；**Android / iOS 没有 daemon ⇒ 不可能被控**。
 *
 * ## 为什么必须在前端就筛掉，而不是「让对端弹窗自己拒」
 * 旧行为（owner 病历）：Android tile 上照样伸出「申请控制」胶囊，点了之后
 * **Android 端真的弹出了接受授权框**，接受也照样走完 M2 —— 用户被引导着完成一次
 * 根本不可能生效的授权。能力筛选放在「谁能被当目标」这一层，两端同时收口：
 *   1. 目标 tile 的胶囊/右键菜单 → 只对可被控平台渲染（本函数）；
 *   2. 接受授权弹窗 → 只在**本机可被控**时渲染（同一函数，`detectPlatform()`）。
 *
 * ## unknown / ios / undefined 一律 false（保守）
 * `unknown` 与旧客户端不上报（undefined）都无从判断，一律按「不可被控」处理 ——
 * 宁可少一个入口，也不要给出一个必然失败、还会让对方收到陌生弹窗的按钮。
 * 这与 #9 平台徽章的「字段缺席什么都不画」是同一条口径。
 */
export function isControllablePlatform(platform?: PlatformName | null): boolean {
  return platform === 'windows' || platform === 'macos' || platform === 'linux';
}

let _platformNameCached: PlatformName | null = null;

/**
 * 检测当前设备的平台标识（供会议入房上报，见 {@link PlatformName}）
 *
 * 判定顺序（**顺序即正确性**，UA 里有大量互相包含的关键词）：
 * 1. Android —— 先查，因为 Android 平板/手机的 UA 里可能同时含 "linux" 与 "mobile"
 * 2. iOS —— iPhone/iPad/iPod 标记；**iPadOS 13+ 桌面模式另有 UA 分支**：
 *    它伪装成 macOS（`Macintosh; Intel Mac OS X`）、不含 ipad 标记，
 *    故额外用 `navigator.maxTouchPoints > 1` 分辨（触屏 Mac 不存在，
 *    MacBook 的 maxTouchPoints 恒为 0）—— 不收口的话 iPad 会被画成 macOS 图标
 * 3. Windows —— UA 含 "windows"
 * 4. macOS —— UA 含 "mac"（此时已排除 iOS/iPadOS）
 * 5. Linux —— UA 含 "linux"（此时已排除 Android）
 * 6. 其余为 unknown
 */
export function detectPlatform(): PlatformName {
  if (_platformNameCached !== null) {
    return _platformNameCached;
  }

  const ua = navigator.userAgent.toLowerCase();
  const touchPoints = navigator.maxTouchPoints ?? 0;

  if (ua.includes('android')) {
    _platformNameCached = 'android';
  } else if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) {
    _platformNameCached = 'ios';
  } else if (ua.includes('mac') && touchPoints > 1) {
    // iPadOS 13+ 桌面模式：UA 是 mac、无 ipad 标记，靠触点数分辨
    _platformNameCached = 'ios';
  } else if (ua.includes('windows')) {
    _platformNameCached = 'windows';
  } else if (ua.includes('mac')) {
    _platformNameCached = 'macos';
  } else if (ua.includes('linux')) {
    _platformNameCached = 'linux';
  } else {
    _platformNameCached = 'unknown';
  }

  return _platformNameCached;
}

/**
 * 重置平台检测缓存（仅供测试使用）
 *
 * @internal
 */
export function _resetPlatformCache(): void {
  _isMacOSCached = null;
  _isMobileCached = null;
  _platformNameCached = null;
}
