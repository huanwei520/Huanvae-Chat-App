/**
 * 低代码编辑器窗口 API
 *
 * 使用 URL 查询参数在主窗口和低代码编辑器窗口之间传递数据
 * 避免 Tauri WebviewWindow 间 localStorage 不共享的问题
 *
 * @module lowcode/api
 */

import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { isMobile } from '../utils/platform';
import type { LowcodeWindowData } from './types/lowcode';

// ============================================================================
// 常量（保留用于测试兼容性）
// ============================================================================

const STORAGE_KEY = 'huanvae_lowcode_data';

// ============================================================================
// 数据传递函数（保留用于测试兼容性）
// ============================================================================

/**
 * 保存低代码编辑器数据到 localStorage
 * 注意：实际数据传递使用 URL 参数，此函数保留用于测试
 *
 * @param data - 窗口数据
 */
export function saveLowcodeData(data: LowcodeWindowData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/**
 * 从 localStorage 加载低代码编辑器数据
 * 注意：实际数据传递使用 URL 参数，此函数保留用于测试
 *
 * @returns 窗口数据，如果不存在则返回 null
 */
export function loadLowcodeData(): LowcodeWindowData | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as LowcodeWindowData;
  } catch {
    return null;
  }
}

/**
 * 清除低代码编辑器数据
 * 注意：实际数据传递使用 URL 参数，此函数保留用于测试
 */
export function clearLowcodeData(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// ============================================================================
// 窗口操作函数
// ============================================================================

/**
 * 打开低代码编辑器窗口
 *
 * 仅支持桌面端，移动端调用时会静默返回
 * 使用 URL 查询参数传递数据（避免 localStorage 跨窗口不共享问题）
 *
 * @param userId - 用户 ID
 * @param serverUrl - 服务器地址
 * @param accessToken - 访问令牌
 * @param refreshToken - 刷新令牌（用于自动刷新过期的访问令牌）
 */
export async function openLowcodeWindow(
  userId: string,
  serverUrl: string,
  accessToken: string,
  refreshToken: string,
): Promise<void> {
  // 移动端不支持，静默返回
  if (isMobile()) {
    console.warn('[Lowcode] 移动端不支持低代码编辑器');
    return;
  }

  // 检查是否已有低代码编辑器窗口
  const existing = await WebviewWindow.getByLabel('lowcode-editor');
  if (existing) {
    // 如果已存在，聚焦到该窗口
    await existing.setFocus();
    return;
  }

  // 构建带参数的 URL（使用 Base64 编码避免特殊字符问题）
  const params = new URLSearchParams({
    userId,
    serverUrl: btoa(serverUrl),
    accessToken: btoa(accessToken),
    refreshToken: btoa(refreshToken),
  });
  const url = `/lowcode?${params.toString()}`;

  // 创建新的低代码编辑器窗口
  // 注意：dragDropEnabled 必须为 false，否则 Windows WebView2 会拦截拖放事件
  // 导致页面内部元素之间的拖放（如算子拖到画布）无法正常工作
  const lowcodeWindow = new WebviewWindow('lowcode-editor', {
    url,
    title: '低代码编辑器',
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    center: true,
    decorations: true,
    resizable: true,
    focus: true,
    dragDropEnabled: false,
  });

  // 监听窗口创建结果
  lowcodeWindow.once('tauri://error', (e) => {
    console.error('[Lowcode] 创建低代码编辑器窗口失败:', e);
  });
}
