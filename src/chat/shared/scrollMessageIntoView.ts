/**
 * 消息定位滚动 —— 把指定 message_uuid 的气泡滚进消息列表可视区中部。
 *
 * @module chat/shared/scrollMessageIntoView
 * @location src/chat/shared/scrollMessageIntoView.ts
 *
 * 桌面（ChatPanel）与移动（MobileChatView）复用同一套 ChatMessages / GroupChatMessages，
 * 滚动容器都是 `.chat-messages-container`，所以两端共用本函数。
 *
 * **为什么手算 scrollTop 而不是 el.scrollIntoView**：scrollIntoView 会沿祖先链冒泡，
 * 让每一个可滚祖先都把目标元素往自己的可视区里对齐 —— 点引用块定位靠底部的消息时，
 * 表现为整个 App 被顶上去（左侧会话栏头像只剩半截、群聊顶栏被推出可视区）。
 * 写法与 UnifiedList.scrollKeyIntoView / StockSearchBox.scrollOptionIntoView 一致，
 * 规范见 .claude/rules/common.md「element.scrollIntoView() 会沿祖先链冒泡」。
 *
 * **为什么是瞬时滚，不做平滑过渡**：本函数只有一个调用方（useMainPage 的定位 effect），
 * 但那条通路上它被调**两次**，两次都要瞬时：
 *   1. **先探一次**（不经 locate*Message）——「目标已经渲染在屏幕上」时直接滚过去就是答案，
 *      连 DB 都不用查（seq=0 的在途消息本来就进不了 seq 窗口，见 useMainPage 那段注释）；
 *   2. 探不到才走 locate*Message，它对消息列表做的是**整段替换**
 *      （`setMessages(窗口)`，见 useLocalFriendMessages / useLocalGroupMessages），
 *      提交+绘制之后（调用方的双 rAF）再滚第二次。
 * 两次都不做平滑，理由各自成立：
 *   · 第 2 次：旧内容已经整段换掉，没有什么可供「平滑滚过」，动画只是空转；
 *   · 两次都适用：`behavior:'smooth'` 的动画会被紧随其后的任何 scrollTop 写入**打断**，
 *     停在半路 —— JumpToLatestButton 真机实测过同一种失败（数据已是最新，画面停在中途），
 *     而本模块自己的 startRealign 在落定窗口内**就是**会反复写 scrollTop。
 * 也因为一律瞬时，不再需要 prefers-reduced-motion 分支 —— 瞬时本来就是减弱动效想要的形态。
 * 配套：CSS 不得在该容器上声明 `scroll-behavior`（否则这里直接写 scrollTop 会被 CSS 变成
 * 平滑动画，重新引入上面第 2 种失败），该约束由 tests/unit/scrollMessageIntoView.test.ts 静态守卫。
 */

/** 消息列表的真实滚动容器（桌面/移动同一个类名，见 src/styles/pages/main.css 与 mobile/chat-view.css） */
const MESSAGE_LIST_SELECTOR = '.chat-messages-container';

/**
 * 定位滚动的「落定窗口」（ms）：这段时间内
 *   ① 消息列表不响应「滚到窗口底自动加载更新」；
 *   ② 本模块持续盯着容器几何，列表一变就把落点重新对准（见 startRealign）。
 *
 * 程序化写 scrollTop 会派发 scroll 事件（同帧~下一帧），而定位刚落定时目标常常离窗口的
 * 最新端很近 ⇒ `Math.abs(scrollTop) < 2*clientHeight` 成立 ⇒ 列表当场触发 onLoadNewer，
 * 一次接 50 条到视觉底部，随即 prepend 保位又直接改写 scrollTop —— 与刚落定的定位位置抢同一个属性。
 *
 * 🔴 由 400 提到 900：真机实测（Android 14 / WebView 113，见下方 startRealign 的成因说明）
 * 一次定位后列表**至少还会再变两次**（实测 +186ms 与 +483ms 各一次），400ms 盖不住第二次。
 * 这个窗口现在同时是「重新对准」的预算，两者本就是同一件事（定位还没落定），故只留一个常量。
 */
export const LOCATE_SCROLL_SETTLE_MS = 900;

/** 落点残差小于它就算对准（亚像素抖动不值得再写一次 scrollTop） */
const LOCATE_ALIGN_EPSILON_PX = 2;

/** 用户自己动了的信号：见 startRealign「用户一旦自己动立刻收手」 */
const USER_TAKEOVER_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

/** 上一次定位滚动的落定截止时刻（epoch ms）；0 = 从未定位过 */
let locateScrollSettleUntil = 0;

/** 取消上一轮「重新对准」（新的定位来了 / 用户接管 / 预算用尽） */
let cancelRealign: (() => void) | null = null;

/**
 * 定位滚动是否仍在落定窗口内。
 *
 * 消息列表（ChatMessages / GroupChatMessages）的 scroll 处理据此抑制 auto-loadNewer，
 * 理由见 LOCATE_SCROLL_SETTLE_MS。
 */
export function isLocateScrollSettling(): boolean {
  return Date.now() < locateScrollSettleUntil;
}

/**
 * 把 messageUuid 对应的气泡瞬时滚到消息列表容器的可视区中部。
 *
 * 寻址面是 `[data-message-uuid]`：普通消息挂在消息行上，**相册的每一格各挂一个**
 *（相册把 N 条消息折叠成一个气泡，非代表成员不再产出消息行 —— 见 AlbumMessage）。
 *
 * @returns 是否真的完成了定位（false = DOM 里没有这条消息 / 它不在消息列表容器内）
 */
