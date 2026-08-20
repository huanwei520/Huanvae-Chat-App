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
import { useApi } from '../../contexts/SessionContext';
import { sendMessage } from '../../api/messages';
import { sendGroupMessage } from '../../api/groupMessages';
import { formatMessageTime } from '../../utils/time';
import { AvatarPlaceholder } from '../../components/common/AvatarPlaceholder';
import { ShareTargetPicker, type ShareTarget } from '../../components/share/ShareTargetPicker';
import {
  buildFriendForwardRequest,
  buildGroupForwardRequest,
  summarizeForwardSource,
  type ForwardSource,
} from './forwardMessage';
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

  const handleConfirm = useCallback(async (targets: ShareTarget[]) => {
    const sendOne = (m: ForwardSource, t: ShareTarget) => (t.type === 'friend'
      ? sendMessage(api, buildFriendForwardRequest(m, t.id))
      : sendGroupMessage(api, buildGroupForwardRequest(m, t.id)));

    // 同一目标内**串行**发（保住原顺序：并行 Promise.all 会让多条到达顺序乱掉）；
    // 不同目标之间并行。用 promise 链而非 for-await，绕开 no-await-in-loop。
    await Promise.all(targets.map((t) => messages.reduce<Promise<unknown>>(
      (chain, m) => chain.then(() => sendOne(m, t)),
      Promise.resolve(),
    )));

    onSent?.();
  }, [api, messages, onSent]);

  return (
    <ShareTargetPicker
      title="转发到"
      preview={<ForwardPreview messages={messages} />}
      onConfirm={handleConfirm}
      onClose={onClose}
    />
  );
}
