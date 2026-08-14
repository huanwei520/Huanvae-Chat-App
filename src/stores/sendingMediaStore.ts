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
 *
 * ### 4. 在途预览的 object URL **由本 store 自己造、自己释放**（2026-08-13 修）
 * 此前是把待发区那把 URL 原样递进来的 —— 而发送动作的收尾恰恰是
 * `ChatInputArea.handleSend` 调 `composerTrayStore.clear`，它会当场 revoke 待发区每一把 URL。
 * 于是「上传中」那张图的 `<img src>` 指向一个刚被吊销的 blob ⇒ **破图**，
 * 用户看到的就是「一整块灰底 + 进度圈 + 破图问号」。
 *
 * 修法不是"晚一点再 revoke"（那要在两个 store 之间维护一份共享引用计数，必漏），
 * 而是**换所有权**：本 store 在 `enqueue` 时从 `seed.file` 现造一把，
 * 在条目离开队列的两条路径（`cancel` / `pruneConfirmed`）上释放。
 * 机器口径：{@link SendingMediaSeed} 的 `preview` 类型上**没有** `previewUrl` 字段 ——
 * 想把待发区那把递进来，TypeScript 直接不让过。
 *
 * ### 5. 原始像素尺寸**在这里兜底**，待发区那次探测只是抢跑（2026-08-13 修）
 * 「上传完成不跳版」靠的是在途占位与完成态用同一组 `width/height`。这组数有两个读取点，
 * 而且**都是异步**的：待发区 `composerTrayStore.probeDimensions`（加入待发区那刻起跑，
 * fire-and-forget）与上传链路 `hooks/useFileUpload`（`await`，结果交给后端 ⇒ 完成态恒是真实尺寸）。
 * 用户**粘贴后立刻按回车**时前者还没 resolve ⇒ seed 的 `width/height` 是 null ⇒
 * 在途走默认尺寸、完成态走真实尺寸 ⇒ 跳变原样复发。
 * ⇒ `enqueue` 对仍为 null 的项**再探一次**（{@link probeMissingDimensions}，同一个
 * `readMediaDimensions`），条目在队列里要活整个上传过程，毫秒级的探测有的是时间回填。
 */

import { create } from 'zustand';
import type { TrayItemKind } from '../chat/shared/composerTrayPlan';
import { peekMediaDimensions, readMediaDimensions } from '../utils/mediaDimensions';

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
  /**
   * 媒体的原始像素宽 / 高（读不出来为 null）。
   *
   * 在途占位用它走 `FileMessageContent.calculateDisplaySize`，与完成态那条
   * `image_width` / `image_height` 是**同一个函数、同一组数字** ⇒ 上传完成不跳版。
   *
   * 🔴 入队时**可能是 null**（用户没等待发区探测完就按了回车），此时由
   * {@link probeMissingDimensions} 异步补上 —— 见文件头第 5 点。
   */
  width: number | null;
  height: number | null;
  /**
   * 缩略图 object URL（图片/视频），文件为 null。
   *
   * 🔴 **本 store 自己造、自己释放**（见文件头第 4 点）。它不出现在
   * {@link SendingMediaSeed} 里 —— 调用方递不进来，也就不可能再递进一把
   * 「马上会被待发区 revoke 掉」的 URL。
   */
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
  /**
   * 本项的引用回复（被引用原消息的 `message_uuid`）。整批只有第一项有，与 {@link caption} 同一判定。
   *
   * 放进条目而不是留在发起处的闭包里，理由与 {@link file} 同：**单项重试**要能重发同一条引用；
   * 而"正在回复"那条草稿在发送收尾就被清掉了（ChatInputArea.handleSend），闭包里取不到。
   *
   * 🔴 群会话恒为 `undefined` —— 门开在 `useComposerTrayOutbox.send`（后端群分支丢弃 reply_to）。
   */
  replyTo?: string;
  /** 服务端确认后的真实 message_uuid；未确认为 null */
  realUuid: string | null;
  /** enqueue 时刻（ISO），乐观消息的 send_time */
  sendTime: string;
}

