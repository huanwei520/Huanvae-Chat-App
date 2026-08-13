/**
 * 单项上传态覆盖层（类 Telegram：媒体自己在原地转圈）
 *
 * @module chat/shared
 * @location src/chat/shared/SendingMediaOverlay.tsx
 *
 * spec §三 的重点改动：进度**从输入框上方搬进消息气泡里的每个媒体自身**。
 * 本组件就是那一层 —— 绝对定位铺满父元素，按 clientId 订阅自己那一项的状态。
 *
 * ## 它对宿主的唯一要求
 * 父元素需要 `position: relative`（或任何非 static）。除此之外**不依赖宿主的任何内部结构**，
 * 所以气泡 / 相册格子 / 文件卡片都能直接套上去，接线时不用改它。
 *
 * ## 为什么按 clientId 订阅而不是接 props
 * 上传进度每秒变很多次。走 props 意味着每一次百分比变化都要从消息列表顶层往下重渲一整棵树；
 * 按 clientId 直接订阅 store，重渲只发生在这一个覆盖层内部，相邻的九张图纹丝不动。
 *
 * ## 状态与外观
 * | status | 外观 |
 * |---|---|
 * | pending | 遮罩 + 不确定态转圈（还没轮到它） |
 * | uploading | 遮罩 + 环形进度 + 百分比 + 取消 |
 * | failed | 遮罩 + 失败图标 + 重试 / 取消 |
 * | done | **不渲染任何东西**（真实消息马上就位，留着会闪一下双重渲染） |
 */

import { useSendingMediaStore, selectSendingEntry } from '../../stores/sendingMediaStore';

/** 环形进度的几何：半径 = 18，周长 = 2πr，描边靠 dashoffset 表达百分比 */
const RING_RADIUS = 18;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export interface SendingMediaOverlayProps {
  /** 乐观消息的 clientId（= 它的临时 message_uuid） */
  clientId: string | undefined;
  /** 点重试 */
  onRetry: (clientId: string) => void;
  /** 点取消 */
  onCancel: (clientId: string) => void;
}

/** 订阅单项发送态。宿主组件若只想读状态、不渲染覆盖层，可以直接用它。 */
export function useSendingMediaState(clientId: string | undefined) {
  return useSendingMediaStore(selectSendingEntry(clientId));
}

export function SendingMediaOverlay({ clientId, onRetry, onCancel }: SendingMediaOverlayProps) {
  const entry = useSendingMediaState(clientId);

  // 没有在途条目 / 已完成 ⇒ 什么都不画。done 也不画：真实消息此刻已经在列表里，
  // 覆盖层再停留一帧就是肉眼可见的"完成勾"闪一下。
  if (!entry || !clientId || entry.status === 'done') {
    return null;
  }

  const failed = entry.status === 'failed';
  const percent = entry.status === 'uploading' ? Math.min(100, Math.max(0, entry.percent)) : 0;
  const dashOffset = RING_CIRCUMFERENCE * (1 - percent / 100);

  return (
    <div
      className={`sending-media-overlay${failed ? ' sending-media-overlay--failed' : ''}`}
      data-testid="sending-media-overlay"
      data-status={entry.status}
      role="status"
      aria-label={failed ? `发送失败：${entry.error ?? '未知错误'}` : `上传中 ${percent}%`}
    >
      {failed ? (
        <div className="sending-media-failed">
          <span className="sending-media-failed-mark" aria-hidden="true">!</span>
          <div className="sending-media-actions">
            <button type="button" className="sending-media-btn" onClick={() => onRetry(clientId)}>
              重试
            </button>
            <button type="button" className="sending-media-btn" onClick={() => onCancel(clientId)}>
              取消
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="sending-media-ring-btn"
          onClick={() => onCancel(clientId)}
          title="取消上传"
          aria-label="取消上传"
        >
          <svg className="sending-media-ring" width="44" height="44" viewBox="0 0 44 44">
            <circle className="sending-media-ring-track" cx="22" cy="22" r={RING_RADIUS} />
            <circle
              className={`sending-media-ring-value${entry.status === 'pending' ? ' sending-media-ring-value--indeterminate' : ''}`}
              cx="22"
              cy="22"
              r={RING_RADIUS}
              strokeDasharray={RING_CIRCUMFERENCE}
              // pending 时不显示确定进度（还没轮到它传），交给 CSS 的旋转动画
              strokeDashoffset={entry.status === 'pending' ? RING_CIRCUMFERENCE * 0.75 : dashOffset}
            />
          </svg>
          <span className="sending-media-cancel-mark" aria-hidden="true">×</span>
        </button>
      )}
      {entry.status === 'uploading' && (
        <span className="sending-media-percent">{percent}%</span>
      )}
    </div>
  );
}
