/**
 * 消息通知服务
 *
 * 使用 Tauri 通知插件实现跨平台系统通知：
 * - Windows、macOS、Linux 桌面端
 * - Android、iOS 移动端
 *
 * 功能：
 * - 权限请求和检查
 * - 新消息通知
 * - 系统事件通知（好友请求、群邀请等）
 *
 * ## 平台差异
 *
 * - **桌面端**：使用 HTML Audio + convertFileSrc 播放提示音
 * - **Android**：使用通知渠道（Channel）播放原生声音
 *   - 声音文件位于 res/raw/ 目录
 *   - 通过 createChannel 设置声音
 *
 * 注意事项：
 * - 当前聊天窗口的消息不发送通知
 * - 通知内容会根据消息类型显示不同文本
 * - Android 通知渠道一旦创建，声音设置无法修改（需删除重建）
 */

import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
  createChannel,
  Importance,
} from '@tauri-apps/plugin-notification';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useSettingsStore } from '../stores/settingsStore';
import { isMobile } from '../utils/platform';
import { conversationPreviewText } from '../chat/shared/messagePreviewText';

// ============================================
// Android 通知渠道
// ============================================

/** 消息通知渠道 ID */
const MESSAGE_CHANNEL_ID = 'huanvae_messages';

/** 系统通知渠道 ID */
const SYSTEM_CHANNEL_ID = 'huanvae_system';

/** 渠道是否已初始化 */
let channelsInitialized = false;

/**
 * 初始化 Android 通知渠道
 *
 * 在移动端启动时调用，创建消息和系统通知渠道
 * 桌面端调用此函数无效果
 */
