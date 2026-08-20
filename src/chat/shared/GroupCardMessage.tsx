/**
 * 群名片消息气泡（`message_type: 'group_card'`）
 *
 * @location src/chat/shared/GroupCardMessage.tsx
 *
 * 形态对齐既有的 `MeetingInviteCard`：`message_content` 是一段 JSON 字符串，组件自己解析。
 * 区别在于**群名片的 JSON 里只有 group_id**（封闭 schema，见 `groupCard.ts` 文件头），
 * 群名 / 头像 / 成员数一律由本组件凭 group_id 现拉 `GET /api/groups/{id}/public`。
 *
 * 三种终态，**必须是三种不同的东西**（不许把任何一种渲染成空白或长期加载中）：
 * - `loading` —— 拉取中，占位骨架（有卡片轮廓，高度稳定，不跳版）
 * - `invalid` —— ① content 解不出 group_id（非法 JSON / 缺键 / 类型不对）
 *                ② `/public` 返回 404（群不存在或已解散 —— 契约明确要求渲染成失效态）
 *                ⇒ 卡片置灰、不可点、写明「群聊不存在或已解散」
 * - `ready`   —— 正常卡片；点击整卡走**已有的落地路径** `useGroupDetailStore.open(groupId)`，
 *                由 GroupDetailPanel 的多态主按钮处理「已加入 / 加入 / 申请 / 待通过 / 不可加入」。
 *                🔴 这里**不自己写任何加群逻辑**。
 *
 * 非 404 的拉取失败（断网等）不算失效：那是「暂时看不到群资料」，卡片仍可点进详情页重试，
 * 把它并进失效态会谎报「群没了」。
 *
 * 不做缓存（同一个群的多张卡片各拉一次）：本仓消息列表**没有虚拟化**，气泡挂上就不再卸载，
 * 每张卡一个会话内只拉一次；换来的是零缓存失效面。契约文档提到的「客户端可缓存」是可选优化。
 */

import { useEffect, useState } from 'react';
import { useApi } from '../../contexts/SessionContext';
import { useGroupDetailStore } from '../../stores';
import { getPublicGroupInfo, type GroupInfo } from '../../api/groups';
import { apiErrorStatus } from '../../api/client';
import { AvatarPlaceholder } from '../../components/common/AvatarPlaceholder';
import { resolveServerAvatarUrl } from '../../utils/avatar';
import { parseGroupCardContent } from './groupCard';
import './GroupCardMessage.css';

interface GroupCardMessageProps {
  /** 原始 message_content（一段 `{"group_id":"…"}` JSON 字符串） */
  messageContent: string;
}

/** 卡片正脸：群头像 + 群名 + 副行。发送侧的预览条复用同一张脸，两边不会长得不一样 */
export function GroupCardFace({
  name,
  avatarUrl,
  subtitle,
  muted = false,
}: {
  name: string;
  avatarUrl: string | null;
  subtitle: string;
  muted?: boolean;
}) {
  return (
    <div className={`group-card-face${muted ? ' group-card-face--muted' : ''}`}>
      <span className="group-card-avatar">
        {avatarUrl
          ? <img src={avatarUrl} alt="" />
          : <AvatarPlaceholder name={name} fontSize={18} />}
      </span>
      <span className="group-card-textcol">
        <span className="group-card-name">{name}</span>
        <span className="group-card-sub">{subtitle}</span>
      </span>
    </div>
  );
}

export function GroupCardMessage({ messageContent }: GroupCardMessageProps) {
  const api = useApi();
  const openGroupDetail = useGroupDetailStore((s) => s.open);
  const groupId = parseGroupCardContent(messageContent);

  const [info, setInfo] = useState<GroupInfo | null>(null);
  /** 群确实没了（/public 404）—— 与「网络问题拉不到」是两回事，见文件头 */
  const [missing, setMissing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!groupId) { return undefined; }
    let cancelled = false;
    setInfo(null);
    setMissing(false);
    setLoadFailed(false);
    getPublicGroupInfo(api, groupId)
      .then((g) => { if (!cancelled) { setInfo(g); } })
      .catch((err: unknown) => {
        if (cancelled) { return; }
        if (apiErrorStatus(err) === 404) {
          setMissing(true);
        } else {
          setLoadFailed(true);
        }
      });
    return () => { cancelled = true; };
  }, [api, groupId]);

  // 失效态：解不出 group_id，或群已不存在/已解散
  if (!groupId || missing) {
    return (
      <div className="group-card group-card--invalid">
        <div className="group-card-head">
          <span className="group-card-tag">群名片</span>
        </div>
        <GroupCardFace name="?" avatarUrl={null} subtitle="群聊不存在或已解散" muted />
      </div>
    );
  }

  const name = info?.group_name ?? '';
  const avatarUrl = resolveServerAvatarUrl(info?.group_avatar_url);

  const subtitle = (() => {
    if (info) { return `${info.member_count} 位成员`; }
    if (loadFailed) { return '群信息加载失败'; }
    return '加载中...';
  })();

  return (
    <button
      type="button"
      className="group-card"
      onClick={() => openGroupDetail(groupId)}
      aria-label={info ? `查看群聊 ${name}` : '查看群聊'}
    >
      <div className="group-card-head">
        <span className="group-card-tag">群名片</span>
      </div>
      <GroupCardFace
        name={name || (loadFailed ? '未知群聊' : '加载中...')}
        avatarUrl={avatarUrl}
        subtitle={subtitle}
      />
      <div className="group-card-foot">查看群聊</div>
    </button>
  );
}
