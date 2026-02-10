/**
 * 通用确认对话框组件
 *
 * 从 WorkflowListDialog 中的 DeleteConfirmDialog 提取而来，
 * 复用 delete-confirm-* 系列 CSS 样式，用于替代所有 window.confirm() 调用。
 *
 * 提供两种使用方式：
 * 1. 直接使用 <ConfirmDialog> 组件（需手动管理显示状态）
 * 2. 使用 useConfirmDialog() Hook（返回 async confirm() 方法和 dialogElement）
 *
 * @module lowcode/components/ConfirmDialog
 * @created 2026-02-07
 */

import { memo, useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';

// ============================================================================
// ConfirmDialog 组件
// ============================================================================

export interface ConfirmDialogProps {
  /** 标题（默认 "确认"） */
  title?: string;
  /** 提示消息内容，支持 ReactNode */
  message: ReactNode;
  /** 确认按钮文字（默认 "确认"） */
  confirmLabel?: string;
  /** 取消按钮文字（默认 "取消"） */
  cancelLabel?: string;
  /** 处理中的按钮文字（默认 "处理中..."） */
  processingLabel?: string;
  /** 是否使用危险样式（红色按钮） */
  isDanger?: boolean;
  /** 是否正在处理中（按钮禁用，显示 processingLabel） */
  isProcessing?: boolean;
  /** 确认回调 */
  onConfirm: () => void;
  /** 取消回调 */
  onCancel: () => void;
}

/**
 * 通用确认对话框 — 复用 delete-confirm-* CSS 类
 */
function ConfirmDialogComponent({
  title = '确认',
  message,
  confirmLabel = '确认',
  cancelLabel = '取消',
  processingLabel = '处理中...',
  isDanger = false,
  isProcessing = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <div className="delete-confirm-overlay" onClick={onCancel}>
      <div
        className="delete-confirm-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="delete-confirm-title">{title}</div>
        <div className="delete-confirm-message">{message}</div>
        <div className="delete-confirm-actions">
          <button
            className="toolbar-btn"
            onClick={onCancel}
            disabled={isProcessing}
          >
            {cancelLabel}
          </button>
          <button
            className={`toolbar-btn ${isDanger ? 'danger' : 'primary'}`}
            onClick={onConfirm}
            disabled={isProcessing}
          >
            {isProcessing ? processingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export const ConfirmDialog = memo(ConfirmDialogComponent);

// ============================================================================
// useConfirmDialog Hook
// ============================================================================

/** confirm() 的可选参数 */
export interface ConfirmOptions {
  /** 标题（默认 "确认"） */
  title?: string;
  /** 提示消息内容 */
  message: ReactNode;
  /** 确认按钮文字（默认 "确认"） */
  confirmLabel?: string;
  /** 取消按钮文字（默认 "取消"） */
  cancelLabel?: string;
  /** 是否使用危险样式（红色按钮） */
  isDanger?: boolean;
}

/**
 * 通用确认对话框 Hook
 *
 * @returns { confirm, dialogElement }
 * - confirm: 异步方法，调用后弹出对话框，用户点击确认返回 true，取消返回 false
 * - dialogElement: 需要放到 JSX 中渲染的对话框元素（null 时不显示）
 *
 * @example
 * ```tsx
 * const { confirm, dialogElement } = useConfirmDialog();
 *
 * const handleDelete = async () => {
 *   const ok = await confirm({ title: '确认删除', message: '此操作不可撤销', isDanger: true });
 *   if (ok) doDelete();
 * };
 *
 * return <>{...}{dialogElement}</>;
 * ```
 */
export function useConfirmDialog() {
  const [state, setState] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((confirmed: boolean) => void) | null>(null);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setState(options);
    });
  }, []);

  const handleConfirm = useCallback(() => {
    resolveRef.current?.(true);
    resolveRef.current = null;
    setState(null);
  }, []);

  const handleCancel = useCallback(() => {
    resolveRef.current?.(false);
    resolveRef.current = null;
    setState(null);
  }, []);

  const dialogElement = state ? (
    <ConfirmDialog
      title={state.title}
      message={state.message}
      confirmLabel={state.confirmLabel}
      cancelLabel={state.cancelLabel}
      isDanger={state.isDanger}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  ) : null;

  return { confirm, dialogElement };
}

export default ConfirmDialog;
