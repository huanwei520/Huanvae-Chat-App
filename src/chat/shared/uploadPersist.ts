/**
 * 上传成功后的本地落库（缓存文件 + UUID↔Hash 映射 + 消息入本地库）
 *
 * @module chat/shared
 * @location src/chat/shared/uploadPersist.ts
 *
 * storage 上传链路**会由服务端顺手建好消息**（`upload/request` 的秒传分支 / `upload/confirm`
 * 都会回 `message_uuid`），所以「发媒体」不再调 `POST /api/messages`。
 * 但服务端不会把**自己发的**这条经 WS 推回本机 ⇒ 本地库必须自己写一份，
 * 否则上传后重灌列表会读不到刚发的东西。
 *
 * 全仓**唯一**一份：`src/hooks/useMainPage.ts` 的旧上传路径也 import 本模块
 * （原先它有一份同语义的私有 `processUploadSuccess`，两份并存必然漂移，已删除）。
 */

import { invoke } from '@tauri-apps/api/core';
import { saveFileUuidHash, saveMessage } from '../../db';
import { useSettingsStore } from '../../stores/settingsStore';
import type { MediaGroupMeta } from '../../hooks/useFileUpload';

/**
 * 文件消息的**派生正文**标签 —— 必须与后端逐字一致。
 *
 * 真值源：`Huanvae-Chat-Rust/src/storage/handlers/upload.rs:465-469`
 * `("image", format!("[图片] {}", filename))` / `[视频]` / `[文件]`。
 *
 * 🔴 少了这个前缀会造成一条极隐蔽的缺陷：本地那份写成裸文件名、服务端那份是 `[图片] x.jpg`，
 * 于是**同一条消息「自己看到的正文」与「对方看到的正文」形状不同**，
 * 且下游任何「像不像文件名」的判定（如相册配文识别）都会被这个差异带偏。
 */
const DERIVED_CONTENT_LABEL: Record<'image' | 'video' | 'file', string> = {
  image: '[图片]',
  video: '[视频]',
  file: '[文件]',
};

/**
 * 本条消息最终的正文，口径与后端 `resolve_content`（upload.rs:115-127）一致：
 * caption 去空白后非空 ⇒ 用 caption 取代派生正文；否则用 `[标签] 文件名`。
 *
 * ⚠️ 后端还有一条本地不需要复刻的分支：成组时 caption 只在组首项生效。
 * 本地不需要，是因为调用方（planComposerTraySend / planAlbumUpload）已经保证
 * **只有组首项拿得到 caption**，非首项传进来的恒是 undefined。
 */
export function resolveUploadedContent(
  caption: string | undefined,
  messageType: 'image' | 'video' | 'file',
  filename: string,
): string {
  const trimmed = caption?.trim();
  return trimmed || `${DERIVED_CONTENT_LABEL[messageType]} ${filename}`;
}

export interface UploadPersistOptions {
  result: {
    fileHash?: string;
    fileUuid?: string;
    fileUrl?: string;
    messageUuid?: string;
    messageSendTime?: string;
    imageWidth?: number | null;
    imageHeight?: number | null;
  };
  file: File;
  /** 本地绝对路径；空串/undefined 表示这一份没有本地来源（如剪贴板图片数据） */
  localPath?: string;
  messageType: 'image' | 'video' | 'file';
  /** 兜底 send_time（服务端没回时用） */
  timestamp: string;
  session: { userId: string; profile: { user_nickname: string; user_avatar_url: string | null } };
  conversationType: 'friend' | 'group';
  conversationId: string;
  /** 相册三件套；单条形态不传 ⇒ 三列全 null（「单条不包相册」在落库这一段的表达） */
  mediaGroup?: MediaGroupMeta;
  /**
   * 本条生效的配文。后端 `resolve_content` 在 caption 非空白时用它**取代**派生正文，
   * 本地这份不跟着写的话，自己刚发的那条会把文件名当正文显示（对端却是配文）。
   */
  caption?: string;
  /**
   * 本条的引用回复（被引用原消息的 `message_uuid`）。
   *
   * 服务端不会把**自己发的**这条经 WS 推回本机（见文件头）⇒ 本地这份不写的话，
   * 就是「**对端看得到引用块、自己看不到**」——比整条丢失更难查，因为发送方一切正常。
   *
   * 🔴 只有当上传参数里**真的带了** `reply_to` 时才传进来。群会话后端会丢弃它，
   * 那时这里必须也是 `undefined`，否则本地会写出一个对端根本不存在的引用关系。
   */
  replyTo?: string;
}

/**
 * @returns 落库用的真实 message_uuid；服务端没回 message_uuid 时为 null
 */
export async function persistUploadedMessage(options: UploadPersistOptions): Promise<string | null> {
  const {
    result, file, localPath, messageType, timestamp, session,
    conversationType, conversationId, mediaGroup, caption, replyTo,
  } = options;

  if (!result.fileUuid || !result.fileHash) {
    return null;
  }

  await saveFileUuidHash(result.fileUuid, result.fileHash);

  if (localPath) {
    try {
      const { fileCache } = useSettingsStore.getState();
      const thresholdBytes = fileCache.largeFileThresholdMB * 1024 * 1024;
      await invoke<string>('copy_file_to_cache', {
        sourcePath: localPath,
        fileHash: result.fileHash,
        fileName: file.name,
        fileType: messageType,
        fileSize: file.size,
        largeFileThreshold: thresholdBytes,
      });
    } catch (cacheErr) {
      // 缓存失败不影响消息本身：文件已经在服务端了，本地缓存只是离线预览的优化
      console.error('[ComposerTray] 缓存文件失败:', cacheErr);
    }
  }

  if (!result.messageUuid) {
    return null;
  }

  await saveMessage({
    message_uuid: result.messageUuid,
    conversation_id: conversationId,
    conversation_type: conversationType,
    sender_id: session.userId,
    sender_name: session.profile.user_nickname,
    sender_avatar: session.profile.user_avatar_url,
    // 与后端 resolve_content 同口径（含 `[图片]/[视频]/[文件] ` 前缀），见本文件顶部说明
    content: resolveUploadedContent(caption, messageType, file.name),
    content_type: messageType,
    file_uuid: result.fileUuid,
    file_url: result.fileUrl || null,
    file_size: file.size,
    file_hash: result.fileHash,
    image_width: result.imageWidth ?? null,
    image_height: result.imageHeight ?? null,
    seq: 0,
    reply_to: replyTo ?? null,
    media_group_id: mediaGroup?.id ?? null,
    media_group_index: mediaGroup?.index ?? null,
    media_group_count: mediaGroup?.count ?? null,
    is_recalled: false,
    is_deleted: false,
    send_time: result.messageSendTime || timestamp,
  });

  return result.messageUuid;
}
