/**
 * 个人信息表单组件
 *
 * 功能：
 * - 修改邮箱
 * - 修改个性签名
 */

import { useState } from 'react';
import { MotionAppButton } from '../common/AppButton';
import { useSession, useApi } from '../../contexts/SessionContext';
import { updateProfile } from '../../api/profile';

interface ProfileInfoFormProps {
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

// 校验合法 email 格式（与后端 zod email() 行为对齐）
// 用于过滤 DB 中可能存在的脏数据（如曾把"未填写邮箱"等中文当邮箱保存）
// 这种值若直接放进 input 会被当作真实 value 提交，触发后端"Invalid email format"
function isValidEmail(s: string | null | undefined): s is string {
  if (!s) { return false; }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export function ProfileInfoForm({ onSuccess, onError }: ProfileInfoFormProps) {
  const { session, setSession } = useSession();
  const api = useApi();

  // 只有当 user_email 是合法邮箱时才作为 input 初值；否则 input 为空，由 placeholder "未填写邮箱" 提示
  const storedEmail = session?.profile.user_email;
  const [email, setEmail] = useState(isValidEmail(storedEmail) ? storedEmail : '');
  const [signature, setSignature] = useState(session?.profile.user_signature || '');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!session) { return; }

    setLoading(true);

    try {
      // 空字段视为"未填"，不发送对应字段（让后端 optional 跳过校验）
      // 否则后端会把空串当作非法 email 格式而拒绝整个请求
      await updateProfile(api, {
        email: email.trim() || undefined,
        signature: signature || undefined,
      });
      onSuccess('个人信息已更新');

      setSession({
        ...session,
        profile: {
          ...session.profile,
          user_email: email || null,
          user_signature: signature || null,
        },
      });
    } catch (err) {
      onError(err instanceof Error ? err.message : '更新失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="form-group">
        <label>邮箱</label>
        <input
          type="email"
          className="glass-input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="未填写邮箱"
        />
      </div>
      <div className="form-group">
        <label>个性签名</label>
        <textarea
          className="glass-input"
          value={signature}
          onChange={(e) => setSignature(e.target.value)}
          placeholder="介绍一下自己吧..."
          maxLength={200}
          rows={3}
        />
        <span className="char-count">{signature.length}/200</span>
      </div>
      <MotionAppButton
        variant="primary"
        size="lg"
        block
        onClick={handleSubmit}
        disabled={loading}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        {loading ? '保存中...' : '保存修改'}
      </MotionAppButton>
    </>
  );
}
