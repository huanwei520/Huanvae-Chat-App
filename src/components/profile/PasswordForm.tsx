/**
 * 密码修改表单组件
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { MotionAppButton } from '../common/AppButton';
import { useApi } from '../../contexts/SessionContext';
import { changePassword } from '../../api/profile';

interface PasswordFormProps {
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  /** 隐藏内部提交按钮（移动端把保存动作提到页面顶部 header）。默认 false（桌面照旧展示按钮） */
  hideSubmit?: boolean;
  /** 上报提交态给外部（移动端顶部 header 保存键用）：canSave=三项已填且可存，saving=提交中，submit=触发保存 */
  onSubmitStateChange?: (s: { canSave: boolean; saving: boolean; submit: () => void }) => void;
}

export function PasswordForm({ onSuccess, onError, hideSubmit = false, onSubmitStateChange }: PasswordFormProps) {
  const api = useApi();

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (newPassword !== confirmPassword) {
      onError('两次输入的密码不一致');
      return;
    }

    if (newPassword.length < 6) {
      onError('新密码至少 6 个字符');
      return;
    }

    setLoading(true);

    try {
      await changePassword(api, {
        old_password: oldPassword,
        new_password: newPassword,
      });
      onSuccess('密码已修改');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      onError(err instanceof Error ? err.message : '修改密码失败');
    } finally {
      setLoading(false);
    }
  };

  // 稳定 submit 包装 + 提交态上报（供移动端 header 保存键；桌面内部按钮 disabled 不受影响）
  const canSave = !loading && !!oldPassword && !!newPassword && !!confirmPassword;
  const submitRef = useRef(handleSubmit);
  submitRef.current = handleSubmit;
  const stableSubmit = useCallback(() => { void submitRef.current(); }, []);
  useEffect(() => {
    onSubmitStateChange?.({ canSave, saving: loading, submit: stableSubmit });
  }, [onSubmitStateChange, canSave, loading, stableSubmit]);

  return (
    <>
      <div className="form-group">
        <label>旧密码</label>
        <input
          type="password"
          className="glass-input"
          value={oldPassword}
          onChange={(e) => setOldPassword(e.target.value)}
          placeholder="请输入旧密码"
        />
      </div>
      <div className="form-group">
        <label>新密码</label>
        <input
          type="password"
          className="glass-input"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="请输入新密码（至少 6 位）"
        />
      </div>
      <div className="form-group">
        <label>确认新密码</label>
        <input
          type="password"
          className="glass-input"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="请再次输入新密码"
        />
      </div>
      {!hideSubmit && (
        <MotionAppButton
          variant="primary"
          size="lg"
          block
          onClick={handleSubmit}
          disabled={loading || !oldPassword || !newPassword || !confirmPassword}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          {loading ? '修改中...' : '修改密码'}
        </MotionAppButton>
      )}
    </>
  );
}
