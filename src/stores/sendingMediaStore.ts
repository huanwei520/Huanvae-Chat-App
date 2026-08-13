/**
 * 发送态 Store（Zustand）—— 类 Telegram「先出现、再变清晰」
 *
 * @location src/stores/sendingMediaStore.ts
 *
 * spec §三「发送态」：回车后待发区清空 ⇒ 消息**立刻出现在列表最新处**（乐观插入）⇒
 * **每个媒体在自己的位置转圈**（不是输入框上方一条总进度条）⇒ 全部完成后从最新处重新渲染。
 *
 * ⇒ 本 store 是那条「进度从输入框上方搬进气泡内部」的数据面：
 * 每一项一个 {@link SendingMediaEntry}，UI 侧（{@link import('../chat/shared/SendingMediaOverlay')}）
 * 按 `clientId` 订阅自己那一项，与相邻项互不影响。
 *
 * ## 三个不肯含糊的点
 *
 * ### 1. 形态在发送前定死（spec §五 第 5 问）
 * `shape` 是 enqueue 那一刻由 {@link import('../chat/shared/composerTrayPlan').planComposerTraySend}
 * 算好后写进条目的，此后**任何操作都不改它** —— 取消一项、某项失败，都不会把
 * `count=3` 的相册变成 `count=2`，更不会把相册退化成单条。
 * 理由：`media_group_count` 是**期望值**，后端按它排版；中途改了，已经发出去的那几条
 * 与还没发的那几条会声称不同的 count，对端相册直接算错高度。
 * 机器口径：本 store 没有任何一个 action 写 `shape`，`retry` / `cancel` 也不写 —— 见下方各 action。
 *
 * ### 2. 失败重试不改变位置（spec §五 第 3 问）
 * 顺序由 `orderByConversation` 在 enqueue 时一次性确定，`retry` 只把 `status` 从 `failed`
 * 打回 `pending`，**不动顺序数组** ⇒ 它还在原来的位置，不会跳到列表底部。
 *
 * ### 3. 临时 id ⇒ 真 id 的替换不重复（spec §五 第 2 问）
 * `clientId` 同时充当乐观消息的 `message_uuid`（与既有 sendTextMessage 的
 * `tempUuid = clientId` 同口径），前缀 `client_` 由
 * {@link import('../chat/shared/useStickToBottom').newLocalSendClientId} 产生 ——
 * 于是 useStickToBottom 直接把它判成「本机这次发送动作」⇒ **无条件滚到底**（spec §五 第 4 问），
 * 全仓仍然只有那一个判贴底的地方。
 * 上传成功后写 `realUuid`；消息列表侧的 {@link mergeSendingIntoMessages} 见到
 * `realUuid` 已经在真实消息里出现，就**不再渲染这个乐观条目** ——
 * 「先增后减」的交叉窗口里两者共存，但画面上永远只有一条，所以不闪也不重。
 */

import { create } from 'zustand';
import type { TrayItemKind } from '../chat/shared/composerTrayPlan';

/** 单项发送状态机的状态 */
export type SendingMediaStatus = 'pending' | 'uploading' | 'done' | 'failed';

/** 发送前定死的形态（后端媒体组三件套的本地镜像） */
export interface SendingMediaShape {
  /** `album` = 成组；`single` = 单条，**绝不带三件套** */
  kind: 'album' | 'single';
  /** 仅 album 有值 */
  groupId: string | null;
  index: number | null;
  count: number | null;
}

/** 乐观渲染需要的最小信息（不持有整棵 UI 树的知识） */
export interface SendingMediaPreview {
  name: string;
  kind: TrayItemKind;
  size: number;
  /** 本地绝对路径（可能为空串，见 TrayItem.localPath 说明） */
  localPath: string;
  /** 缩略图 object URL（图片/视频），文件为 null */
  previewUrl: string | null;
}

