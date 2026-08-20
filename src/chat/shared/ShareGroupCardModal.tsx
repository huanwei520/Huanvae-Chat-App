/**
 * 分享群名片（把一个群以 `group_card` 消息发给好友 / 发进群）
 *
 * @location src/chat/shared/ShareGroupCardModal.tsx
 *
 * 「发给谁」那一半整个复用单① 抽出的 `components/share/ShareTargetPicker`
 * （**本文件没有改它一行 src**）；本文件只负责两件事：顶部预览区放什么（复用接收侧那张
 * `GroupCardFace`，所见即所得），以及选中之后怎么发。
 *
 * 发送语义（契约 `backend-docs/groups/群聊管理.md` §八）：
 * - 好友 → `POST /api/messages`，`receiver_id` + `message_type: 'group_card'`
 * - 群   → `POST /api/group_messages`，`group_id`（**承载会话**的群，不是被分享的群）
 * - `message_content` 只由 `buildGroupCardContent` 产出（封闭 schema，只有 group_id 一个键）
 *
 * 🔴 错误三态给三种不同的文案（`describeShareGroupCardError`）：400 / 403 / 404。
 * 尤其 403 必须说清是「你在**被分享的那个群**里的权限不够」而不是网络错误 ——
 * 说成网络错误用户会一直重试，而这条重试一万次也不会成功。
 * 多目标并行发送时任一失败即整体抛出（ShareTargetPicker 会把文案摆在面板上、
 * 面板不关、已选不清空，可直接重试）；三态里出现哪一个就报哪一个，**不合并成一句**。
 */

import { useCallback } from 'react';
import { useApi } from '../../contexts/SessionContext';
import { sendMessage } from '../../api/messages';
import { sendGroupMessage } from '../../api/groupMessages';
import { apiErrorStatus } from '../../api/client';
import { ShareTargetPicker, type ShareTarget } from '../../components/share/ShareTargetPicker';
import { resolveServerAvatarUrl } from '../../utils/avatar';
import type { GroupInfo } from '../../api/groups';
import { buildGroupCardContent, describeShareGroupCardError } from './groupCard';
import { GroupCardFace } from './GroupCardMessage';

interface ShareGroupCardModalProps {
  /** 被分享的群（来自 GET /api/groups/{id}/public） */
  group: GroupInfo;
  /** 退场动画播完后触发（调用方在此卸载本组件） */
  onClose: () => void;
}

export function ShareGroupCardModal({ group, onClose }: ShareGroupCardModalProps) {
  const api = useApi();

  const handleConfirm = useCallback(async (targets: ShareTarget[]) => {
    const content = buildGroupCardContent(group.group_id);
    try {
      await Promise.all(targets.map((item) => (item.type === 'friend'
        ? sendMessage(api, {
          receiver_id: item.id,
          message_content: content,
          message_type: 'group_card',
        })
        : sendGroupMessage(api, {
          group_id: item.id,
          message_content: content,
          message_type: 'group_card',
        }))));
    } catch (err) {
      const fallback = err instanceof Error ? err.message : '分享失败，请重试';
      throw new Error(describeShareGroupCardError(apiErrorStatus(err), fallback));
    }
  }, [api, group.group_id]);

  return (
    <ShareTargetPicker
      title="分享群名片"
      preview={(
        <GroupCardFace
          name={group.group_name}
          avatarUrl={resolveServerAvatarUrl(group.group_avatar_url)}
          subtitle={`${group.member_count} 位成员`}
        />
      )}
      onConfirm={handleConfirm}
      onClose={onClose}
    />
  );
}
