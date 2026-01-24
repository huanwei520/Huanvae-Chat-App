/**
 * 局域网传输窗口数据传递
 *
 * 使用 localStorage 在主窗口和局域网传输窗口之间传递数据
 * 与 media 模块使用相同的模式
 *
 * 窗口生命周期管理：
 * - 打开窗口时：保存用户数据到 localStorage，页面初始化时启动 mDNS 服务
 * - 关闭窗口时：监听 tauri://close-requested 事件，在窗口关闭前停止 mDNS 服务
 * - 这确保了无论用户通过哪种方式关闭窗口，mDNS 服务都能正确注销
 */

import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { invoke } from '@tauri-apps/api/core';

// ============================================================================
// 类型定义
// ============================================================================

/** 存储在 localStorage 中的数据 */
export interface LanTransferWindowData {
  /** 用户 ID */
  userId: string;
  /** 用户昵称 */
  userNickname: string;
}

// ============================================================================
// 常量
// ============================================================================

const STORAGE_KEY = 'huanvae_lan_transfer_data';

// ============================================================================
// 数据传递函数
// ============================================================================

/**
 * 保存局域网传输数据到 localStorage
 */
export function saveLanTransferData(data: LanTransferWindowData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/**
 * 从 localStorage 加载局域网传输数据
 * 在局域网传输窗口初始化时调用
 */
export function loadLanTransferData(): LanTransferWindowData | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as LanTransferWindowData;
  } catch {
    return null;
  }
}

/**
 * 清除局域网传输数据
 * 在窗口关闭时调用
 */
export function clearLanTransferData(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// ============================================================================
// 窗口操作函数
// ============================================================================

/**
 * 打开局域网传输窗口
 *
 * 生命周期管理：
 * 1. 创建窗口时保存用户数据
 * 2. 监听窗口关闭事件（tauri://close-requested），在关闭前停止 mDNS 服务
 * 3. 这确保了无论用户通过自定义关闭按钮还是原生 X 按钮关闭，服务都能正确注销
 *
 * @param userId 用户 ID
 * @param userNickname 用户昵称
 */
export async function openLanTransferWindow(
  userId: string,
  userNickname: string,
): Promise<void> {
  // 保存数据到 localStorage
  saveLanTransferData({ userId, userNickname });

  // 检查是否已有局域网传输窗口
  const existing = await WebviewWindow.getByLabel('lan-transfer');
  if (existing) {
    // 如果已存在，聚焦到该窗口
    await existing.setFocus();
    return;
  }

  // 创建新的局域网传输窗口
  const lanTransferWindow = new WebviewWindow('lan-transfer', {
    url: '/lan-transfer',
    title: '局域网互传',
    width: 560,
    height: 600,
    minWidth: 400,
    minHeight: 500,
    center: true,
    decorations: true,
    resizable: true,
    focus: true,
  });

  // 监听窗口关闭事件，在关闭前停止 mDNS 服务
  // 这解决了用户通过原生 X 按钮关闭窗口时，mDNS 服务无法正确注销的问题
  lanTransferWindow.once('tauri://close-requested', async () => {
    console.log('[LanTransfer] 窗口关闭请求，正在停止 mDNS 服务...');
    try {
      await invoke('stop_lan_transfer_service');
      console.log('[LanTransfer] mDNS 服务已停止');
    } catch (e) {
      // 忽略错误（服务可能已通过其他方式停止）
      console.log('[LanTransfer] 停止服务时出错（可忽略）:', e);
    }
    clearLanTransferData();
  });

  // 监听窗口创建错误
  lanTransferWindow.once('tauri://error', (e) => {
    console.error('[LanTransfer] 创建局域网传输窗口失败:', e);
    clearLanTransferData();
  });
}
