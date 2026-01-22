/**
 * 消息通知服务
 *
 * 使用 Tauri 通知插件实现跨平台系统通知：
 * - Windows、macOS、Linux 桌面端
 * - Android、iOS 移动端（需要额外配置）
 *
 * 功能：
 * - 权限请求和检查
 * - 新消息通知
 * - 系统事件通知（好友请求、群邀请等）
 *
 * ## 平台差异
 *
 * - **桌面端**：使用 HTML Audio + convertFileSrc 播放提示音
 * - **Android**：使用本地 HTTP 服务器播放提示音
 *
 * 注意事项：
 * - 当前聊天窗口的消息不发送通知
 * - 通知内容会根据消息类型显示不同文本
 */

import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useSettingsStore } from '../stores/settingsStore';
import { isMobile } from '../utils/platform';

// ============================================
// 提示音播放
// ============================================

/** 当前播放的音频 */
let currentAudio: HTMLAudioElement | null = null;

/**
 * 播放消息提示音
 *
 * 平台差异：
 * - 桌面端：使用 convertFileSrc + HTML Audio
 * - Android：使用本地 HTTP 服务器（127.0.0.1:9527）
 */
export async function playNotificationSound(): Promise<void> {
  // 获取设置
  const settings = useSettingsStore.getState().notification;

  // 如果禁用了提示音，直接返回
  if (!settings.enabled || !settings.soundName) {
    return;
  }

  try {
    // 停止当前正在播放的音频
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }

    let src: string;

    if (isMobile()) {
      // Android：使用本地 HTTP 服务器
      // 服务器端口固定为 9527（与视频服务共用）
      src = `http://127.0.0.1:9527/audio/${settings.soundName}`;
    } else {
      // 桌面端：获取提示音文件路径并转换
      const path = await invoke<string>('get_notification_sound_path', {
        name: settings.soundName,
      });
      src = convertFileSrc(path);
    }

    // 创建并播放音频
    const audio = new Audio(src);
    audio.volume = settings.volume / 100;

    audio.onended = () => {
      currentAudio = null;
    };

    audio.onerror = (e) => {
      console.warn('[Notification] 播放提示音失败:', e);
      currentAudio = null;
    };

    currentAudio = audio;
    await audio.play();
  } catch (error) {
    console.warn('[Notification] 播放提示音错误:', error);
  }
}

// ============================================
// 权限管理
// ============================================

/** 通知权限状态缓存 */
let permissionGranted: boolean | null = null;

/**
 * 检查通知权限
 */
export async function checkNotificationPermission(): Promise<boolean> {
  if (permissionGranted !== null) {
    return permissionGranted;
  }

  try {
    permissionGranted = await isPermissionGranted();
    return permissionGranted;
  } catch (error) {
    console.warn('[Notification] 检查权限失败:', error);
    return false;
  }
}

/**
 * 请求通知权限
 *
 * @returns 是否获得权限
 */
export async function requestNotificationPermission(): Promise<boolean> {
  try {
    // 先检查当前权限
    const granted = await isPermissionGranted();
    if (granted) {
      permissionGranted = true;
      return true;
    }

    // 请求权限
    const permission = await requestPermission();
    permissionGranted = permission === 'granted';
    return permissionGranted;
  } catch (error) {
    console.warn('[Notification] 请求权限失败:', error);
    return false;
  }
}

/**
 * 确保有通知权限（检查 + 请求）
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  const granted = await checkNotificationPermission();
  if (granted) {
    return true;
  }
  return requestNotificationPermission();
}

// ============================================
// 通知发送
// ============================================

export interface NotificationOptions {
  /** 通知标题 */
  title: string;
  /** 通知正文 */
  body: string;
  /** 图标路径（可选） */
  icon?: string;
}

/**
 * 发送系统通知
 */
export async function notify(options: NotificationOptions): Promise<void> {
  const granted = await ensureNotificationPermission();
  if (!granted) {
    console.warn('[Notification] 未获得通知权限');
    return;
  }

  try {
    sendNotification({
      title: options.title,
      body: options.body,
      icon: options.icon,
    });
  } catch (error) {
    console.warn('[Notification] 发送通知失败:', error);
  }
}

// ============================================
// 消息类型转换
// ============================================

/**
 * 根据消息类型生成预览文本
 */
