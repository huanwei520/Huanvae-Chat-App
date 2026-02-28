/**
 * 平台检测工具测试
 *
 * 验证 isMobile/isDesktop/getPlatformType 的判定逻辑：
 * - 仅通过 User-Agent 关键词判断，不依赖屏幕宽度
 * - 结果在首次调用后缓存，后续调用直接返回
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { isMobile, isDesktop, getPlatformType, _resetPlatformCache } from '../../src/utils/platform';

function setUserAgent(ua: string) {
  Object.defineProperty(navigator, 'userAgent', {
    value: ua,
    writable: true,
    configurable: true,
  });
}

function setInnerWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    value: width,
    writable: true,
    configurable: true,
  });
}

describe('platform', () => {
  beforeEach(() => {
    _resetPlatformCache();
    // 默认桌面端 UA
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    setInnerWidth(1024);
  });

  describe('isMobile', () => {
    it('桌面端 UA 应返回 false', () => {
      setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      expect(isMobile()).toBe(false);
    });

    it('Android UA 应返回 true', () => {
      setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36');
      expect(isMobile()).toBe(true);
    });

    it('iPhone UA 应返回 true', () => {
      setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
      expect(isMobile()).toBe(true);
    });

    it('iPad UA 应返回 true', () => {
      setUserAgent('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)');
      expect(isMobile()).toBe(true);
    });

    it('macOS UA 应返回 false', () => {
      setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
      expect(isMobile()).toBe(false);
    });

    it('Linux UA 应返回 false', () => {
      setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36');
      expect(isMobile()).toBe(false);
    });

    it('桌面端窗口宽度小于 768px 时不应误判为移动端', () => {
      setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      setInnerWidth(600);
      expect(isMobile()).toBe(false);
    });

    it('桌面端窗口宽度为 400px 时不应误判为移动端', () => {
      setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
      setInnerWidth(400);
      expect(isMobile()).toBe(false);
    });
  });

  describe('缓存机制', () => {
    it('首次调用后结果应被缓存', () => {
      setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      const first = isMobile();
      // 即使 UA 变化，缓存结果不变
      setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36');
      const second = isMobile();
      expect(first).toBe(second);
      expect(second).toBe(false);
    });

    it('_resetPlatformCache 应清除缓存', () => {
      setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      expect(isMobile()).toBe(false);

      _resetPlatformCache();
      setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36');
      expect(isMobile()).toBe(true);
    });
  });

  describe('isDesktop', () => {
    it('桌面端 UA 应返回 true', () => {
      setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      expect(isDesktop()).toBe(true);
    });

    it('移动端 UA 应返回 false', () => {
      setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36');
      expect(isDesktop()).toBe(false);
    });

    it('与 isMobile 互为取反', () => {
      setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      expect(isDesktop()).toBe(!isMobile());
    });
  });

  describe('getPlatformType', () => {
    it('桌面端应返回 "desktop"', () => {
      setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      expect(getPlatformType()).toBe('desktop');
    });

    it('移动端应返回 "mobile"', () => {
      setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36');
      expect(getPlatformType()).toBe('mobile');
    });
  });

  describe('UA 关键词覆盖', () => {
    const mobileUAs = [
      { name: 'Android', ua: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36' },
      { name: 'iPhone', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0)' },
      { name: 'iPad', ua: 'Mozilla/5.0 (iPad; CPU OS 16_0)' },
      { name: 'iPod', ua: 'Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0)' },
      { name: 'Mobile (generic)', ua: 'Mozilla/5.0 (Mobile; rv:100.0) Gecko/100.0' },
      { name: 'webOS', ua: 'Mozilla/5.0 (webOS/2.0; U; en-US)' },
      { name: 'BlackBerry', ua: 'Mozilla/5.0 (BlackBerry; U; BlackBerry 9900)' },
      { name: 'Opera Mini', ua: 'Opera/9.80 (J2ME/MIDP; Opera Mini/9.80)' },
      { name: 'Windows Phone', ua: 'Mozilla/5.0 (Windows Phone 10.0; Android 6.0.1)' },
    ];

    for (const { name, ua } of mobileUAs) {
      it(`${name} UA 应判定为移动端`, () => {
        _resetPlatformCache();
        setUserAgent(ua);
        expect(isMobile()).toBe(true);
      });
    }

    const desktopUAs = [
      { name: 'Windows', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      { name: 'macOS', ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      { name: 'Linux', ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' },
      { name: 'ChromeOS', ua: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36' },
    ];

    for (const { name, ua } of desktopUAs) {
      it(`${name} UA 应判定为桌面端`, () => {
        _resetPlatformCache();
        setUserAgent(ua);
        expect(isMobile()).toBe(false);
      });
    }
  });
});
