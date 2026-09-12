/**
 * 共享端授权弹层（meeting 窗内；spotlight overlay 形态先例 MeetingPage.tsx:796-835）
 *
 * 生命周期＝设计 §3.2 T4/T6：N1 到达（或 dev 模拟）→ pending 30s 倒计时，
 * 接受/拒绝/超时自动消失 → 经 onDecide 回调交 meeting 桥发裁决事件（主窗发 M2）。
 *
 * @module remote-control/ControlAuthPopup
 */

import { useCallback, useEffect, useState } from 'react';
import { AppButton } from '../components/common/AppButton';
import type { ControlSessionRequestedData } from './types';

/** pending TTL（§3.3：30s，与申请端计时器对称） */
const PENDING_TTL_MS = 30_000;

export interface ControlAuthPopupProps {
  request: ControlSessionRequestedData | null;
  /** 裁决回调（approved + grant_id 由主窗/模拟链路生成） */
  onDecide: (approved: boolean, request: ControlSessionRequestedData) => void;
}

export function ControlAuthPopup({ request, onDecide }: ControlAuthPopupProps) {
  const [remainSec, setRemainSec] = useState(30);

  useEffect(() => {
    if (!request) { return; }
    setRemainSec(Math.ceil(PENDING_TTL_MS / 1000));
    const started = Date.now();
    const t = setInterval(() => {
      const left = Math.max(0, Math.ceil((PENDING_TTL_MS - (Date.now() - started)) / 1000));
      setRemainSec(left);
      if (left <= 0) {
        clearInterval(t);
        onDecide(false, request); // T6：30s 自动消失＝拒绝
      }
    }, 250);
    return () => clearInterval(t);
  }, [request, onDecide]);

  const decide = useCallback(
    (approved: boolean) => {
      if (request) { onDecide(approved, request); }
    },
    [request, onDecide],
  );

  if (!request) { return null; }

  return (
    <div className="rc-auth-overlay">
      <div className="rc-auth-card">
        <div className="rc-auth-card__icon">🕹</div>
        <h3>收到远程控制申请</h3>
        <p>
          <b>{request.from?.display_name || request.from?.user_id || '对方'}</b>{' '}
          申请控制你正在共享的屏幕
        </p>
        {request.meeting_ctx && (
          <p>会议房间：{request.meeting_ctx.room_id}</p>
        )}
        <p className="rc-auth-card__timer">{remainSec}s 后自动拒绝</p>
        <div className="rc-auth-card__actions">
          {/* 控件收敛：AppButton 统一按钮体系（design-system 控件规范，app-button.css）；
              拒绝=secondary（浅底次操作）· 接受=primary（主行动蓝渐变，替代旧硬编码
              #4f8cff/#2f6bff 渐变）；block 双钮等宽撑满，与旧 .rc-auth-btn flex:1 布局契约一致 */}
          <AppButton variant="secondary" block onClick={() => decide(false)}>
            拒绝
          </AppButton>
          <AppButton variant="primary" block onClick={() => decide(true)}>
            接受
          </AppButton>
        </div>
      </div>
    </div>
  );
}

export default ControlAuthPopup;
