/**
 * 加好友「预览确认」流程 Hook（桌面 AddFriendTab + 移动 MobileAddPage 共用）
 *
 * 流程：输入用户 ID → 先 getPublicProfile 拉取对方公开资料 → 出确认卡（头像/昵称/@ID/签名）
 *      → 用户确认后再 sendFriendRequest 发送。查无此人给明确空态，避免盲发给不存在的 ID。
 *
 * 两端只写各自的 JSX，逻辑与状态在此收口，防止桌面/移动实现漂移。
 */

import { useCallback, useRef, useState } from 'react';
import { useApi, useSession } from '../contexts/SessionContext';
import { useChatStore } from '../stores';
import { sendFriendRequest } from '../api/friends';
import { getPublicProfile, type PublicProfileResponse } from '../api/profile';

export interface AddFriendFlow {
  /** 当前输入的用户 ID */
  friendId: string;
  /** 验证消息 */
  reason: string;
  /** 查找命中的公开资料（null=未查找或未找到） */
  preview: PublicProfileResponse | null;
  /** 查找请求进行中 */
  previewLoading: boolean;
  /** 查无此人（查找返回 404/错误） */
  notFound: boolean;
  /** 动作错误提示（发送失败 / 不能加自己） */
  error: string | null;
  /** 发送请求进行中 */
  sending: boolean;
  /** 已发送 */
  sent: boolean;
  /** 当前输入的 ID 是否已是好友 */
  isFriend: boolean;
  /** 改 ID（会清空上一次预览，避免旧确认卡串台） */
  setFriendId: (v: string) => void;
  /** 改验证消息 */
  setReason: (v: string) => void;
  /** 查找该用户（拉公开资料出确认卡） */
  lookup: () => Promise<void>;
  /** 重置为「未查找」态（重新查找 / 关闭确认卡） */
  reset: () => void;
  /** 确认发送好友请求 */
  send: () => Promise<void>;
}

export function useAddFriendFlow(onSent?: () => void): AddFriendFlow {
  const api = useApi();
  const { session } = useSession();
  const friends = useChatStore((s) => s.friends);

  const [friendId, setFriendIdState] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<PublicProfileResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  // 查找代次：每次改 ID / 发起新查找自增，使进行中的旧查找 resolve 后作废，
  // 避免"输 bob→查找中→改成 carol→bob 结果回来把预览卡设成 bob"的串台。
  const lookupSeq = useRef(0);

  const reset = useCallback(() => {
    setPreview(null);
    setNotFound(false);
    setError(null);
    setSent(false);
  }, []);

  const setFriendId = useCallback((v: string) => {
    lookupSeq.current += 1; // 作废进行中的旧查找
    setFriendIdState(v);
    // 改 ID 即回到「未查找」态
    setPreview(null);
    setNotFound(false);
    setError(null);
    setSent(false);
  }, []);

  const trimmedId = friendId.trim();
  const isFriend = friends.some((f) => f.friend_id === trimmedId);

  const lookup = useCallback(async () => {
    const id = friendId.trim();
    if (!id) { return; }
    setError(null);
    setNotFound(false);
    setPreview(null);
    if (session && id === session.userId) {
      setError('不能添加自己为好友');
      return;
    }
    const seq = (lookupSeq.current += 1);
    setPreviewLoading(true);
    try {
      const p = await getPublicProfile(api, id);
      if (seq !== lookupSeq.current) { return; } // 已被更新的查找/改 ID 作废，丢弃过期结果
      setPreview(p);
    } catch {
      if (seq !== lookupSeq.current) { return; }
      // 查无此人（404）或其它错误 → 明确空态
      setNotFound(true);
    } finally {
      // 仅当仍是最新一次查找时才收起 loading（否则由更新的查找自行管理）
      if (seq === lookupSeq.current) { setPreviewLoading(false); }
    }
  }, [api, friendId, session]);

  const send = useCallback(async () => {
    const id = friendId.trim();
    if (!id || !session || sending || sent) { return; }
    setSending(true);
    setError(null);
    try {
      await sendFriendRequest(api, session.userId, id, reason.trim() || undefined);
      setSent(true);
      onSent?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败');
    } finally {
      setSending(false);
    }
  }, [api, friendId, reason, session, sending, sent, onSent]);

  return {
    friendId,
    reason,
    preview,
    previewLoading,
    notFound,
    error,
    sending,
    sent,
    isFriend,
    setFriendId,
    setReason,
    lookup,
    reset,
    send,
  };
}
