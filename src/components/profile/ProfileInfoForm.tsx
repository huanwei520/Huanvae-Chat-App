/**
 * 个人信息表单组件
 *
 * 功能：
 * - 修改邮箱
 * - 修改个性签名
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useSession, useApi } from '../../contexts/SessionContext';
import { updateProfile } from '../../api/profile';

interface ProfileInfoFormProps {
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

export function ProfileInfoForm({ onSuccess, onError }: ProfileInfoFormProps) {
  const { session, setSession } = useSession();
  const api = useApi();

  const [email, setEmail] = useState(session?.profile.user_email || '');
  const [signature, setSignature] = useState(session?.profile.user_signature || '');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!session) { return; }

    setLoading(true);

    try {
      await updateProfile(api, { email, signature });
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
          placeholder="your@email.com"
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
      <motion.button
        className="glass-button"
        onClick={handleSubmit}
        disabled={loading}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        {loading ? '保存中...' : '保存修改'}
      </motion.button>
    </>
  );
}
