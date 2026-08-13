/**
 * 待发区发送编排（乐观插入 → 串行上传 → 逐项落库）
 *
 * @module chat/shared
 * @location src/chat/shared/useComposerTrayOutbox.ts
 *
 * 回车之后发生的一切都在这里：把待发区按 {@link planComposerTraySend} 的四格矩阵切成形态，
 * 一次性把**全部**乐观条目压进 {@link useSendingMediaStore}（用户立刻在列表最新处看到它们），
 * 然后**串行**逐项上传，每项的百分比只推给自己那一条。
 *
 * ## 为什么这个 hook 挂在 ChatInputArea 而不是 useMainPage
 * 并行隔离：本轮 `useMainPage.ts` / `ChatPanel.tsx` 不归本单所有。
 * 而编排需要的东西全部可以自取 —— `chatTarget` 在 chatStore、`session`/`api` 在 SessionContext、
 * 上传器是本仓的 `useFileUpload` —— 所以把它做成自给自足的 hook，
 * ChatInputArea **一个新 props 都不用加**，两个父容器一行都不用改。
 *
 * ## 为什么串行
 * 与 albumSend.ts 同一条理由：并发会让组内各项到达顺序不可控，而后端按到达顺序分配 seq；
 * 组内 seq 乱序会让相册在对端「按 seq 倒序」的列表里被拆到不相邻的位置。
 *
 * ## 与「传一半失败」口径的差别（**刻意的**）
 * albumSend.runAlbumUpload 是「失败即停」：那条路径没有可重试的 UI，停下来才诚实。
 * 本路径 spec §四 明确要求「单个媒体上传失败 ⇒ **只有失败那一项显示重试**，不整条重发」，
 * 所以这里是「**失败即跳过、继续下一项**」，失败那项留在原位等用户点重试。
 * 两条口径并存不是漂移 —— 是因为 UI 能力不同；旧路径会在 M-5 接线单里被整体删除。
 */

import { useCallback, useEffect, useRef } from 'react';
import { useSession } from '../../contexts/SessionContext';
import { useChatStore } from '../../stores/chatStore';
import { useFileUpload, UPLOAD_CANCELLED, type MediaGroupMeta } from '../../hooks/useFileUpload';
import {
  useSendingMediaStore,
  type SendingMediaEntry,
  type SendingMediaSeed,
} from '../../stores/sendingMediaStore';
import type { TrayItem } from '../../stores/composerTrayStore';
import { ALBUM_MIN_ITEMS, planComposerTraySend, splitIntoShapes } from './composerTrayPlan';
import { newLocalSendClientId } from './useStickToBottom';
import { persistUploadedMessage } from './uploadPersist';
import { registerUploadAbort, releaseUploadAbort } from './uploadAbortRegistry';
import { getFriendConversationId } from '../../utils/conversationId';

/** 一次发送动作的结果，交给调用方决定 UI 反馈 */
export interface ComposerTraySendOutcome {
  /** 附件进了 outbox（>0 表示这次确实发了媒体） */
  enqueued: number;
  /** 没有附件时要单独发的纯文本；有附件时恒 null（文字已变成 caption） */
  standaloneText: string | null;
}

/** 组标识：客户端生成，服务端只校验不生成（backend-docs/storage 相册流程第 1 步） */
function newGroupId(): string {
  return crypto.randomUUID();
}

function mediaGroupOf(entry: SendingMediaEntry): MediaGroupMeta | undefined {
  const { shape } = entry;
  // 单条形态 ⇒ 不产出三件套。这是「单条不包相册」在上传参数这一段的表达。
  if (shape.kind !== 'album' || shape.groupId === null || shape.index === null || shape.count === null) {
    return undefined;
  }
  return { id: shape.groupId, index: shape.index, count: shape.count };
}

