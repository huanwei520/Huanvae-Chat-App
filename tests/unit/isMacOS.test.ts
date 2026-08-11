/**
 * isMacOS 判定测试
 *
 * 它决定「本地视频走不走 127.0.0.1 的本地 HTTP 媒体服务器」：
 * macOS 上 wry 用 WKURLSchemeHandler 注册 asset://，而 WKWebView **不会**把 Range 头
 * 交给自定义协议处理器（WebKit Bug 203302）⇒ <video> 拿不到分段、只剩灰块没封面。
 *
 * 🔴 最容易错的一点：**iPhone / iPad 的 UA 里也含 "mac"**
 * （典型：`Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ...`）。
 * 只用 /mac/ 匹配会把 iOS 判成 macOS ⇒ iOS 明明原生支持 file:// 视频，却被推去走
 * 一个在 iOS 上根本没启动的本地服务器 ⇒ 视频直接不显示。故必须先排除移动端。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isMacOS, isMobile, _resetPlatformCache } from '../../src/utils/platform';

const realUA = navigator.userAgent;

function setUA(ua: string) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
  _resetPlatformCache();
}

describe('isMacOS', () => {
  beforeEach(() => { _resetPlatformCache(); });
  afterEach(() => { setUA(realUA); });

  it('macOS 桌面 UA ⇒ true', () => {
    setUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15');
    expect(isMacOS()).toBe(true);
  });

  // 这条是本文件存在的理由
  it('iPhone UA 含 "like Mac OS X" ⇒ **false**（否则 iOS 会被推去走不存在的本地服务器）', () => {
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148');
    expect(isMobile()).toBe(true);
    expect(isMacOS()).toBe(false);
  });

  it('iPad UA 同样为 false', () => {
    setUA('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148');
    expect(isMacOS()).toBe(false);
  });

  it('Windows ⇒ false（其 asset 走 http://asset.localhost，本就是 HTTP 语义，不需要本地服务器）', () => {
    setUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36');
    expect(isMacOS()).toBe(false);
  });

  it('Linux ⇒ false', () => {
    setUA('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36');
    expect(isMacOS()).toBe(false);
  });

  it('Android ⇒ false（它走的是同一个本地服务器，但由 isMobile 那条分支命中，不该由 isMacOS 命中）', () => {
    setUA('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36');
    expect(isMobile()).toBe(true);
    expect(isMacOS()).toBe(false);
  });

  it('结果被缓存（平台运行期不变，不必每次重算）', () => {
    setUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15');
    expect(isMacOS()).toBe(true);
    // 不 reset 直接换 UA：应仍返回缓存值
    Object.defineProperty(navigator, 'userAgent', { value: 'Windows NT 10.0', configurable: true });
    expect(isMacOS()).toBe(true);
  });
});
