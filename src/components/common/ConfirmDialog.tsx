/**
 * 通用确认 / 输入对话框组件（替代 window.confirm() 与 window.prompt()）
 *
 * 提供两种使用方式：
 * 1. 直接使用 <ConfirmDialog> / <PromptDialog> 组件（需手动管理显示状态）
 * 2. 使用 useConfirmDialog() / usePromptDialog() Hook
 *    （返回 async confirm()/prompt() 方法和 dialogElement）
 *
 * 样式：`src/styles/components/confirm-dialog.css`（经 `src/styles/index.css` 的 @import 挂载，
 * 全窗口可用）。类名沿用 `delete-confirm-*` / `toolbar-btn` —— 它们是本组件的**唯一**消费者，
 * 且 `toolbar-btn` 那几条在 CSS 里被 `.delete-confirm-actions` 限定作用域，不进全局命名空间。
 *
 * 归属沿革：本组件原在 `src/lowcode/components/ConfirmDialog.tsx`，样式寄生在
 * `src/lowcode/LowcodePage.css`。低代码模块整体删除时（2026-08-20）随之搬到此处，
 * 样式一并抽出 —— 否则三个非低代码调用点（FilesModal / MobileFilesPage /
 * HuanvaeGuardPage）会在删除后失去全部样式。
 *
 * @module components/common/ConfirmDialog
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
 * 通用确认对话框 — 样式见 src/styles/components/confirm-dialog.css
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

// ============================================================================
// PromptDialog 组件（带文本输入的确认对话框，替代 window.prompt）
// ============================================================================

export interface PromptDialogProps {
  /** 标题（默认 "请输入"） */
  title?: string;
  /** 提示消息（可选） */
  message?: ReactNode;
  /** 输入框 placeholder */
  placeholder?: string;
  /** 输入框默认值 */
  defaultValue?: string;
  /** 确认按钮文字（默认 "确认"） */
  confirmLabel?: string;
  /** 取消按钮文字（默认 "取消"） */
  cancelLabel?: string;
  /** 是否要求非空（默认 true） */
  required?: boolean;
  /** 确认回调 */
  onConfirm: (value: string) => void;
  /** 取消回调 */
  onCancel: () => void;
}

function PromptDialogComponent({
  title = '请输入',
  message,
  placeholder,
  defaultValue = '',
  confirmLabel = '确认',
  cancelLabel = '取消',
  required = true,
  onConfirm,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const submit = () => {
    if (required && !value.trim()) { return; }
    onConfirm(value);
  };
  const isEmpty = required && !value.trim();
  return (
    <div className="delete-confirm-overlay" onClick={onCancel}>
      <div
        className="delete-confirm-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="delete-confirm-title">{title}</div>
        {message && <div className="delete-confirm-message">{message}</div>}
        <input
          type="text"
          autoFocus
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onCancel();
            }
          }}
          style={{
            width: '100%',
            padding: '8px 10px',
            margin: '12px 0',
            border: '1px solid var(--border-color, #444)',
            borderRadius: 4,
            background: 'var(--input-bg, #2a2a2a)',
            color: 'var(--text-primary, #e0e0e0)',
            fontSize: 14,
            boxSizing: 'border-box',
          }}
        />
        <div className="delete-confirm-actions">
          <button className="toolbar-btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            className="toolbar-btn primary"
            onClick={submit}
            disabled={isEmpty}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export const PromptDialog = memo(PromptDialogComponent);

export interface PromptOptions {
  title?: string;
  message?: ReactNode;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  required?: boolean;
}

/**
 * 通用输入对话框 Hook
 *
 * @returns { prompt, dialogElement }
 * - prompt: 异步方法，弹出输入对话框；用户确认返回输入值，取消返回 null
 * - dialogElement: 需要放到 JSX 中渲染的对话框元素（null 时不显示）
 *
 * @example
 * ```tsx
 * const { prompt, dialogElement } = usePromptDialog();
 *
 * const handleCreate = async () => {
 *   const name = await prompt({ title: '创建群组', placeholder: '群组名称' });
 *   if (name === null) return; // 用户取消
 *   doCreate(name);
 * };
 *
 * return <>{...}{dialogElement}</>;
 * ```
 */
export function usePromptDialog() {
  const [state, setState] = useState<PromptOptions | null>(null);
  const resolveRef = useRef<((value: string | null) => void) | null>(null);

  const prompt = useCallback(
    (options: PromptOptions = {}): Promise<string | null> => {
      return new Promise<string | null>((resolve) => {
        resolveRef.current = resolve;
        setState(options);
      });
    },
    [],
  );

  const handleConfirm = useCallback((value: string) => {
    resolveRef.current?.(value);
    resolveRef.current = null;
    setState(null);
  }, []);

  const handleCancel = useCallback(() => {
    resolveRef.current?.(null);
    resolveRef.current = null;
    setState(null);
  }, []);

  const dialogElement = state ? (
    <PromptDialog
      title={state.title}
      message={state.message}
      placeholder={state.placeholder}
      defaultValue={state.defaultValue}
      confirmLabel={state.confirmLabel}
      cancelLabel={state.cancelLabel}
      required={state.required}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  ) : null;

  return { prompt, dialogElement };
}

export default ConfirmDialog;
