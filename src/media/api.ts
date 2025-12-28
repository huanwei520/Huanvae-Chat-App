/**
 * 媒体预览窗口数据传递
 *
 * 使用 localStorage 在主窗口和媒体预览窗口之间传递数据
 * 与 meeting 模块使用相同的模式
 *
 * 由于媒体窗口需要调用 API 获取预签名 URL，
 * 需要同时传递认证信息（serverUrl 和 accessToken）
 */

import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

// ============================================================================
// 类型定义
// ============================================================================

/** 媒体类型 */
export type MediaType = 'image' | 'video';

/** 媒体预览窗口数据（不含认证信息） */
export interface MediaWindowData {
  /** 媒体类型 */
  type: MediaType;
  /** 文件 UUID */
  fileUuid: string;
  /** 文件名 */
  filename: string;
  /** 文件大小 */
  fileSize?: number;
  /** 文件哈希 */
  fileHash?: string | null;
  /** URL 类型（用于构建下载 URL） */
  urlType: 'user' | 'friend' | 'group';
  /** 本地文件路径（如果有） */
  localPath?: string | null;
  /** 预获取的预签名 URL（可选，避免在媒体窗口中再次请求） */
  presignedUrl?: string | null;
}

/** 存储在 localStorage 中的完整数据（含认证信息） */
interface MediaStorageData extends MediaWindowData {
  /** 服务器地址 */
  serverUrl: string;
  /** 访问令牌 */
  accessToken: string;
}

// ============================================================================
// 常量
// ============================================================================

const STORAGE_KEY = 'huanvae_media_data';

// ============================================================================
// 数据传递函数
// ============================================================================

/**
 * 保存媒体数据到 localStorage（内部使用）
 * 包含认证信息
 */
function saveMediaDataInternal(data: MediaStorageData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/**
 * 从 localStorage 加载媒体数据
 * 在媒体窗口初始化时调用
 * 返回包含认证信息的完整数据
 */
export function loadMediaData(): MediaStorageData | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as MediaStorageData;
  } catch {
    return null;
  }
}

/**
 * 清除媒体数据
 * 在媒体窗口关闭时调用
 */
export function clearMediaData(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// ============================================================================
// 窗口操作函数
// ============================================================================

/** 打开媒体窗口所需的认证信息 */
export interface MediaAuthInfo {
  serverUrl: string;
  accessToken: string;
}

/**
 * 打开媒体预览窗口
 *
 * @param data 媒体数据
 * @param auth 认证信息（从 session 获取）
 */
export async function openMediaWindow(
  data: MediaWindowData,
  auth: MediaAuthInfo,
): Promise<void> {
  // 保存数据到 localStorage（含认证信息）
  saveMediaDataInternal({
    ...data,
    serverUrl: auth.serverUrl,
    accessToken: auth.accessToken,
  });

  // 检查是否已有媒体窗口
  const existing = await WebviewWindow.getByLabel('media');
  if (existing) {
    // 如果已存在，关闭旧窗口
    await existing.close();
  }

  // 根据媒体类型设置窗口大小
  const isVideo = data.type === 'video';
  const width = isVideo ? 1280 : 1024;
  const height = isVideo ? 720 : 768;

  // 创建新的媒体窗口
  const mediaWindow = new WebviewWindow('media', {
    url: '/media',
    title: data.filename,
    width,
    height,
    center: true,
    decorations: true,
    resizable: true,
    focus: true,
  });

  // 监听窗口创建结果
  mediaWindow.once('tauri://error', (e) => {
    console.error('[Media] 创建媒体窗口失败:', e);
    clearMediaData();
  });
}