/**
 * enqueue 的入参：除运行期字段外全部由调用方给定。
 *
 * `preview.previewUrl` **不在这里** —— 那把 object URL 归本 store 所有（文件头第 4 点）。
 */
export type SendingMediaSeed =
  Omit<SendingMediaEntry, 'status' | 'percent' | 'error' | 'realUuid' | 'preview'>
  & { preview: Omit<SendingMediaPreview, 'previewUrl'> };

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

/**
 * 造本 store 自己那把在途预览 URL。
 *
 * 抽成函数与 composerTrayStore.makePreviewUrl 同一理由：jsdom 没有
 * `URL.createObjectURL`，直接调会抛，而那会让"入队"这条主路径在单测里根本跑不起来。
 */
function makeSendingPreviewUrl(kind: TrayItemKind, file: File): string | null {
  if (kind === 'file') { return null; }
  if (typeof URL.createObjectURL !== 'function') { return null; }
  return URL.createObjectURL(file);
}

function revokeSendingPreviewUrl(url: string | null | undefined): void {
  if (url && typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(url);
  }
}

/**
 * 补探一项的原始像素尺寸 —— 待发区那次探测还没 resolve、用户就按了回车的那条路径。
 *
 * ## 它修的是「零跳变」上一处结构性的漏
 *
 * 待发区 `composerTrayStore.probeDimensions` 是 fire-and-forget 的**抢跑**，不是保证：
 * 粘贴完立刻回车时它还没 resolve，`seed.preview.width/height` 就是 null。
 * 而上传侧（`hooks/useFileUpload`）自己 `await readMediaDimensions` 一次、无条件交给后端
 * ⇒ **完成态拿到的恒是真实尺寸**。两态一个默认、一个真实 ⇒ 上传完成那一刻跳版。
 * ⇒ 保证放在这里：条目在队列里要活整个上传过程（秒级），毫秒级的探测有的是时间回填。
 *
 * ## 三条取舍（与 composerTrayStore.probeDimensions 逐条同口径）
 * - **fire-and-forget**：`enqueue` 必须同步 —— 回车那一帧消息就要出现在列表最新处
 *   （`useComposerTrayOutbox.send` 也是同步的，改成 async 会动它所有调用方的契约）。
 * - **复用 {@link readMediaDimensions}**：全仓读媒体尺寸只有这一个函数。另写一份读法，
 *   两边的数迟早会漂 —— 而漂了的表现恰恰就是这里要修的"完成时跳一下"。
 * - **jsdom 没有 `URL.createObjectURL`**（`readMediaDimensions` 内部要用它），
 *   与 {@link makeSendingPreviewUrl} 同一个能力判断：没有就不探测，留 null。
 *
 * 回写前按 **File 身份**核对：期间这一项可能已被取消、或已被真实消息收掉
 * （`cancel` / `pruneConfirmed` 两条离队路径）⇒ 找不到就什么都不做，不复活它。
 *
 * ⚠️ **残余窗口（如实标注）**：上传比探测还快时（秒传命中的极小文件），回填会晚于条目离队
 * ⇒ 那一次仍按默认尺寸画完全程。它严格好于修复前（修复前是**永远**不回填），但不是零窗口。
 * 真要零窗口只能让 `send` 变成 async 去 await 探测，那会推迟"消息立刻出现"——
 * 拿一个更显眼的退化换一个更隐蔽的，不划算。
 *
 * 🔴 **2026-08-13 收窄**：`readMediaDimensions` 现在按 `File` 记忆结果，于是
 * - 待发区那次**已经 resolve**（哪怕回写时那一项已离开待发区、数字被丢掉）
 *   ⇒ {@link resolveSeedDimensions} 在入队那一帧**同步**就取到了，本函数根本不会被调用；
 * - 待发区那次**还在飞** ⇒ 本函数复用同一个 promise，接着等，不再从零重启一次解码。
 * 剩下的残余窗口只有「待发区那次根本还没 resolve，且上传先完成」这一种。
 */
