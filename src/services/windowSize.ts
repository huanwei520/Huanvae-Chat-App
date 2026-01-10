/**
 * 窗口大小服务
 *
 * 提供窗口大小的动态调整功能，确保应用在不同分辨率下有适当的初始大小。
 * 与 window-state 插件配合使用：
 * - 首次启动：按屏幕百分比计算窗口大小
 * - 后续启动：window-state 插件会自动恢复上次的窗口状态
 *
 * @module services/windowSize
 */

import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { restoreStateCurrent, StateFlags } from '@tauri-apps/plugin-window-state';

/**
 * 窗口大小配置
 */
interface WindowSizeConfig {
  /** 窗口占屏幕宽度的百分比 (0-1) */
  widthRatio: number;
  /** 窗口占屏幕高度的百分比 (0-1) */
  heightRatio: number;
  /** 最小宽度 */
  minWidth: number;
  /** 最小高度 */
  minHeight: number;
  /** 最大宽度 */
  maxWidth: number;
  /** 最大高度 */
  maxHeight: number;
}

/**
 * 默认窗口配置
 *
 * - 宽度：屏幕的 60%
 * - 高度：屏幕的 75%
 * - 最小：600x400（与 tauri.conf.json 一致）
 * - 最大：1920x1200（4K 屏幕的合理上限）
 */
const DEFAULT_CONFIG: WindowSizeConfig = {
  widthRatio: 0.6,
  heightRatio: 0.75,
  minWidth: 600,
  minHeight: 400,
  maxWidth: 1920,
  maxHeight: 1200,
};

/**
 * 限制数值在范围内
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * 初始化窗口大小
 *
 * 此函数应在应用启动时调用。它会：
 * 1. 尝试使用 window-state 插件恢复上次的窗口状态
 * 2. 如果是首次启动（无保存状态），则按屏幕百分比设置窗口大小
 *
 * @param config - 可选的窗口配置，默认使用 DEFAULT_CONFIG
 *
 * @example
 * ```ts
 * // 在 App.tsx 或 main.ts 中调用
 * await initWindowSize();
 *
 * // 或自定义配置
 * await initWindowSize({
 *   widthRatio: 0.7,
 *   heightRatio: 0.8,
 *   minWidth: 800,
 *   minHeight: 600,
 *   maxWidth: 2560,
 *   maxHeight: 1440,
 * });
 * ```
 */
export async function initWindowSize(config: Partial<WindowSizeConfig> = {}): Promise<void> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  try {
    // 尝试恢复保存的窗口状态（位置、大小、最大化状态等）
    // 如果有保存的状态，此函数会自动应用并返回
    await restoreStateCurrent(StateFlags.SIZE | StateFlags.POSITION);
    console.warn('[WindowSize] 已恢复保存的窗口状态');
    return;
  } catch {
    // 无保存状态或恢复失败，执行首次初始化
    console.warn('[WindowSize] 无保存状态，执行首次初始化');
  }

  try {
    const appWindow = getCurrentWindow();

    // 获取当前显示器信息
    const monitor = await appWindow.currentMonitor();
    if (!monitor) {
      console.warn('[WindowSize] 无法获取显示器信息，使用默认大小');
      return;
    }

    // 计算目标窗口大小（考虑 DPI 缩放，使用逻辑像素）
    const screenWidth = monitor.size.width / monitor.scaleFactor;
    const screenHeight = monitor.size.height / monitor.scaleFactor;

    // 按百分比计算，并限制在最小/最大范围内
    const targetWidth = clamp(
      Math.round(screenWidth * cfg.widthRatio),
      cfg.minWidth,
      cfg.maxWidth,
    );
    const targetHeight = clamp(
      Math.round(screenHeight * cfg.heightRatio),
      cfg.minHeight,
      cfg.maxHeight,
    );

    console.warn('[WindowSize] 初始化窗口大小', {
      screen: { width: screenWidth, height: screenHeight },
      scaleFactor: monitor.scaleFactor,
      target: { width: targetWidth, height: targetHeight },
    });

    // 设置窗口大小
    await appWindow.setSize(new LogicalSize(targetWidth, targetHeight));

    // 居中显示
    await appWindow.center();

    console.warn('[WindowSize] 窗口初始化完成');
  } catch (error) {
    console.error('[WindowSize] 初始化失败:', error);
  }
}

/**
 * 获取当前窗口信息（用于调试）
 *
 * @returns 当前窗口的详细信息
 */
export async function getWindowInfo(): Promise<{
  innerSize: { width: number; height: number };
  outerSize: { width: number; height: number };
  scaleFactor: number;
  monitor: {
    name: string | null;
    size: { width: number; height: number };
    scaleFactor: number;
  } | null;
}> {
  const appWindow = getCurrentWindow();

  const [innerSize, outerSize, scaleFactor, monitor] = await Promise.all([
    appWindow.innerSize(),
    appWindow.outerSize(),
    appWindow.scaleFactor(),
    appWindow.currentMonitor(),
  ]);

  return {
    innerSize: { width: innerSize.width, height: innerSize.height },
    outerSize: { width: outerSize.width, height: outerSize.height },
    scaleFactor,
    monitor: monitor
      ? {
        name: monitor.name,
        size: { width: monitor.size.width, height: monitor.size.height },
        scaleFactor: monitor.scaleFactor,
      }
      : null,
  };
}
