/**
 * 屏幕共享设置共享模块（块 pvmk3dxq：分享框独立窗口化）
 *
 * 自 useWebRTC.ts 抽出的档位类型/映射/可用性判定，供两处共用：
 * - 会议窗「屏幕共享设置」窗内兜底弹窗（MeetingPage.tsx）
 * - 桌面端独立分享窗口（ScreenShareWindowPage.tsx，路由 /screen-share）
 * 单一事实源：两处 UI 共用本模块与 ScreenShareSettingsPanel，不复制两份逻辑。
 *
 * @module meeting/screenShareSettings
 */

/** 屏幕共享分辨率选项 */
export type ScreenShareResolution = '1080p' | '2k' | '4k';

/** 屏幕共享帧率选项 */
export type ScreenShareFrameRate = 60 | 120;

/** 屏幕共享设置 */
export interface ScreenShareSettings {
  resolution: ScreenShareResolution;
  frameRate: ScreenShareFrameRate;
}

/** 分辨率映射 */
export const RESOLUTION_MAP: Record<ScreenShareResolution, { width: number; height: number }> = {
  '1080p': { width: 1920, height: 1080 },
  '2k': { width: 2560, height: 1440 },
  '4k': { width: 3840, height: 2160 },
};

/** 分辨率显示名（供共用面板渲染，替代原 MeetingPage 内联 labelMap） */
export const RESOLUTION_LABELS: Record<ScreenShareResolution, string> = {
  '1080p': '1080p',
  '2k': '2K',
  '4k': '4K',
};

/** 帧率档位（共用面板渲染顺序） */
export const FRAME_RATE_OPTIONS: readonly ScreenShareFrameRate[] = [60, 120] as const;

/**
 * 获取可用的屏幕共享分辨率选项
 * 根据显示器实际分辨率过滤，避免设置超出显示器能力的分辨率
 */
export function getAvailableResolutions(): ScreenShareResolution[] {
  const screenWidth = window.screen.width * (window.devicePixelRatio || 1);
  const screenHeight = window.screen.height * (window.devicePixelRatio || 1);

  const all: ScreenShareResolution[] = ['1080p', '2k', '4k'];
  return all.filter((res) => {
    const { width, height } = RESOLUTION_MAP[res];
    return width <= screenWidth && height <= screenHeight;
  });
}