export function scrollMessageIntoView(messageUuid: string): boolean {
  const measured = alignOnce(messageUuid);
  if (!measured) {
    return false;
  }

  // 先开落定窗口再写 scrollTop：写入派发的 scroll 事件必须落在窗口**之内**才拦得住
  locateScrollSettleUntil = Date.now() + LOCATE_SCROLL_SETTLE_MS;
  startRealign(messageUuid, measured.container);
  return true;
}

/**
 * 量一次并把落点写进去。返回本次用到的容器（DOM 里没有这条消息 / 它不在列表容器内时返回 null）。
 *
 * block:'center' 的等价算法：把元素中心对齐容器中心。
 * 目标位由「当前 scrollTop + 增量」算出，因此与 column-reverse 下 scrollTop 的符号约定无关
 *（该容器 scrollTop 的取值区间是 [-(scrollHeight - clientHeight), 0]，负值合法 ——
 * 见 useScrollKeyboardControls 的 Home 键同样直接写负 scrollTop）。
 */
function alignOnce(messageUuid: string): { container: HTMLElement } | null {
  const nodes = Array.from(
    document.querySelectorAll<HTMLElement>('[data-message-uuid]'),
  );
  const el = nodes.find((n) => n.dataset.messageUuid === messageUuid);
  if (!el) {
    return null;
  }
  const container = el.closest<HTMLElement>(MESSAGE_LIST_SELECTOR);
  if (!container) {
    return null;
  }

  const containerRect = container.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const delta =
    (elRect.top + elRect.height / 2) - (containerRect.top + containerRect.height / 2);

  if (Math.abs(delta) > LOCATE_ALIGN_EPSILON_PX) {
    container.scrollTop = container.scrollTop + delta;
  }
  return { container };
}

/**
 * 落定窗口内盯着容器几何，**列表一变就重新对准**。
 *
 * ## 为什么非有不可（真机实测的失败，不是防御性编程）
 *
 * 定位这条通路上，「量位置」与「列表最终长什么样」根本不是同一帧的事：
 * `useMainPage` 的双 rAF 只能保证**它自己 await 的那次 `setMessages`（定位窗口）**已经提交并绘制，
 * 对**别的在途写入者**（`loadMessages` 的增量合并 / `loadMoreMessages` / `loadNewerMessages`
 * / 后台同步）一无所知。实测一次定位后列表还会再变两次。
 *
 * 最要命的一种（Android 14 / WebView 113 实测，群聊 410 条、定位 #200）：
 *   1. 量位置那一刻，容器里是「定位窗口 ∪ 上一批最新 50 条」的**并集**（111 条、9889px，
 *      中间有断档）—— 目标离底部比它在真正的窗口里远得多；
 *   2. 于是算出的 delta 按并集算（|scrollTop| 约 6700），写下去当时是合法值；
 *   3. 同一帧内 React 把列表提交成**纯窗口**（61 条、5289px）⇒ 可滚总量骤降 ⇒
 *      浏览器**静默把 scrollTop 夹到上限** 4577 ⇒ 落点变成窗口的**最旧端**。
 * 表现就是「定位 #200 却停在 #170~#178」，且**恒定偏 26 条**（跟目标多远无关，因为窗口恒为 61 条）。
 *
 * 关键在于：夹取是浏览器在**布局变化时**做的，写完立刻读回 scrollTop 是读不出来的
 *（那一刻还没夹）。所以判据只能是「几何变了就重新量」。
 *
 * ## 判据为什么是「容器几何变化」而不是「每帧都重对」
 * 每帧无条件重写 scrollTop 会与用户自己的滚动抢同一个属性；而
 * `scrollHeight` / 子节点数变化是「我量位置时依据的那份布局已经不存在了」的**直接证据**
 * —— 列表整段替换、续拉分页、图片加载完撑高，全都会改变它，而它们正是会把落点顶走的全部来源。
 * 几何没变就一个字节都不写。
 *
 * 用户一旦自己动（滚轮 / 触摸 / 按键）立刻收手：定位不该跟用户抢。
 */
function startRealign(messageUuid: string, container: HTMLElement): void {
  cancelRealign?.();

  const deadline = Date.now() + LOCATE_SCROLL_SETTLE_MS;
  let lastHeight = container.scrollHeight;
  let lastCount = container.childElementCount;
  let stopped = false;
  let rafId = 0;

  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    cancelAnimationFrame(rafId);
    for (const type of USER_TAKEOVER_EVENTS) {
      // 🔴 capture 必须与 addEventListener 那侧逐字对上：DOM 规范下
      // (type, callback, capture) 三元组才是监听器的身份，少写第三参 = capture:false =
      // **另一个**监听器条目，摘不掉。摘不掉的后果不是「多注册一次」而是每调用一次本函数
      // （点一次引用块 / 跳一次搜索结果）就在滚动容器上永久多挂 4 个监听，
      // 每个闭包还持着 container / messageUuid / rafId。
      container.removeEventListener(type, stop, { capture: true });
    }
    if (cancelRealign === stop) {
      cancelRealign = null;
    }
  };

  // 用户接管即收手（capture：滚轮/触摸在子节点上触发也算）
  for (const type of USER_TAKEOVER_EVENTS) {
    container.addEventListener(type, stop, { capture: true, passive: true });
  }

  const tick = () => {
    if (stopped) {
      return;
    }
    if (Date.now() >= deadline) {
      stop();
      return;
    }
    const height = container.scrollHeight;
    const count = container.childElementCount;
    if (height !== lastHeight || count !== lastCount) {
      lastHeight = height;
      lastCount = count;
      // 消息节点可能已被整段换掉，必须按 uuid 重新找（不能留着旧引用）
      if (!alignOnce(messageUuid)) {
        // 这条消息已经不在 DOM 里了（会话被切走 / 列表换了别的内容）——再对也没有意义
        stop();
        return;
      }
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
  cancelRealign = stop;
}