export async function initNotificationChannels(): Promise<void> {
  if (!isMobile() || channelsInitialized) {
    return;
  }

  try {
    // 创建消息通知渠道（带自定义声音）
    await createChannel({
      id: MESSAGE_CHANNEL_ID,
      name: '消息通知',
      description: '新消息提醒',
      importance: Importance.High,
      vibration: true,
      sound: 'water', // res/raw/water.mp3
    });

    // 创建系统通知渠道（使用默认声音）
    await createChannel({
      id: SYSTEM_CHANNEL_ID,
      name: '系统通知',
      description: '好友请求、群邀请等系统通知',
      importance: Importance.Default,
      vibration: true,
    });

    channelsInitialized = true;
    // eslint-disable-next-line no-console
    console.log('[Notification] Android 通知渠道初始化成功');
  } catch (error) {
    console.warn('[Notification] 初始化通知渠道失败:', error);
  }
}

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
async function playNotificationSound(): Promise<void> {
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
async function ensureNotificationPermission(): Promise<boolean> {
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
  /** 通知渠道 ID（移动端使用） */
  channelId?: string;
}

/**
 * 发送系统通知
 *
 * 移动端会使用指定的渠道 ID，渠道决定了通知的声音、振动等行为
 */
export async function notify(options: NotificationOptions): Promise<void> {
  const granted = await ensureNotificationPermission();
  if (!granted) {
    console.warn('[Notification] 未获得通知权限');
    return;
  }

  try {
    if (isMobile()) {
      // 移动端：使用通知渠道
      sendNotification({
        title: options.title,
        body: options.body,
        channelId: options.channelId || MESSAGE_CHANNEL_ID,
      });
    } else {
      // 桌面端：不使用渠道
      sendNotification({
        title: options.title,
        body: options.body,
        icon: options.icon,
      });
    }
  } catch (error) {
    console.warn('[Notification] 发送通知失败:', error);
  }
}

// ============================================
// 消息类型转换
// ============================================

/** 系统通知正文的截断长度（只有白名单类型的原文才可能超长） */
const NOTIFICATION_PREVIEW_MAX = 50;

/**
 * 根据消息类型生成系统通知的预览文本。
 *
 * 🔴 **映射表不在这里，在 {@link conversationPreviewText}** —— 全仓唯一一份。
 *
 * 原先这里是一份独立的 switch，末尾是 `default: return content`。那条 default 违反了
 * messagePreviewText.ts 文件头写死的核心不变量「未知类型绝不回落 content 原文」，
 * 而本文件恰恰是三处预览里**唯一会把正文推到锁屏通知**的那一处：
 * `message_type` 的联合类型只是编译期声明，运行时的值来自
 * `JSON.parse(data) as WsServerMessage`（wsHandlers.ts）——服务端加任何新的
 * JSON 载荷型 message_type，这里就把原文原样推上锁屏。
 * （群消息真实存在的 `'system'` 就已经不在那个联合里。）
 *
 * ⚠️ 参数类型故意是 `string` 而不是那个联合：**联合类型挡不住运行时的值**，
 * 写成联合只会让读代码的人以为 default 分支到不了。
 *
 * 截断是本函数**独有**的职责（会话列表那一行不截断），故留在这里。
 */
export function getMessagePreview(messageType: string, content: string): string {
  const text = conversationPreviewText(messageType, content);
  return text.length > NOTIFICATION_PREVIEW_MAX
    ? `${text.slice(0, NOTIFICATION_PREVIEW_MAX)}...`
    : text;
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
  /**
   * 消息类型（后端 `message_type` 原样透传）。
   *
   * 🔴 故意是 `string` 而不是联合类型：它的值来自 `JSON.parse(...) as WsServerMessage`，
   * 联合只是编译期声明，运行时服务端给什么就是什么（群消息的 `'system'` 已经不在那个联合里）。
   * 写成联合会让读者以为「不可能出现别的值」，从而放心地在下游写 `default: return content`
   * —— 那正是本文件修掉的那条泄露。
   */
  messageType: string;
  /** 消息内容 */
  content: string;
  /** 当前活跃的聊天（用于判断是否跳过通知） */
  activeChat?: { type: 'friend' | 'group'; id: string } | null;
  /**
   * 发送者是否被特别关心（true 时强提醒：通知标题带 ⭐ 标记，更醒目）。
   * 好友消息 = 特别关心好友；群消息 = 在本群被特别关心的成员（M3）。
   */
  isSpecialCare?: boolean;
}

/**
 * 发送新消息通知
 *
 * 如果用户当前正在查看该聊天，不发送系统通知但仍播放提示音
 *
 * 平台差异：
 * - 桌面端：手动播放提示音 + 发送系统通知
 * - 移动端：通知渠道自动播放声音，无需手动播放
 */
/**
 * 好友消息通知标题：特别关心好友加 ⭐ 前缀强提醒，更醒目。
 * 抽为纯函数便于单测（notifyNewMessage 依赖 Audio/平台/权限，难直接测）。
 */
export function friendNotificationTitle(senderName: string, isSpecialCare: boolean): string {
  return isSpecialCare ? `⭐ ${senderName}` : senderName;
}

/**
 * 群消息通知标题：被特别关心的群成员发言时，群名加 ⭐ 前缀强提醒，更醒目（M3）。
 * 发送者信息在通知正文「发送者: 内容」里，故 ⭐ 标在群名上即可一眼看出本群有人值得关注。
 */
export function groupNotificationTitle(groupName: string, isSpecialCare: boolean): string {
  return isSpecialCare ? `⭐ ${groupName}` : groupName;
}

export async function notifyNewMessage(params: NewMessageNotificationParams): Promise<void> {
  const {
    sourceType,
    sourceId,
    senderName,
    groupName,
    messageType,
    content,
    activeChat,
    isSpecialCare,
  } = params;

  // 如果当前正在查看该聊天
  const isActiveChat = activeChat &&
    activeChat.type === sourceType &&
    activeChat.id === sourceId;

  if (isActiveChat) {
    // 仅播放提示音（桌面端），不发送系统通知
    if (!isMobile()) {
      playNotificationSound();
    }
    return;
  }

  // 桌面端：手动播放提示音
  if (!isMobile()) {
    playNotificationSound();
  }

  const preview = getMessagePreview(messageType, content);

  let title: string;
  let body: string;

  if (sourceType === 'group') {
    // 群消息：标题为群名，正文为 "发送者: 消息内容"
    // 被特别关心的群成员发言：群名带 ⭐ 前缀强提醒，更醒目（M3）
    title = groupNotificationTitle(groupName || '群消息', !!isSpecialCare);
    body = `${senderName}: ${preview}`;
  } else {
    // 好友消息：标题为发送者名称，正文为消息内容
    // 特别关心好友：标题带 ⭐ 前缀强提醒，更醒目
    title = friendNotificationTitle(senderName, !!isSpecialCare);
    body = preview;
  }

  // 移动端使用消息渠道（自动播放 water.mp3）
  await notify({ title, body, channelId: MESSAGE_CHANNEL_ID });
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
 *
 * 平台差异：
 * - 桌面端：手动播放提示音 + 发送系统通知
 * - 移动端：使用系统通知渠道（默认声音）
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

  // 移动端使用系统通知渠道（默认声音）
  await notify({ title, body, channelId: SYSTEM_CHANNEL_ID });

  // 桌面端：手动播放提示音
  if (!isMobile()) {
    playNotificationSound();
  }
}