export function useComposerTrayOutbox(conversationKey: string | null) {
  const { session } = useSession();
  const chatTarget = useChatStore((s) => s.chatTarget);
  const { uploadFriendFile, uploadGroupFile } = useFileUpload();

  /** 串行闸：同一时刻只有一项在传 */
  const pumpingRef = useRef(false);
  // 取消用的 AbortController 表**不在这里** —— 它是模块级的 uploadAbortRegistry。
  // 放实例内的后果见那个模块的文件头：气泡侧的取消入口够不着 ref，abort 恒为 no-op。

  // 上传器 / session 会随 render 变，而泵是长跑的异步循环 —— 用 latest-ref 取最新值，
  // 否则泵里拿到的是启动那一刻的闭包（切账号后仍用旧 token 上传）。
  const depsRef = useRef({ session, uploadFriendFile, uploadGroupFile });
  depsRef.current = { session, uploadFriendFile, uploadGroupFile };

  const uploadOne = useCallback(async (entry: SendingMediaEntry): Promise<void> => {
    const store = useSendingMediaStore.getState();
    const { session: sess, uploadFriendFile: upFriend, uploadGroupFile: upGroup } = depsRef.current;
    if (!sess) {
      store.markFailed(entry.clientId, '未登录');
      return;
    }

    const controller = new AbortController();
    registerUploadAbort(entry.clientId, controller);
    store.markUploading(entry.clientId, 0);

    const mediaGroup = mediaGroupOf(entry);
    const isFriend = entry.conversationType === 'friend';
    const messageType = entry.preview.kind;

    try {
      const uploadOpts = {
        onProgress: (p: { percent: number }) => {
          useSendingMediaStore.getState().markUploading(entry.clientId, Math.round(p.percent));
        },
        signal: controller.signal,
      };
      const result = isFriend
        ? await upFriend(entry.file, entry.targetId, mediaGroup, entry.caption, uploadOpts)
        : await upGroup(entry.file, entry.targetId, mediaGroup, entry.caption, uploadOpts);

      // 🔴 取消的最后一道闸：signal 只在**分片边界**被检查（useFileUpload 的 signal 粒度说明），
      // 秒传命中 / 单分片小文件可能在两个检查点之间就把上传跑完了 —— 那一刻服务端的消息
      // 已经建好，追不回来；但本机绝不能再把它写进本地库、也不能标成已发，
      // 否则"点了取消，消息照样出现在自己的列表里"。
      if (controller.signal.aborted) {
        return;
      }

      if (!result.success) {
        throw new Error(result.error || '上传失败');
      }

      const realUuid = await persistUploadedMessage({
        result,
        file: entry.file,
        localPath: entry.preview.localPath || undefined,
        messageType,
        timestamp: entry.sendTime,
        session: sess,
        conversationType: entry.conversationType,
        conversationId: isFriend
          ? getFriendConversationId(sess.userId, entry.targetId)
          : entry.targetId,
        mediaGroup,
        caption: entry.caption,
      });

      if (!realUuid) {
        // 上传本身成功但服务端没回 message_uuid ⇒ 消息没建起来。如实报失败让用户重试，
        // 别把它当成功收掉 —— 那会留下一个"发过了但谁都看不到"的洞。
        throw new Error('服务端未返回消息标识');
      }
      useSendingMediaStore.getState().markSent(entry.clientId, realUuid);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === UPLOAD_CANCELLED) {
        // 用户主动取消：条目已在 cancelSendingItem 里移除，这里不再写状态（写了会把它复活）
        return;
      }
      useSendingMediaStore.getState().markFailed(entry.clientId, message);
    } finally {
      releaseUploadAbort(entry.clientId);
    }
  }, []);

  /** 串行泵：一直捞本会话最早的一个 pending 项来传，直到没有为止 */
  const pump = useCallback(async () => {
    if (pumpingRef.current || !conversationKey) { return; }
    pumpingRef.current = true;
    try {
      for (;;) {
        const state = useSendingMediaStore.getState();
        const ids = state.orderByConversation[conversationKey] ?? [];
        const next = ids
          .map((id) => state.entries[id])
          .find((e): e is SendingMediaEntry => !!e && e.status === 'pending');
        if (!next) { break; }
        // eslint-disable-next-line no-await-in-loop -- 串行是刻意的：保证组内 seq 单调（见文件头）
        await uploadOne(next);
      }
    } finally {
      pumpingRef.current = false;
    }
  }, [conversationKey, uploadOne]);

  // 有 pending 就开泵。用 selector 只订阅"还有几个 pending"，避免每次百分比变化都重跑。
  const pendingCount = useSendingMediaStore((s) => {
    if (!conversationKey) { return 0; }
    const ids = s.orderByConversation[conversationKey] ?? [];
    return ids.reduce((n, id) => (s.entries[id]?.status === 'pending' ? n + 1 : n), 0);
  });
  useEffect(() => {
    if (pendingCount > 0) { void pump(); }
  }, [pendingCount, pump]);

  /**
   * 回车：把待发区 + 文字变成消息。
   *
   * 形态在这一刻定死（{@link planComposerTraySend}），之后取消/失败都不再改变它。
   */
  const send = useCallback((items: readonly TrayItem[], text: string): ComposerTraySendOutcome => {
    const trimmed = text.trim();
    if (!session || !conversationKey || !chatTarget || chatTarget.type === 'ai') {
      return { enqueued: 0, standaloneText: null };
    }
    if (items.length === 0) {
      return { enqueued: 0, standaloneText: trimmed || null };
    }

    const conversationType: 'friend' | 'group' = chatTarget.type === 'group' ? 'group' : 'friend';
    const targetId = chatTarget.type === 'group' ? chatTarget.data.group_id : chatTarget.data.friend_id;

    // 先数出要几个组标识再生成 —— 纯计划函数不产生随机数（与 albumSend 同口径，便于单测）
    const albumShapes = splitIntoShapes(items).filter((s) => s.length >= ALBUM_MIN_ITEMS).length;
    const groupIds = Array.from({ length: albumShapes }, () => newGroupId());
    const plan = planComposerTraySend(items, text, groupIds);

    const sendTime = new Date().toISOString();
    const seeds: SendingMediaSeed[] = plan.items.map((p): SendingMediaSeed => ({
      // 前缀 client_ ⇒ useStickToBottom 判成「本机这次发送动作」⇒ 无条件滚到底
      clientId: newLocalSendClientId(),
      file: p.item.file,
      conversationKey,
      conversationType,
      targetId,
      shape: {
        kind: p.shapeKind,
        groupId: p.groupId ?? null,
        index: p.index ?? null,
        count: p.count ?? null,
      },
      preview: {
        name: p.item.file.name,
        kind: p.item.kind,
        size: p.item.file.size,
        localPath: p.item.localPath,
        // 原始像素尺寸：待发区加入时抢跑探测，**可能仍是 null**（没等探测完就回车）——
        // 那时由 sendingMediaStore.enqueue 用同一个 readMediaDimensions 补上，仍然零跳变。
        width: p.item.width,
        height: p.item.height,
        // 🔴 **不递 previewUrl**：待发区那把 object URL 在本次发送的收尾
        // （ChatInputArea.handleSend → clearTray）就会被 revoke，递过去等于递一个死链接
        // ——这正是"上传中显示破图"的真因。发送态自己从 file 造一把，见 sendingMediaStore。
        // 类型上也递不进来：SendingMediaSeed 的 preview 已 Omit 掉该字段。
        // ⚠️ 让上面那句成立的是 :206 那个**回调显式返回类型注解**，它不是冗余的：
        // 去掉它则 map 的 U 由回调自身推断、再把 U[] 赋给已注解的 seeds，
        // 这个位置**不触发 TS 的 excess property(freshness) 检查** ⇒ 多递一个
        // previewUrl 时 tsc 零报错（2026-08-13 实测 rc=0）。守它的机器锁见
        // tests/unit/sendingPreviewLifetime.test.ts 的「第 1 道锁：类型」那组。
      },
      caption: p.caption,
      sendTime,
    }));

    useSendingMediaStore.getState().enqueue(seeds);
    return { enqueued: seeds.length, standaloneText: plan.standaloneText };
  }, [session, conversationKey, chatTarget]);

  // 「重试 / 取消」不从这里返回：全仓唯一入口是模块级的 ./sendingMediaActions
  // （取消的按钮长在消息气泡里，够不着任何 hook 实例）。这里再返回一份等价实现
  // 就是第二份会漂的实现，且没有任何调用方 —— 见 .claude/CLAUDE.md「禁止死代码」。
  return { send };
}
