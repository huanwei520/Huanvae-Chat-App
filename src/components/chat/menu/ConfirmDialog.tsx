/**
 * 确认对话框组件
 */

import { MenuHeader } from './MenuHeader';

interface ConfirmDialogProps {
  title: string;
  message: React.ReactNode;
  warning?: string;
  confirmText: string;
  loadingText: string;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  warning,
  confirmText,
  loadingText,
  loading,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <>
      <MenuHeader title={title} />
      <div className="menu-confirm">
        <p>{message}</p>
        {warning && <p className="confirm-warning">{warning}</p>}
        <div className="confirm-actions">
          <button className="cancel-btn" onClick={onCancel}>取消</button>
          <button
            className="danger-btn"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? loadingText : confirmText}
          </button>
        </div>
      </div>
    </>
  );
}

