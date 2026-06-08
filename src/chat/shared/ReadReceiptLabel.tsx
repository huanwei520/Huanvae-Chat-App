/**
 * 已读回执小标签
 *
 * @module chat/shared
 * @location src/chat/shared/ReadReceiptLabel.tsx
 *
 * 在自己发出的消息气泡下方显示已读状态：
 * - 私聊："已读" / "未读"
 * - 群聊："N 人已读"
 *
 * 仅作纯展示，文本由调用方计算。用内联样式避免新增 CSS（颜色继承气泡前景色）。
 */

interface ReadReceiptLabelProps {
  /** 显示文本，如 "已读" / "未读" / "3 人已读" */
  text: string;
}

export function ReadReceiptLabel({ text }: ReadReceiptLabelProps) {
  return (
    <div
      className="read-receipt-label"
      style={{
        fontSize: '11px',
        opacity: 0.55,
        marginTop: '2px',
        textAlign: 'right',
        lineHeight: 1,
      }}
    >
      {text}
    </div>
  );
}
