/**
 * 主题编辑窗口 API
 *
 * 使用独立窗口打开主题编辑器，不影响正常功能使用
 * 与媒体预览窗口使用相同的模式
 *
 * @module theme/api
 */

import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

// ============================================================================
// 窗口操作函数
// ============================================================================

/**
 * 打开主题编辑窗口
 *
 * 如果已存在窗口则聚焦，否则创建新窗口
 */
export async function openThemeEditorWindow(): Promise<void> {
  // 检查是否已有主题编辑窗口
  const existing = await WebviewWindow.getByLabel('theme-editor');
  if (existing) {
    // 如果已存在，聚焦到该窗口
    await existing.setFocus();
    return;
  }

  // 创建新的主题编辑窗口
  const themeWindow = new WebviewWindow('theme-editor', {
    url: '/theme-editor',
    title: '主题设置',
    width: 480,
    height: 560,
    minWidth: 400,
    minHeight: 480,
    center: true,
    decorations: true,
    resizable: true,
    focus: true,
  });

  // 监听窗口创建结果
  themeWindow.once('tauri://error', (e) => {
    console.error('[Theme] 创建主题编辑窗口失败:', e);
  });
}
