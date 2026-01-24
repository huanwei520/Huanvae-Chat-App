/**
 * 局域网传输窗口数据传递
 *
 * 使用 localStorage 在主窗口和局域网传输窗口之间传递数据
 * 与 media 模块使用相同的模式
 */

import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

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

  // 监听窗口创建结果
  lanTransferWindow.once('tauri://error', (e) => {
    console.error('[LanTransfer] 创建局域网传输窗口失败:', e);
    clearLanTransferData();
  });
}
