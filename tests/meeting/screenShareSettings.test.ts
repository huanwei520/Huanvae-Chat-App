/**
 * 屏幕共享设置共享模块回归（块 pvmk3dxq：分享框独立窗口化）
 *
 * 验收口径：
 * - 档位可用性判定（按显示器实际分辨率过滤，超出能力档位不可用）；
 * - useWebRTC 对抽出的 screenShareSettings 单一事实源做 re-export（既有导入方零改动）。
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  RESOLUTION_MAP,
  RESOLUTION_LABELS,
  FRAME_RATE_OPTIONS,
  getAvailableResolutions,
  type ScreenShareResolution,
} from '../../src/meeting/screenShareSettings';
import {
  RESOLUTION_MAP as reMap,
  getAvailableResolutions as reGetAvailable,
} from '../../src/meeting/useWebRTC';

describe('screenShareSettings 档位映射', () => {
  it('RESOLUTION_MAP 三档齐全且数值正确', () => {
    expect(RESOLUTION_MAP['1080p']).toEqual({ width: 1920, height: 1080 });
    expect(RESOLUTION_MAP['2k']).toEqual({ width: 2560, height: 1440 });
    expect(RESOLUTION_MAP['4k']).toEqual({ width: 3840, height: 2160 });
  });

  it('显示名与帧率档位：1080p/2K/4K、60/120', () => {
    expect(RESOLUTION_LABELS).toEqual({ '1080p': '1080p', '2k': '2K', '4k': '4K' });
    expect(FRAME_RATE_OPTIONS).toEqual([60, 120]);
  });
});

describe('getAvailableResolutions 显示器能力过滤', () => {
  const origWidth = window.screen.width;
  const origHeight = window.screen.height;
  const origDpr = window.devicePixelRatio;

  afterEach(() => {
    Object.defineProperty(window.screen, 'width', { value: origWidth, configurable: true });
    Object.defineProperty(window.screen, 'height', { value: origHeight, configurable: true });
    Object.defineProperty(window, 'devicePixelRatio', { value: origDpr, configurable: true });
  });

  function setScreen(width: number, height: number, dpr: number) {
    Object.defineProperty(window.screen, 'width', { value: width, configurable: true });
    Object.defineProperty(window.screen, 'height', { value: height, configurable: true });
    Object.defineProperty(window, 'devicePixelRatio', { value: dpr, configurable: true });
  }

  it('1080p 物理屏：仅 1080p 可用', () => {
    setScreen(1920, 1080, 1);
    expect(getAvailableResolutions()).toEqual<ScreenShareResolution[]>(['1080p']);
  });

  it('4K 物理屏：三档全可用', () => {
    setScreen(3840, 2160, 1);
    expect(getAvailableResolutions()).toEqual<ScreenShareResolution[]>(['1080p', '2k', '4k']);
  });

  it('2K 屏：1080p/2k 可用，4k 不可用', () => {
    setScreen(2560, 1440, 1);
    expect(getAvailableResolutions()).toEqual<ScreenShareResolution[]>(['1080p', '2k']);
  });

  it('dpr 参与物理像素计算（css 1280×dpr2 = 2560 物理 → 2K 可用）', () => {
    setScreen(1280, 720, 2);
    expect(getAvailableResolutions()).toEqual<ScreenShareResolution[]>(['1080p', '2k']);
  });
});

describe('单一事实源 re-export（useWebRTC ← screenShareSettings）', () => {
  it('RESOLUTION_MAP 与 getAvailableResolutions 同源同引用', () => {
    expect(reMap).toBe(RESOLUTION_MAP);
    expect(reGetAvailable).toBe(getAvailableResolutions);
  });
});