function probeMissingDimensions(clientId: string, file: File, kind: TrayItemKind): void {
  if (kind === 'file' || typeof URL.createObjectURL !== 'function') { return; }
  void readMediaDimensions(file).then((dim) => {
    if (!dim || dim.width <= 0 || dim.height <= 0) { return; }
    useSendingMediaStore.setState((state) => {
      const prev = state.entries[clientId];
      if (!prev || prev.file !== file) { return state; }
      return {
        ...state,
        entries: {
          ...state.entries,
          [clientId]: {
            ...prev,
            preview: { ...prev.preview, width: dim.width, height: dim.height },
          },
        },
      };
    });
  });
}

/**
 * 入队那一刻能确定的尺寸 —— seed 自带优先，其次查**同步**记忆。
 *
 * 第二条修的是「已经算出来的数字被丢掉」这条路径：待发区的探测是 fire-and-forget，
 * 它 resolve 时那一项可能已被 `composerTrayStore.clear`（= 发送收尾）清掉 ⇒ 回写落空 ⇒
 * seed 里仍是 null。而那次解码的结果现在被 `utils/mediaDimensions` 按 `File` 记住了，
 * 这里同步就能取到 ⇒ 在途占位从第一帧起就是正确尺寸，**一帧默认尺寸都不画**。
 */
function resolveSeedDimensions(seed: SendingMediaSeed): { width: number | null; height: number | null } {
  if (seed.preview.width !== null && seed.preview.height !== null) {
    return { width: seed.preview.width, height: seed.preview.height };
  }
  const remembered = peekMediaDimensions(seed.file);
  if (remembered && remembered.width > 0 && remembered.height > 0) {
    return { width: remembered.width, height: remembered.height };
  }
  return { width: seed.preview.width, height: seed.preview.height };
}

export const useSendingMediaStore = create<SendingMediaStore>((set, get) => ({
  entries: {},
  orderByConversation: {},

  enqueue: (seeds) => {
    if (seeds.length === 0) { return; }
    // 先算一遍，set 与随后的补探判定用**同一组**结果 —— 两处各算一次必漂。
    const dimensions = seeds.map(resolveSeedDimensions);
    set((state) => {
      const entries = { ...state.entries };
      const order = { ...state.orderByConversation };
      seeds.forEach((seed, i) => {
        entries[seed.clientId] = {
          ...seed,
          // 自己造一把（不接待发区那把：它在发送收尾时就被 revoke 了，见文件头第 4 点）
          preview: {
            ...seed.preview,
            ...dimensions[i],
            previewUrl: makeSendingPreviewUrl(seed.preview.kind, seed.file),
          },
          status: 'pending',
          percent: 0,
          realUuid: null,
        };
        const key = seed.conversationKey;
        order[key] = [...(order[key] ?? []), seed.clientId];
      });
      return { entries, orderByConversation: order };
    });
    // 尺寸补探（异步）。写在 set 之后：回写要能在 state 里找到这一项。
    // 只补**同步也拿不到**的那些 —— 待发区抢跑成功（或其结果已被记住）是常见路径，
    // 那时已经是同一个函数读出的同一组数字，不必再走一次异步。
    seeds.forEach((seed, i) => {
      if (dimensions[i].width === null || dimensions[i].height === null) {
        probeMissingDimensions(seed.clientId, seed.file, seed.preview.kind);
      }
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
    // 条目离开队列 ⇒ 没有任何地方还会渲染它的预览，释放（本 store 造的，本 store 收）
    revokeSendingPreviewUrl(entry.preview.previewUrl);
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
    // 真实消息已经在列表里了（它自己走本地缓存 / 反代取源），乐观条目这一份预览到此为止
    settled.forEach((id) => revokeSendingPreviewUrl(state.entries[id]?.preview.previewUrl));
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
