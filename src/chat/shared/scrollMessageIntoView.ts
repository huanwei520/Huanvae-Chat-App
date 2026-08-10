/**
 * 消息定位滚动 —— 把指定 message_uuid 的气泡平滑滚进消息列表可视区中部。
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
 * **平滑过渡为什么用 container.scrollTo 而不是 rAF 逐帧写 scrollTop**：
 * `scrollTo` 作用在**指定容器**上（同样不冒泡到祖先，保住上面那条），由浏览器接管滚动，
 * 天然可被用户滚动打断、无需自建取消逻辑，也不会与 column-reverse 的原生底锚
 * （新消息到达时的自动贴底）逐帧抢同一个 scrollTop。rAF 手动缓动则要自己处理这三件事，
 * 且属于「JS 逐帧接管属性」，还得额外守 .claude/rules/animation.md 的单一所有权。
 * 配套：CSS 不得在该容器上声明 `scroll-behavior`（否则下面的瞬时分支会被 CSS 变成平滑，
 * 减弱动效降级失效），该约束由 tests/unit/scrollMessageIntoView.test.ts 静态守卫。
 */

/** 消息列表的真实滚动容器（桌面/移动同一个类名，见 src/styles/pages/main.css 与 mobile/chat-view.css） */
const MESSAGE_LIST_SELECTOR = '.chat-messages-container';

/** 系统「减弱动效」开启时不做平滑过渡，直接瞬时定位（同 useEdgeSwipeBack 的兜底口径）。 */
function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * 把 messageUuid 对应的气泡平滑滚到消息列表容器的可视区中部。
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
  const top = container.scrollTop + delta;

  if (prefersReducedMotion()) {
    container.scrollTop = top;
    return true;
  }
  container.scrollTo({ top, behavior: 'smooth' });
  return true;
}