function getMessagePreview(
  messageType: 'text' | 'image' | 'video' | 'file',
  content: string,
): string {
  switch (messageType) {
    case 'text':
      // 截断过长的文本
      return content.length > 50 ? `${content.slice(0, 50)}...` : content;
    case 'image':
      return '[图片]';
    case 'video':
      return '[视频]';
    case 'file':
      return '[文件]';
    default:
      return content;
  }
}

// ============================================
// 新消息通知
// ============================================

export interface NewMessageNotificationParams {
  /** 来源类型 */
  sourceType: 'friend' | 'group';
  /** 来源 ID（好友 ID 或群 ID） */
  sourceId: string;
  /** 发送者名称 */
  senderName: string;
  /** 群名称（仅群消息需要） */
  groupName?: string;
  /** 消息类型 */
  messageType: 'text' | 'image' | 'video' | 'file';
  /** 消息内容 */
  content: string;
  /** 当前活跃的聊天（用于判断是否跳过通知） */
  activeChat?: { type: 'friend' | 'group'; id: string } | null;
}

/**
 * 发送新消息通知
 *
 * 如果用户当前正在查看该聊天，不发送系统通知但仍播放提示音
 */
export async function notifyNewMessage(params: NewMessageNotificationParams): Promise<void> {
  const {
    sourceType,
    sourceId,
    senderName,
    groupName,
    messageType,
    content,
    activeChat,
  } = params;

  // 无论是否是当前聊天，都播放提示音
  playNotificationSound();

  // 如果当前正在查看该聊天，不发送系统通知
  if (
    activeChat &&
    activeChat.type === sourceType &&
    activeChat.id === sourceId
  ) {
    return;
  }

  const preview = getMessagePreview(messageType, content);

  let title: string;
  let body: string;

  if (sourceType === 'group') {
    // 群消息：标题为群名，正文为 "发送者: 消息内容"
    title = groupName || '群消息';
    body = `${senderName}: ${preview}`;
  } else {
    // 好友消息：标题为发送者名称，正文为消息内容
    title = senderName;
    body = preview;
  }

  await notify({ title, body });
}

// ============================================
// 系统通知
// ============================================

export type SystemNotificationType =
  | 'friend_request'
  | 'friend_request_approved'
  | 'friend_request_rejected'
  | 'friend_deleted'
  | 'group_invite'
  | 'group_join_request'
  | 'group_join_approved'
  | 'group_removed'
  | 'group_disbanded'
  | 'group_notice_updated';

export interface SystemNotificationParams {
  /** 通知类型 */
  type: SystemNotificationType;
  /** 相关数据 */
  data: Record<string, string | number | undefined>;
}

/**
 * 发送系统通知
 */
export async function notifySystemEvent(params: SystemNotificationParams): Promise<void> {
  const { type, data } = params;

  let title = 'Huanvae Chat';
  let body = '';

  switch (type) {
    case 'friend_request':
      title = '新的好友请求';
      body = `${data.from_nickname || data.from_id} 请求添加你为好友`;
      break;

    case 'friend_request_approved':
      title = '好友请求已通过';
      body = `${data.from_nickname || data.from_id} 已同意你的好友请求`;
      break;

    case 'friend_request_rejected':
      title = '好友请求被拒绝';
      body = `${data.from_nickname || data.from_id} 拒绝了你的好友请求`;
      break;

    case 'friend_deleted':
      title = '好友关系解除';
      body = `${data.from_nickname || data.from_id} 已将你从好友列表移除`;
      break;

    case 'group_invite':
      title = '群聊邀请';
      body = `${data.inviter_nickname || data.inviter_id} 邀请你加入「${data.group_name}」`;
      break;

    case 'group_join_request':
      title = '入群申请';
      body = `${data.applicant_nickname || data.applicant_id} 申请加入「${data.group_name}」`;
      break;

    case 'group_join_approved':
      title = '入群申请已通过';
      body = `你已加入群聊「${data.group_name}」`;
      break;

    case 'group_removed':
      title = '已被移出群聊';
      body = `你已被移出群聊「${data.group_name}」`;
      break;

    case 'group_disbanded':
      title = '群聊已解散';
      body = `群聊「${data.group_name}」已被解散`;
      break;

    case 'group_notice_updated':
      title = '群公告更新';
      body = `「${data.group_name}」发布了新公告`;
      break;

    default:
      return; // 未知类型，不发送通知
  }

  await notify({ title, body });

  // 播放提示音
  playNotificationSound();
}
