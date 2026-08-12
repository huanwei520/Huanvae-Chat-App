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
 * **为什么是瞬时滚，不做平滑过渡**：本函数只有一个调用点（useMainPage 的定位 effect），
 * 而那条通路**必然**先走 locate*Message —— 它对消息列表做的是**整段替换**
 *（`setMessages(窗口)`，见 useLocalFriendMessages / useLocalGroupMessages）。
 * 整段换掉之后：
 *   1. 旧内容已经不在了，没有什么可供「平滑滚过」，动画只是空转；
 *   2. `behavior:'smooth'` 的动画会被紧随其后的任何 scrollTop 写入**打断**，停在半路
 *      —— JumpToLatestButton 真机实测过同一种失败（数据已是最新，画面停在中途）。
 * 所以这里与 JumpToLatestButton 的「有重载」分支同款：**双 rAF 等提交+绘制，然后瞬时到位**
 *（双 rAF 在调用方 useMainPage 里）。也因为一律瞬时，不再需要 prefers-reduced-motion 分支
 * —— 瞬时本来就是减弱动效想要的形态。
 * 配套：CSS 不得在该容器上声明 `scroll-behavior`（否则这里直接写 scrollTop 会被 CSS 变成
 * 平滑动画，重新引入上面第 2 种失败），该约束由 tests/unit/scrollMessageIntoView.test.ts 静态守卫。
 */

/** 消息列表的真实滚动容器（桌面/移动同一个类名，见 src/styles/pages/main.css 与 mobile/chat-view.css） */
const MESSAGE_LIST_SELECTOR = '.chat-messages-container';

/**
 * 定位滚动的「落定窗口」（ms）：这段时间内消息列表不响应「滚到窗口底自动加载更新」。
 *
 * 程序化写 scrollTop 会派发 scroll 事件（同帧~下一帧），而定位刚落定时目标常常离窗口的
 * 最新端很近 ⇒ `Math.abs(scrollTop) < 2*clientHeight` 成立 ⇒ 列表当场触发 onLoadNewer，
 * 一次接 50 条到视觉底部，随即 prepend 保位又直接改写 scrollTop —— 与刚落定的定位位置抢同一个属性。
 * 取一个宽裕到足以覆盖「自身那几个 scroll 事件」、又短到不会吃掉用户真实滚动意图的值。
 */
export const LOCATE_SCROLL_SETTLE_MS = 400;

/** 上一次定位滚动的落定截止时刻（epoch ms）；0 = 从未定位过 */
let locateScrollSettleUntil = 0;

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
  const nodes = Array.from(
    document.querySelectorAll<HTMLElement>('[data-message-uuid]'),
  );
  const el = nodes.find((n) => n.dataset.messageUuid === messageUuid);
  if (!el) {
    return false;
  }
  const container = el.closest<HTMLElement>(MESSAGE_LIST_SELECTOR);
  if (!container) {
    return false;
  }

  // block:'center' 的等价算法：把元素中心对齐容器中心。
  // 目标位由「当前 scrollTop + 增量」算出，因此与 column-reverse 下 scrollTop 的符号约定无关
  //（该容器 scrollTop 的取值区间是 [-(scrollHeight - clientHeight), 0]，负值合法 ——
  // 见 useScrollKeyboardControls 的 Home 键同样直接写负 scrollTop）。
  const containerRect = container.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const delta =
    (elRect.top + elRect.height / 2) - (containerRect.top + containerRect.height / 2);

  // 先开落定窗口再写 scrollTop：写入派发的 scroll 事件必须落在窗口**之内**才拦得住
  locateScrollSettleUntil = Date.now() + LOCATE_SCROLL_SETTLE_MS;
  container.scrollTop = container.scrollTop + delta;
  return true;
}
