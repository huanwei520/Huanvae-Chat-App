/**
 * 群消息气泡内的「被引用消息」块（Telegram 风格）
 *
 * @module chat/group
 * @location src/chat/group/ReplyQuote.tsx
 *
 * 渲染在气泡正文上方：左侧竖色条 + 被回复者名字 + 原消息单行摘要，整块可点击跳转到原消息。
 *
 * 用 <button> 而不是 <div role="button">：键盘可达（Tab/Enter/Space）和无障碍语义由原生元素给，
 * 不需要再手搓 keydown。onClick 里 stopPropagation 是必须的——外层气泡自己挂了 onClick
 * （多选切换 / 移动端双击全屏预览），不拦住会点一下引用块顺带触发它们。
 *
 * 纯展示组件：内容与「点击后干什么」都由调用方（GroupMessageBubble ← GroupChatMessages）决定，
 * 便于单测直接渲染断言，不必拖起 store / 消息列表。
 */

interface ReplyQuoteProps {
  /** 被回复者显示名；未命中原消息时为 null（只显示占位文案） */
  senderName: string | null;
  /** 原消息单行摘要，或未命中时的占位文案 */
  text: string;
  /** 是否命中了原消息（false 时置灰样式，提示这是占位而非真实内容） */
  resolved: boolean;
  /** 点击跳转到原消息 */
  onClick: () => void;
}

export function ReplyQuote({ senderName, text, resolved, onClick }: ReplyQuoteProps) {
  return (
    <button
      type="button"
      className={`reply-quote${resolved ? '' : ' reply-quote--unresolved'}`}
      onClick={(e) => {
        // 外层气泡有 onClick（多选切换 / 移动端双击预览），必须拦住冒泡
        e.stopPropagation();
        onClick();
      }}
      title="点击定位到原消息"
      aria-label={senderName ? `定位到 ${senderName} 的原消息` : '定位到原消息'}
    >
      <span className="reply-quote-bar" aria-hidden="true" />
      <span className="reply-quote-body">
        {senderName !== null && <span className="reply-quote-sender">{senderName}</span>}
        <span className="reply-quote-text">{text}</span>
      </span>
    </button>
  );
}
