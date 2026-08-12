/**
 * 新消息到达时「要不要把消息列表滚回最新一条」—— 私聊(含 bot)与群聊共用的**唯一**判据。
 *
 * @module chat/shared
 * @location src/chat/shared/useStickToBottom.ts
 *
 * ## 为什么需要它（现网缺陷的成因）
 * 消息列表是 `flex-direction: column-reverse` 自锚定底部，全仓**没有任何 JS「滚到底」调用**。
 * `column-reverse` 下只有 `|scrollTop| ≈ 0` 才叫贴底；用户**上滑过**之后 `|scrollTop| > 0`，
 * 新消息虽被 prepend 到视觉底部，浏览器只是保持用户当前视位 ⇒ 它落在视口之外。
 * 这个「在底部时跟随、上滑时不打扰」对**别人发来的**消息是**正确**行为（读历史不该被拽走），
 * 错在它**没有对『我刚按了发送』开例外**，也没有对「最新那条其实还看得见」开例外。
 *
 * ## 行为矩阵（huanwei 2026-08-12 定）
 * | 新到达的这条 | 判据 | 行为 |
 * |---|---|---|
 * | **本机这次发送动作**（乐观插入 / 重试 / 文件上传后回灌） | — | **无条件滚到底** |
 * | 实时推送（别人发来 **或** 多端回流的自己消息） | 最新一条**插入前**能被看到（露出任何一部分即算） | 滚到底 |
 * | 实时推送 | 最新一条**插入前**被完全遮住 | **不滚**（保持正确行为） |
 * | 非实时（loadMore / loadNewer / jumpToLatest / 首次加载） | — | 不滚（各自有自己的滚动语义） |
 *
 * ## 判据为什么是「可见性」而不是「离底距离比例」
 * 比例是**间接量**且要挑分母：取内容总高 ⇒ 阈值随聊天记录长度线性膨胀、历史几千条时退化成恒真，
 * 把「读历史不被拽走」直接毁掉；取视口高则又是另一套需要解释的魔数。
 * 而「最新那条看不看得见」是**直接、可观测**的量，也正是用户真正在意的东西 ——
 * 故用 `IntersectionObserver` 直接观察最新那条消息元素，不做任何 scrollTop 数学。
 * 附带好处：`column-reverse`、动态高度（图片加载）、将来的虚拟化都不会把它算错。
 *
 * **「遮住」= 完全不可见**：只要最新那条露出任何一部分就算「能被看到」⇒ 滚到底
 * （`threshold: 0` + `isIntersecting`）。依据是 huanwei 原话「注意，是**遮住**」并对举「能被看到」；
 * 露一点点说明用户就在底部附近，滚过去不打扰。
 * 🔴 这条边界是 leader 替他定的，若判定过松需回到他那里改 threshold。
 *
 * ## 「本机这次发送动作」怎么和「多端回流」区分开
 * **不看 `sender_id === 我`** —— 在别的设备发的消息推回本机时 `sender_id` 同样是我，
 * 但那一刻并没有「我刚按了发送」这个意图信号，此刻用户可能正在本机读历史。
 * 真正的物证是 `clientId` 的**产生方**：
 * - `client_*` —— 只由本机四个乐观插入点产生（见 {@link newLocalSendClientId}）⇒ 本机发送动作
 * - `ws_*`     —— 由 WS 推送分支产生（useLocalFriendMessages / useLocalGroupMessages 的「情况 3」），
 *                 **多端回流的自己消息也走这里**（本地没有 `sending` 占位可替换 ⇒ 落到新消息分支）⇒ 按「别人发来」处理
 * - 无 `clientId` —— `localMessageToMessage` / `localMessageToGroupMessage` 不带该字段 ⇒ DB 加载，非实时
 *
 * 前缀的**生成与判读放在同一处**是刻意的：分开写则改一边、另一边静默失效（判据变恒假，无人复查）。
 *
 * ## 已知不覆盖（如实标注）
 * 文件/图片/视频发送走的是「上传成功 → 落库 → `loadFriendMessages()` 重新读 DB」，
 * **没有乐观插入**，重灌回来的消息不带 `clientId`。故该路径不靠前缀，而靠调用方在
 * 重灌之前显式打一次 {@link markLocalSend}（见 useMainPage.handleFileSelect）。
 * 这不是第二条决策路径 —— 决策只有 {@link shouldStickToBottom} 一个，这里只是同一个
 * 「本机发送动作」证据的第二个来源。
 */

