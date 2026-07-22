/**
 * 可复用动作按钮(卡片按钮与运维面板共用)。
 *
 * 职责:点击执行一个异步动作,本地可视状态机 + 防误触二次确认。纯 CSS,无动画库。
 *
 * 状态机:idle →(confirm 声明时)→ confirming → pending → success / failed →(2.5s)→ idle
 * - confirming 3s 未再点自动回 idle(防误触确认窗不长驻);
 * - pending 期间忽略一切点击(按钮 disabled + 处理函数内再判一次);
 * - 成功/失败态 2.5s 后自动回 idle;定时器随 unmount 清理,setState 前经 mountedRef 防卸载后写。
 *
 * className 只取封闭白名单常量(从 CardRenderer 收编),外加状态修饰类 card-button--<state>;
 * 绝不把外部字段插值进 className。
 */

import { useEffect, useRef, useState } from 'react';
import './CardRenderer.css';

export interface ActionButtonProps {
  /** 不透明动作标识,仅随 onExecute 回传 */
  actionId: string;
  label: string;
  /** 默认 'secondary';类名走封闭白名单,不插值外部字段 */
  style?: 'primary' | 'secondary' | 'danger';
  /** 破坏性动作:第一次点击进入确认态,确认窗内再点才执行 */
  confirm?: boolean;
  onExecute: (actionId: string) => Promise<void>;
  onError?: (actionId: string, message: string) => void;
}

/** 本地可视状态机的全部状态 */
export type ActionButtonState = 'idle' | 'confirming' | 'pending' | 'success' | 'failed';

/** button style → 白名单类名(不插值外部字段) */
const BUTTON_CLASS: Record<'primary' | 'secondary' | 'danger', string> = {
  primary: 'card-button card-button-primary',
  secondary: 'card-button card-button-secondary',
  danger: 'card-button card-button-danger',
};

/** 确认态自动回 idle 的窗口(ms) */
const CONFIRM_TIMEOUT_MS = 3000;
/** 成功/失败态自动回 idle 的窗口(ms) */
const RESULT_TIMEOUT_MS = 2500;

/** 各状态下的按钮文案 */
function buttonText(state: ActionButtonState, label: string): string {
  switch (state) {
    case 'confirming':
      return `确认${label}?`;
    case 'pending':
      return '执行中…';
    case 'success':
      return '✓ 已执行';
    case 'failed':
      return '✗ 失败';
    default:
      return label;
  }
}

export function ActionButton({ actionId, label, style = 'secondary', confirm = false, onExecute, onError }: ActionButtonProps) {
  const [state, setState] = useState<ActionButtonState>('idle');
  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const safeSetState = (next: ActionButtonState) => {
    if (mountedRef.current) {
      setState(next);
    }
  };

  const scheduleReset = (ms: number) => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      safeSetState('idle');
    }, ms);
  };

  const execute = async () => {
    setState('pending');
    try {
      await onExecute(actionId);
      safeSetState('success');
      scheduleReset(RESULT_TIMEOUT_MS);
    } catch (e) {
      safeSetState('failed');
      onError?.(actionId, e instanceof Error ? e.message : String(e));
      scheduleReset(RESULT_TIMEOUT_MS);
    }
  };

  const handleClick = () => {
    // pending 期间忽略一切点击(disabled 之外的第二道闸)
    if (state === 'pending') {
      return;
    }
    if (confirm && state === 'idle') {
      setState('confirming');
      scheduleReset(CONFIRM_TIMEOUT_MS);
      return;
    }
    void execute();
  };

  return (
    <button
      type="button"
      className={`${BUTTON_CLASS[style]} card-button--${state}`}
      data-action-id={actionId}
      data-state={state}
      disabled={state === 'pending'}
      onClick={handleClick}
    >
      {buttonText(state, label)}
    </button>
  );
}
