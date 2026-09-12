/**
 * 转发写穿（forward echo）：让**发送端本机**的会话卡片与打开中的消息流即时刷新
 *
 * @module chat/shared
 * @location src/chat/shared/forwardEcho.ts
 *
 * ## 为什么转发需要写穿而普通发送不需要
 *
 * 普通发送（useLocalFriendMessages.sendTextMessage / sendMediaMessage）在**打开中的会话**里
 * 进行：乐观更新先把消息插进消息流，API 响应后落库，卡片由 DB 预览刷新联动——全链路本机闭环。
 *
 * 转发（ForwardMessageModal）不同：
 * 1. **源会话 → 目标会话跨会话写**：目标会话多半没打开，转发路径没有任何乐观更新；
 * 2. **发送端本机收不到这条消息的 WS 回显**：后端 notification_service 只推
 *    「接收方全设备」+「发送者**其他**设备」（send_to_other_devices_global，
 *    backend-docs/messages/好友消息.md「消息转发/重发场景」同源的 new_message 推送口径），
 *    本机这条连接上**不会有任何帧**；
 * 3. 于是发送端本机：目标会话的消息行/预览/last_seq 全都没写（saveMessageToLocal 不会被触发），
 *    列表卡片预览与排序停在旧消息上，消息流（若目标会话正打开）也不出现——
 *    必须点进该会话触发 loadMessages + HTTP 增量同步才刷新。**这就是 owner 报的病征。**
 *
 * ## 写穿做什么
 *
 * `sendMessage` / `sendGroupMessage` 响应（message_uuid + seq + send_time）在手，
 * 据此构造一条与 WS `new_message` 帧**同形**的本地回显（WsNewMessage），然后：
 *
 * ① `saveMessageToLocal`（contexts/wsHandlers）—— 消息行 + conversations.last_seq + 卡片预览
 *    一次落库，防抖触发 `conversation-previews-changed` → 列表卡片（预览/时间/排序）即时刷新；
 *    这与 WS 推送路径走的是**同一个落库函数**，字段口径零漂移。
 *
 * ② `ws.emitLocalNewMessage` —— 把回显帧送进与 WS 帧同源的 newMessageListeners：
 *    目标会话正打开时，useLocalFriendMessages / useLocalGroupMessages 的 handleNewMessage
 *    按既有三分支把它追加进消息流（uuid 已存在则只回填 seq，天然幂等），并按打开中语义
 *    markRead；目标会话没打开时没有匹配的监听器，②是 no-op。
 *
 * ## 刻意不做的事
 *
 * - **不动 unreadSummary**：后端未读口径排除自己发的消息（unread_service 的
 *   `sender-id <> 当前用户`），自己发的消息对我不构成未读；connected 快照按服务端
 *   last-read-seq 派生，同样不会把这条算成未读。给 unreadSummary 加一再加回来是自找抽搐。
 * - **不继承 reply_to / 相册三件套**：与 forwardMessage.ts 文件头的转发边界一致，回显帧里
 *   这四个字段恒空——写穿的是"转发后的新消息"，不是原消息本身。
 * - **不影响其他设备/对方**：那是后端推送的职责，本机写穿只修"发送端本机"这一跳。
 */

import type { WsNewMessage } from '../../types/websocket';
import type { ForwardSource } from './forwardMessage';

/** 发送响应里写穿需要的字段（sendMessage / sendGroupMessage 的共同形状） */
export interface ForwardSendReceipt {
  message_uuid: string;
  send_time: string;
  seq: number;
}

/** 写穿回显的会话定位：好友 = 对端用户 id，群 = group_id */
export interface ForwardEchoTarget {
  type: 'friend' | 'group';
  id: string;
}

/**
 * 构造与 WS `new_message` 同形的本地回显帧。
 *
 * 纯函数（无 IO），便于单测。字段逐键对齐 WsNewMessage：
 * - `source_id` 用**接收者视角的会话对端**（好友 = 接收者 id、群 = group_id），
 *   与后端 new_message 帧（好友消息 source_id = 对端）完全一致，
 *   两个 useLocalXxxMessages hook 的 `source_id === 目标` 过滤才能命中；
 * - `content` 用消息原文（后端帧 content = 完整内容，preview 才是截断预览）；
 * - 图片宽高从原消息带过来（本机渲染宽高比），其余文件三件套按原样复用。
 */
export function buildForwardEcho(params: {
  source: ForwardSource;
  target: ForwardEchoTarget;
  currentUserId: string;
  currentUserNickname: string;
  currentUserAvatarUrl: string | null;
  receipt: ForwardSendReceipt;
}): WsNewMessage {
  const { source, target, currentUserId, currentUserNickname, currentUserAvatarUrl, receipt } = params;
  return {
    type: 'new_message',
    source_type: target.type,
    source_id: target.id,
    message_uuid: receipt.message_uuid,
    sender_id: currentUserId,
    sender_nickname: currentUserNickname,
    sender_avatar_url: currentUserAvatarUrl ?? undefined,
    content: source.message_content,
    message_type: source.message_type as WsNewMessage['message_type'],
    seq: receipt.seq,
    timestamp: receipt.send_time,
    file_uuid: source.file_uuid ?? undefined,
    file_url: source.file_url ?? undefined,
    file_size: source.file_size ?? undefined,
    image_width: source.image_width ?? undefined,
    image_height: source.image_height ?? undefined,
    // 转发边界（forwardMessage.ts 文件头第 2/3 条）：不继承 reply_to、丢弃相册三件套
    reply_to: null,
    media_group_id: null,
    media_group_index: null,
    media_group_count: null,
  };
}