import { useEffect, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

/** 本机乐观插入产生的 clientId 前缀 —— 「我刚按了发送」的唯一物证 */
export const LOCAL_SEND_CLIENT_ID_PREFIX = 'client_';

/** WS 实时推送产生的 clientId 前缀（含多端回流的自己消息） */
export const REALTIME_PUSH_CLIENT_ID_PREFIX = 'ws_';

/**
 * 消息定位锚点选择器。普通消息挂在消息行上；**相册把行上的锚点让给了格子**
 * （见 MessageBubble `data-message-uuid={album ? undefined : ...}` 与 AlbumMessage），
 * 故相册头会命中它的第一个格子 —— 仍在「最新那个渲染节点」之内，可见性语义不变。
 */
const MESSAGE_ANCHOR_SELECTOR = '[data-message-uuid]';

/**
 * 生成一个「本机发送」clientId。
 *
 * 四个乐观插入点（私聊文本/媒体、群聊文本/媒体）**必须**走这里而不是各自拼字符串：
 * 前缀是 {@link classifyNewHead} 唯一的判读面，散着写就会有人改一处而让判据静默失效。
 */
export function newLocalSendClientId(): string {
  return `${LOCAL_SEND_CLIENT_ID_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/** 列表头那条消息的来源分类 */
export type NewHeadKind =
  /** 本机这次发送动作（乐观插入 / 重试） */
  | 'own-local-send'
  /** WS 实时推送：别人发来，**或**多端回流的自己消息 */
  | 'realtime-incoming'
  /** 非实时：DB 加载（loadMore / loadNewer / jumpToLatest / 首次加载） */
  | 'not-realtime';

/**
 * 按 clientId 的产生方判定列表头的来源。
 *
 * @param clientId 列表头那条消息的 clientId（无则为 undefined）
 */
export function classifyNewHead(clientId: string | undefined): NewHeadKind {
  if (!clientId) {
    return 'not-realtime';
  }
  if (clientId.startsWith(LOCAL_SEND_CLIENT_ID_PREFIX)) {
    return 'own-local-send';
  }
  if (clientId.startsWith(REALTIME_PUSH_CLIENT_ID_PREFIX)) {
    return 'realtime-incoming';
  }
  return 'not-realtime';
}

/**
 * 唯一的决策函数。全仓不该再有第二处判「要不要贴底」。
 *
 * @param kind                列表头的来源分类
 * @param latestVisibleBefore 最新那条消息在**这条新消息插入之前**是否可见（露出任何一部分即为 true）
 */
export function shouldStickToBottom(kind: NewHeadKind, latestVisibleBefore: boolean): boolean {
  // 非实时：DB 重灌。loadNewer 在定位窗口态下也走这里 —— 它要的是「保持视位」，
  // 贴底会把用户从窗口里弹走；jumpToLatest 自己会滚，不需要也不该由这里代劳。
  if (kind === 'not-realtime') {
    return false;
  }
  // 「我刚按了发送」本身就表达了「我要看它」——无条件。
  if (kind === 'own-local-send') {
    return true;
  }
  // 别人发来 / 多端回流：最新那条原本看得见才跟，被完全遮住说明用户在读历史，不打扰。
  return latestVisibleBefore;
}

/**
 * 「本机发送动作」的一次性标记，供**没有乐观插入**的发送路径使用（文件/图片/视频上传后重灌 DB）。
 *
 * 由下一次列表头变化消费一次。调用点必须尽量贴近「消息已确定发出、马上要重灌列表」那一刻
 * （而不是上传开始时）—— 窗口越短，越不可能被同期到达的别人消息误消费。
 */
let localSendPending = false;

/** 打标记：本机刚完成一次发送，下一次列表头变化按「本机发送」处理 */
export function markLocalSend(): void {
  localSendPending = true;
}

/** 取走标记（取完即清）。仅本模块的 hook 在「列表头确实变了」时调用 */
function consumeLocalSendMark(): boolean {
  const marked = localSendPending;
  localSendPending = false;
  return marked;
}

/** 测试用：清掉残留标记，避免用例之间互相污染 */
export function resetLocalSendMarkForTest(): void {
  localSendPending = false;
}

/**
 * 等两帧（提交 + 绘制都已落定）后把容器**瞬时**贴回最新一条（column-reverse 下即 scrollTop = 0）。
 *
 * 两个「等两帧」的理由各自独立，缺一条都会翻车（都是真机实测过的）：
 * 1. 调用方可能刚触发一次异步重载 —— `await` 只等到上层 `setState` 被调用、React 尚未提交，
 *    此刻滚的是**旧 DOM**（JumpToLatestButton 踩过）。
 * 2. 消息列表自己还有一个 prepend 保位的 `useLayoutEffect`（底部长出内容时把 scrollTop 推回去）。
 *    它与本函数抢同一个属性，而 layout effect 的先后取决于声明顺序 —— 把滚动压到帧之后，
 *    结果就与声明顺序**无关**，不必靠"记得把 hook 放在那个 effect 后面"这种隐式约定。
 *
 * 一律**瞬时**、不用 `behavior:'smooth'`：平滑动画会被紧随其后的 scrollTop 写入 / 内容替换打断，
 * 停在半路（真机实测：数据已是最新，画面却停在中途）。
 * 也绝不用 `el.scrollIntoView` —— 它沿祖先链冒泡，会把整个 App 外壳顶上去
 * （见 .claude/rules/common.md）。
 *
 * **刻意不返回取消函数**：
 * - 卸载安全由末尾的 `containerRef.current` 判空兜住 —— React 卸载时会把它置 null，
 *   悬挂的那两帧回调什么也不做。
 * - 更要紧的是**不能**把它当 effect cleanup 用：那样「下一条消息到达」就会取消上一条还没落地的
 *   滚动。真实后果是 —— 我刚按下发送（必须滚底），紧跟着 32ms 内来了一条别人的消息且我正在读历史
 *   （不该滚），我那次发送的滚动就被吃掉了，现网缺陷间歇性复发。
 *   落点全是 `scrollTop = 0`，重复执行幂等，让它们各自落地才是对的。
 */
export function scrollToLatestAfterTwoFrames(containerRef: RefObject<HTMLElement | null>): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const container = containerRef.current;
      if (container) {
        container.scrollTop = 0;
      }
    });
  });
}

/** hook 对消息形态的最小要求：`Message` 与 `GroupMessage` 都满足 */
export interface StickToBottomMessage {
  message_uuid: string;
  clientId?: string;
}

/**
 * 新消息到达时按 {@link shouldStickToBottom} 决定是否把容器滚回最新一条。
 *
 * @param containerRef 消息列表滚动容器（`.chat-messages-container--reverse`）
 * @param messages     **已排序**的消息列表，index 0 = 最新（column-reverse 下的视觉底部）
 */
export function useStickToBottom<T extends StickToBottomMessage>(
  containerRef: RefObject<HTMLElement | null>,
  messages: readonly T[],
): void {
  const head = messages.length > 0 ? messages[0] : undefined;
  const headKey = head ? (head.clientId ?? head.message_uuid) : null;
  const headClientId = head?.clientId;

  /**
   * 最新那条**在新消息插入之前**是否可见。
   *
   * 🔴 这个 ref 是本 hook 防「判据恒真」的关键：新消息一进 DOM 就贴在视觉底部、当场"可见"，
   * 插入后现算必然恒真 ⇒ 退化成无条件滚底，把「读历史不被拽走」弄坏。
   * 所以由 IntersectionObserver **持续**写入，决策时只**读**它 ——
   * 读到的值反映的是「上一个头」的可见性，也就是这条新消息插入前的状态。
   * 重定向观察对象的 effect 是 `useEffect`（绘制后），排在决策用的 `useLayoutEffect`（绘制前）之后，
   * 故决策那一刻它一定还没被新头刷新过。
   *
   * 初值 true：挂载时 column-reverse 天然贴底，最新那条必然可见。
   */
  const latestVisibleRef = useRef(true);
  const prevHeadKeyRef = useRef<string | null>(null);

  // 决策 + 滚动。DOM 已提交，但 latestVisibleRef 尚未被新头刷新（见上）
  useLayoutEffect(() => {
    const prevHeadKey = prevHeadKeyRef.current;
    prevHeadKeyRef.current = headKey;

    // 头没换 = 没有新消息到达（loadMore 往 DOM 末尾追加旧消息、发送 ack 回填 uuid 都属此类）。
    // prevHeadKey 为 null = 本会话首帧，column-reverse 已经贴底，不需要也不该滚。
    if (headKey === null || prevHeadKey === null || headKey === prevHeadKey) {
      return;
    }

    // 标记优先于前缀：文件上传路径重灌回来的消息不带 clientId，只能靠标记认领。
    // 必须在「头确实变了」之后才消费，否则会被无关的重渲染吃掉。
    const kind: NewHeadKind = consumeLocalSendMark()
      ? 'own-local-send'
      : classifyNewHead(headClientId);

    if (!shouldStickToBottom(kind, latestVisibleRef.current)) {
      return;
    }
    // 不接 cleanup：见 scrollToLatestAfterTwoFrames 的说明 ——
    // 把它当 cleanup 会让紧随其后的一条消息取消掉本次（尤其"我刚发送"）的滚动。
    scrollToLatestAfterTwoFrames(containerRef);
  }, [headKey, headClientId, containerRef]);

  // 把观察对象跟到当前最新那条上。headKey 变一次换一次；
  // IO 在 observe 之后会异步回报一次初始状态，正好把 ref 更新成「新头的可见性」。
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    // DOM 首个带锚点的元素 = 最新那条（占位符不带锚点，气泡按 DESC 渲染）
    const target = container.querySelector<HTMLElement>(MESSAGE_ANCHOR_SELECTOR);
    if (!target) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const last = entries[entries.length - 1];
        if (last) {
          // threshold 0 + isIntersecting = 「露出任何一部分」即为可见（= 没被遮住）
          latestVisibleRef.current = last.isIntersecting;
        }
      },
      { root: container, threshold: 0 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [containerRef, headKey]);
}