export interface SendingMediaEntry {
  /** 兼作乐观消息的 message_uuid 与 React key；前缀 `client_` */
  clientId: string;
  /**
   * 待上传的原文件。
   *
   * 放进 store 而不是留在发起处的闭包里，是因为**单项重试**要能重新上传同一份字节：
   * 闭包会随组件卸载/切会话消失，而重试按钮可能在那之后才被按下。
   * （store 因此不是纯可序列化数据，这是刻意的取舍。）
   */
  file: File;
  conversationKey: string;
  conversationType: 'friend' | 'group';
  /** friend_id 或 group_id */
  targetId: string;
  status: SendingMediaStatus;
  /** 0-100；仅 uploading 有意义 */
  percent: number;
  error?: string;
  /** 🔴 发送前定死，任何 action 都不改写 */
  shape: SendingMediaShape;
  preview: SendingMediaPreview;
  /** 本项的配文（整批只有第一项有） */
  caption?: string;
  /** 服务端确认后的真实 message_uuid；未确认为 null */
  realUuid: string | null;
  /** enqueue 时刻（ISO），乐观消息的 send_time */
  sendTime: string;
}

/** enqueue 的入参：除运行期字段外全部由调用方给定 */
export type SendingMediaSeed = Omit<SendingMediaEntry, 'status' | 'percent' | 'error' | 'realUuid'>;

interface SendingMediaState {
  entries: Record<string, SendingMediaEntry>;
  /** 每个会话的展示顺序，**先入先出**（index 0 = 最早入队的那一项） */
  orderByConversation: Record<string, string[]>;
}

interface SendingMediaActions {
  enqueue: (seeds: readonly SendingMediaSeed[]) => void;
  markUploading: (clientId: string, percent: number) => void;
  markSent: (clientId: string, realUuid: string) => void;
  markFailed: (clientId: string, error: string) => void;
  /** 单项重试：只把 failed 打回 pending，**不动顺序、不动 shape** */
  retry: (clientId: string) => void;
  /** 取消/放弃一项：从队列移除。**不改其余项的 shape** */
  cancel: (clientId: string) => void;
  /** 真实消息已经到列表里了 ⇒ 收掉对应的乐观条目 */
  pruneConfirmed: (conversationKey: string, presentUuids: ReadonlySet<string>) => void;
}

export type SendingMediaStore = SendingMediaState & SendingMediaActions;

const EMPTY_ORDER: string[] = [];

export const useSendingMediaStore = create<SendingMediaStore>((set, get) => ({
  entries: {},
  orderByConversation: {},

  enqueue: (seeds) => {
    if (seeds.length === 0) { return; }
    set((state) => {
      const entries = { ...state.entries };
      const order = { ...state.orderByConversation };
      for (const seed of seeds) {
        entries[seed.clientId] = { ...seed, status: 'pending', percent: 0, realUuid: null };
        const key = seed.conversationKey;
        order[key] = [...(order[key] ?? []), seed.clientId];
      }
      return { entries, orderByConversation: order };
    });
  },

  markUploading: (clientId, percent) => {
    set((state) => {
      const prev = state.entries[clientId];
      if (!prev) { return state; }
      return {
        ...state,
        entries: {
          ...state.entries,
          // shape / preview / caption 原样带过 —— 形态发送前定死
          [clientId]: { ...prev, status: 'uploading', percent, error: undefined },
        },
      };
    });
  },

  markSent: (clientId, realUuid) => {
    set((state) => {
      const prev = state.entries[clientId];
      if (!prev) { return state; }
      return {
        ...state,
        entries: {
          ...state.entries,
          [clientId]: { ...prev, status: 'done', percent: 100, error: undefined, realUuid },
        },
      };
    });
  },

  markFailed: (clientId, error) => {
    set((state) => {
      const prev = state.entries[clientId];
      if (!prev) { return state; }
      return {
        ...state,
        entries: { ...state.entries, [clientId]: { ...prev, status: 'failed', error } },
      };
    });
  },

  retry: (clientId) => {
    set((state) => {
      const prev = state.entries[clientId];
      if (!prev || prev.status !== 'failed') { return state; }
      return {
        ...state,
        entries: {
          ...state.entries,
          [clientId]: { ...prev, status: 'pending', percent: 0, error: undefined },
        },
      };
    });
  },

  cancel: (clientId) => {
    const entry = get().entries[clientId];
    if (!entry) { return; }
    set((state) => {
      const entries = { ...state.entries };
      delete entries[clientId];
      const key = entry.conversationKey;
      return {
        entries,
        orderByConversation: {
          ...state.orderByConversation,
          [key]: (state.orderByConversation[key] ?? []).filter((id) => id !== clientId),
        },
      };
    });
  },

  pruneConfirmed: (conversationKey, presentUuids) => {
    const state = get();
    const ids = state.orderByConversation[conversationKey] ?? EMPTY_ORDER;
    const settled = ids.filter((id) => {
      const e = state.entries[id];
      return e && e.realUuid !== null && presentUuids.has(e.realUuid);
    });
    if (settled.length === 0) { return; }
    set((s) => {
      const entries = { ...s.entries };
      settled.forEach((id) => delete entries[id]);
      return {
        entries,
        orderByConversation: {
          ...s.orderByConversation,
          [conversationKey]: (s.orderByConversation[conversationKey] ?? []).filter(
            (id) => !settled.includes(id),
          ),
        },
      };
    });
  },
}));

