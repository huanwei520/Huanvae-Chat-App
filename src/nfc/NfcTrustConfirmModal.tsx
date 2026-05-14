/**
 * NFC 信任确认 modal
 *
 * 渲染时机：扫到陌生 (uid, payload_hash) 的卡片 + 指令在白名单内 → 弹此 modal
 * 用户点"信任并执行" → addTrusted + dispatch；"取消" → 回 idle
 *
 * 设计决策：
 * - 不用 framer-motion variants（v1 简化，避免 animation-conflict 注册麻烦）
 * - 文本不可被卡片内容篡改：UID 只显示前 8 字符，payload_hash 显示前 16 字符
 *   summary 由 summarizeAction 生成（host 而非完整 URL）
 */

import { AppButton } from '../components/common/AppButton';

interface NfcTrustConfirmModalProps {
  uid: string;
  payloadHash: string;
  actionSummary: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function NfcTrustConfirmModal({
  uid,
  payloadHash,
  actionSummary,
  onConfirm,
  onCancel,
}: NfcTrustConfirmModalProps) {
  const uidShort = uid.slice(0, 8);
  const hashShort = payloadHash.slice(0, 16);

  return (
    <div className="mobile-nfc-trust-modal-overlay" role="dialog" aria-modal="true">
      <div className="mobile-nfc-trust-modal">
        <div className="mobile-nfc-trust-modal-title">陌生 NFC 卡指令</div>
        <div className="mobile-nfc-trust-modal-summary">{actionSummary}</div>
        <div className="mobile-nfc-trust-modal-meta">
          UID: {uidShort}…
          <br />
          payload: {hashShort}…
        </div>
        <div className="mobile-nfc-trust-modal-warning">
          此卡片首次出现该指令，确认要执行吗？信任后下次相同指令将不再询问。
        </div>
        <div className="mobile-nfc-trust-modal-actions">
          <AppButton variant="secondary" size="md" onClick={() => onCancel()}>
            取消
          </AppButton>
          <AppButton variant="primary" size="md" onClick={() => onConfirm()}>
            信任并执行
          </AppButton>
        </div>
      </div>
    </div>
  );
}
