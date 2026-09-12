/**
 * 转发消息面板（A 版「快捷卡」）
 *
 * @module chat/shared
 * @location src/chat/shared/ForwardMessageModal.tsx
 *
 * 结构 = 顶部「转发内容预览」条（本文件） + 可复用的目标选择器
 * （components/share/ShareTargetPicker，会议分享 / 群名片同吃那一份）。
 *
 * 🔴 A 版取舍（huanwei 选 A 时就接受了的，不许自作主张补回来）：
 * **不提供附言输入框；不区分「合并转发」/「逐条转发」；多条消息一律按原样逐条发出。**
 *
 * 发送语义（边界与依据见 forwardMessage.ts 文件头）：媒体复用原 `file_uuid`、
 * 不继承 `reply_to`、丢弃媒体组三件套。
 *
 * 挂载语义：调用方 `{state && <ForwardMessageModal …/>}` 按需挂载 ——
 * 面板内部会查一次本地会话表，常驻在每个消息气泡上是不可接受的开销。
 */

import { useCallback } from 'react';
import { useApi, useSession } from '../../contexts/SessionContext';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { sendMessage } from '../../api/messages';
import { sendGroupMessage } from '../../api/groupMessages';
import { saveMessageToLocal } from '../../contexts/wsHandlers';
import { formatMessageTime } from '../../utils/time';
import { AvatarPlaceholder } from '../../components/common/AvatarPlaceholder';
import { ShareTargetPicker, type ShareTarget } from '../../components/share/ShareTargetPicker';
import {
  buildFriendForwardRequest,
  buildGroupForwardRequest,
  summarizeForwardSource,
  type ForwardSource,
} from './forwardMessage';
import { buildForwardEcho } from './forwardEcho';
import './ForwardMessageModal.css';

interface ForwardMessageModalProps {
  /** 要转发的消息（按原顺序；多条时逐条发出） */
  messages: ForwardSource[];
  /** 面板关闭（退场动画播完后触发） */
  onClose: () => void;
  /** 发送成功回调（例如退出多选模式） */
  onSent?: () => void;
}

/** ① 顶部固定的「转发内容预览」条 */
function ForwardPreview({ messages }: { messages: ForwardSource[] }) {
  const first = messages[0];
  if (!first) { return null; }
  const summary = summarizeForwardSource(first);

  return (
    <div className="forward-preview">
      <span className="forward-preview-avatar">
        <AvatarPlaceholder name={first.senderName} fontSize={13} />
      </span>
      <div className="forward-preview-body">
        <div className="forward-preview-meta">
          <b>{first.senderName}</b>
          <span>·</span>
          <span>{formatMessageTime(first.send_time)}</span>
          {messages.length > 1 && (
            <span className="forward-preview-count">共 {messages.length} 条</span>
          )}
        </div>
        <div className="forward-preview-text">{summary}</div>
      </div>
    </div>
  );
}

export function ForwardMessageModal({ messages, onClose, onSent }: ForwardMessageModalProps) {
  const api = useApi();
  const { session } = useSession();
  const ws = useWebSocket();

  const handleConfirm = useCallback(async (targets: ShareTarget[]) => {
    if (!session) { return; }

    const sendOne = async (m: ForwardSource, t: ShareTarget) => {
      // 先发（服务端的 message_uuid / seq / send_time 是本地写穿的唯一事实源）
      const receipt = t.type === 'friend'
        ? await sendMessage(api, buildFriendForwardRequest(m, t.id))
        : await sendGroupMessage(api, buildGroupForwardRequest(m, t.id));

      // 写穿（为什么需要见 chat/shared/forwardEcho.ts 文件头）：本机发出的转发消息
      // 收不到 WS 回显（后端只推接收方全设备 + 发送者其他设备），不写的话目标会话的
      // 列表卡片与打开中的消息流都停在旧消息上，必须点进会话触发同步才刷新。
      // ① saveMessageToLocal 落库（消息行 + last_seq + 卡片预览，与 WS 推送同一函数）
      //    → 防抖触发 conversation-previews-changed → 卡片即时刷新；
      // ② emitLocalNewMessage 把同形帧送进 newMessageListeners → 目标会话正打开时
      //    消息流即时上屏（uuid 去重幂等），没打开则无监听器命中、为 no-op。
      try {
        const echo = buildForwardEcho({
          source: m,
          target: { type: t.type, id: t.id },
          currentUserId: session.userId,
          currentUserNickname: session.profile.user_nickname,
          currentUserAvatarUrl: session.profile.user_avatar_url,
          receipt,
        });
        await saveMessageToLocal(echo, session.userId);
        ws.emitLocalNewMessage(echo);
        // 诊断走线：后端不发回显帧给本机，这条日志是写穿路径唯一的在轨证据
        console.warn('[Forward] 本地写穿完成', {
          uuid: receipt.message_uuid,
          target: t.type,
          seq: receipt.seq,
        });
      } catch (err) {
        // 发送已成功，写穿失败不吞掉转发结果：卡片/消息流退回增量同步兑现（修复前唯一路径）
        console.error('[Forward] 本地写穿失败（已发送成功，靠增量同步兜底）:', err);
      }
      return receipt;
    };

    // 同一目标内**串行**发（保住原顺序：并行 Promise.all 会让多条到达顺序乱掉）；
    // 不同目标之间并行。用 promise 链而非 for-await，绕开 no-await-in-loop。
    await Promise.all(targets.map((t) => messages.reduce<Promise<unknown>>(
      (chain, m) => chain.then(() => sendOne(m, t)),
      Promise.resolve(),
    )));

    onSent?.();
  }, [api, messages, onSent, session, ws]);

  return (
    <ShareTargetPicker
      title="转发到"
      preview={<ForwardPreview messages={messages} />}
      onConfirm={handleConfirm}
      onClose={onClose}
    />
  );
}
