/**
 * 密码修改表单组件
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useApi } from '../../contexts/SessionContext';
import { changePassword } from '../../api/profile';

interface PasswordFormProps {
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

export function PasswordForm({ onSuccess, onError }: PasswordFormProps) {
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
      <motion.button
        className="glass-button"
        onClick={handleSubmit}
        disabled={loading || !oldPassword || !newPassword || !confirmPassword}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        {loading ? '修改中...' : '修改密码'}
      </motion.button>
    </>
  );
}
