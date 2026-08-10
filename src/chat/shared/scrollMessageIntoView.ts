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
 */

/** 消息列表的真实滚动容器（桌面/移动同一个类名，见 src/styles/pages/main.css 与 mobile/chat-view.css） */
const MESSAGE_LIST_SELECTOR = '.chat-messages-container';

/**
 * 把 messageUuid 对应的气泡滚到消息列表容器的可视区中部。
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
  // 用「当前 scrollTop + 增量」而不是绝对值，才与 column-reverse 下 scrollTop 的符号约定无关
  // （消息列表是 column-reverse，ChatMessages.handleScroll 同样用 Math.abs 做符号无关处理）。
  const containerRect = container.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const delta =
    (elRect.top + elRect.height / 2) - (containerRect.top + containerRect.height / 2);
  container.scrollTop += delta;
  return true;
}