/**
 * 取某会话的全部在途条目（顺序 = 入队顺序）。
 *
 * ⚠️ 刻意**不是** zustand selector：它每次都要产出一个新数组，
 * 而 `useStore(selector)` 在选择器返回新引用时会无限重渲（useSyncExternalStore 的快照相等性）。
 * 调用方应当分别订阅 `entries` / `orderByConversation` 两个稳定引用，再用 `useMemo` 调本函数。
 */
export function pickSendingEntries(
  entries: Record<string, SendingMediaEntry>,
  orderByConversation: Record<string, string[]>,
  conversationKey: string | null,
): SendingMediaEntry[] {
  if (!conversationKey) { return []; }
  const ids = orderByConversation[conversationKey] ?? EMPTY_ORDER;
  return ids.map((id) => entries[id]).filter((e): e is SendingMediaEntry => !!e);
}

/** 取单项状态（覆盖层订阅这一个即可，相邻项变化不会让它重渲） */
export function selectSendingEntry(clientId: string | undefined) {
  return (state: SendingMediaStore): SendingMediaEntry | undefined =>
    clientId ? state.entries[clientId] : undefined;
}

/**
 * 把在途条目并进消息列表（**唯一**的合并口径）。
 *
 * @param messages 已排序的真实消息（index 0 = 最新）
 * @param entries  该会话的在途条目（入队顺序）
 * @param toMessage 把条目变成列表元素（私聊 / 群各给一份，字段形状不同）
 *
 * 去重两道，缺一条都会出现「同一条消息两份」：
 * 1. `realUuid` 已出现在真实消息里 ⇒ 丢弃该乐观条目（上传完成 → 落库 → 重灌 的交叉窗口）
 * 2. `clientId` 已出现在真实消息的 clientId 里 ⇒ 丢弃（防同一批被并两次）
 *
 * 顺序：乐观条目一律排在最前（列表 index 0 = 最新），组内按入队顺序**倒序**——
 * 列表是 DESC（最新在前），而入队顺序是 ASC，翻过来才能让第一张显示在最上面。
 */
export function mergeSendingIntoMessages<M extends { message_uuid: string; clientId?: string }>(
  messages: readonly M[],
  entries: readonly SendingMediaEntry[],
  toMessage: (entry: SendingMediaEntry) => M,
): M[] {
  if (entries.length === 0) { return messages as M[]; }
  const presentUuids = new Set(messages.map((m) => m.message_uuid));
  const presentClientIds = new Set(messages.map((m) => m.clientId).filter(Boolean));

  const pending = entries.filter(
    (e) =>
      !(e.realUuid !== null && presentUuids.has(e.realUuid)) &&
      !presentClientIds.has(e.clientId) &&
      !presentUuids.has(e.clientId),
  );
  if (pending.length === 0) { return messages as M[]; }

  const optimistic = pending.map(toMessage).reverse();
  return [...optimistic, ...messages];
}
