/**
 * NFC 信任确认 modal
 *
 * 渲染时机：扫到陌生 (uid, payload_hash) 的卡片 + 指令在白名单内 → 弹此 modal
 * 用户点"信任并执行" → addTrusted + dispatch；"取消" → 回 idle
 *
 * 设计决策：
 * - 进出场动画：overlay 淡入淡出 + panel 上滑 sheet（framer-motion variants，
 *   调用方 MobileMain 用 AnimatePresence 包条件渲染以触发 exit；
 *   selector 已登记 tests/animation-conflict.test.ts 注册表）
 * - 文本不可被卡片内容篡改：UID 只显示前 8 字符，payload_hash 显示前 16 字符
 *   summary 由 summarizeAction 生成（host 而非完整 URL）
 */

import { motion } from 'framer-motion';
import { AppButton } from '../components/common/AppButton';

const overlayVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

const panelVariants = {
  initial: { opacity: 0, y: 32 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring' as const, damping: 26, stiffness: 300 },
  },
  exit: { opacity: 0, y: 24, transition: { duration: 0.15 } },
};

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
    <motion.div
      className="mobile-nfc-trust-modal-overlay"
      role="dialog"
      aria-modal="true"
      variants={overlayVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <motion.div className="mobile-nfc-trust-modal" variants={panelVariants}>
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
      </motion.div>
    </motion.div>
  );
}
