/**
 * 视频**缩略图**专用 src：追加媒体片段 `#t=0.1`，逼引擎 seek 并绘出那一帧当封面
 *
 * @location src/chat/shared/videoPosterSrc.ts
 *
 * ## 为什么需要它
 *
 * 全仓没有任何封面生成机制 —— 既没有 `poster` 属性、服务端也不下发缩略图字段、
 * 客户端更没有抽帧。四处视频缩略图全靠 webview 自己按 `preload="metadata"` 画首帧，
 * 而**画不画是引擎自由**：Chromium / WebView2（Windows）会画，
 * WKWebView（macOS）与 Android WebView **不画** —— 于是"只有 Windows 有封面"。
 *
 * `#t=0.1` 是 W3C Media Fragments URI 的时间片段：带上它以后引擎必须 seek 到 0.1s，
 * 而 seek 完成后**必然**要把那一帧渲染出来（否则画面无法反映当前 currentTime）。
 * 这就是"没有 poster 也能有封面"的最小代价做法。
 *
 * ⚠️ 依赖 Range：seek 要求源支持字节范围请求。本仓的两条取源通路都满足 ——
 * 本地文件走 Rust 端本地 HTTP 媒体服务器（`getVideoSource`，正是为
 * WKWebView 不给自定义协议转发 Range 这个 WebKit Bug 203302 而加的），
 * 远程走回环安全反代。
 *
 * ## 🔴 只能在【元素层】用，绝不能加进 resolver
 *
 * 两条独立的理由，任一条都足以否掉"在 `resolveDisplayUrl` / fileCache 里统一加"：
 *
 * 1. **同一个 src 会被递给全屏播放**。`FileMessageContent` 的视频缩略图与它下面的
 *    `<MobileMediaPreview src={src}>` 用的是同一个 `src` 变量；在 resolver 里加，
 *    等于让**播放**也从 0.1s 开始 —— 用户永远看不到视频的头 0.1 秒。
 * 2. **fragment 根本传不出 resolver**。`src/services/secureProxy.ts` 的 `pathAndQueryOf`
 *    走 `u.pathname + u.search`，**丢掉 fragment**；在 resolver 里加完，反代那一步就没了。
 *
 * ## 三端统一加，不做平台分叉
 *
 * Windows 从"画 0s 帧"变成"画 0.1s 帧"，不劣化，也不值得为它写一条平台特判
 * （平台分叉 = 又一条只有某个平台才走的路径，没人复查）。
 *
 * ## 边界（已知不覆盖，且**不为它加兜底分支**）
 *
 * 时长 < 0.1s 的视频 seek 不到 0.1s，退回现状（无封面）—— 不会比现在更差。
 *
 * ## 这条不变量由谁复查
 *
 * `tests/unit/videoPosterWiring.test.ts` 静态扫四处缩略图必须经本函数、
 * 全屏播放的 src 必须是裸的、且 resolver 侧不得出现 `#t=`。
 */

/** 缩略图要 seek 到的时间点（秒）。取 0.1 而不是 0：`#t=0` 与"默认位置"等价，不触发 seek。 */
const POSTER_FRAME_TIME = '0.1';

/**
 * 把一个可显示的视频 src 转成**缩略图用**的 src。
 *
 * @param src 已经过取源收口点解析的可显示地址（本地媒体服务器 URL 或回环反代 URL）
 * @returns 追加了 `#t=0.1` 的地址；空串原样返回；已带 fragment 的原样返回（见下）
 *
 * 已带 fragment 时原样返回：URL 只能有一个 fragment，再拼一个 `#` 会得到非法地址；
 * 而既有的 fragment 是调用方明确指定的时间点/区域，覆盖它属于越权。
 */
export function videoPosterSrc(src: string): string {
  if (!src || src.includes('#')) {
    return src;
  }
  return `${src}#t=${POSTER_FRAME_TIME}`;
}
