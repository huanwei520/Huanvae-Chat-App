/**
 * 个人资料弹窗组件
 *
 * 功能：
 * - 显示当前用户信息
 * - 修改邮箱/签名
 * - 修改密码
 * - 上传头像
 */

import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSession, useApi } from '../contexts/SessionContext';
import { updateProfile, changePassword, uploadAvatar } from '../api/profile';

// ============================================
// 图标组件
// ============================================

const CloseIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={20} height={20}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const CameraIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={20} height={20}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
  </svg>
);

const DefaultAvatar = ({ size = 80 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={size} height={size}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
  </svg>
);

// ============================================
// 类型定义
// ============================================

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabType = 'info' | 'password';

// ============================================
// 主组件
// ============================================

export function ProfileModal({ isOpen, onClose }: ProfileModalProps) {
  const { session, setSession } = useSession();
  const api = useApi();

  const [activeTab, setActiveTab] = useState<TabType>('info');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // 个人信息表单
  const [email, setEmail] = useState(session?.profile.user_email || '');
  const [signature, setSignature] = useState(session?.profile.user_signature || '');

  // 密码表单
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // 头像上传
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  if (!session) { return null; }

  const handleUpdateProfile = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      await updateProfile(api, { email, signature });
      setSuccess('个人信息已更新');

      // 更新 session 中的 profile
      if (session) {
        setSession({
          ...session,
          profile: {
            ...session.profile,
            user_email: email || null,
            user_signature: signature || null,
          },
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新失败');
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    if (newPassword.length < 6) {
      setError('新密码至少 6 个字符');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      await changePassword(api, {
        old_password: oldPassword,
        new_password: newPassword,
      });
      setSuccess('密码已修改');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '修改密码失败');
    } finally {
      setLoading(false);
    }
  };

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) { return; }

    // 验证文件大小
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      setError('文件太大，最大 10MB');
      return;
    }

    // 验证文件类型
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      setError('不支持的文件格式，仅支持 jpg、png、gif、webp');
      return;
    }

    setUploadingAvatar(true);
    setError(null);

    try {
      const result = await uploadAvatar(session.serverUrl, session.accessToken, file);

      // 更新 session 中的头像 URL
      setSession({
        ...session,
        profile: {
          ...session.profile,
          user_avatar_url: result.avatar_url,
        },
      });

      setSuccess('头像已更新');
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传头像失败');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const modalVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
  };

  const contentVariants = {
    hidden: { opacity: 0, scale: 0.95, y: 20 },
    visible: {
      opacity: 1,
      scale: 1,
      y: 0,
      transition: { type: 'spring', damping: 25, stiffness: 300 },
    },
    exit: { opacity: 0, scale: 0.95, y: 20 },
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="modal-overlay"
          variants={modalVariants}
          initial="hidden"
          animate="visible"
          exit="hidden"
          onClick={onClose}
        >
          <motion.div
            className="modal-content profile-modal"
            variants={contentVariants}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 头部 */}
            <div className="modal-header">
              <h2>个人资料</h2>
              <motion.button
                className="close-btn"
                onClick={onClose}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <CloseIcon />
              </motion.button>
            </div>

            {/* 头像区域 */}
            <div className="profile-avatar-section">
              <motion.div
                className="avatar-container"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleAvatarClick}
              >
                {session.profile.user_avatar_url ? (
                  <img src={session.profile.user_avatar_url} alt={session.profile.user_nickname} />
                ) : (
                  <DefaultAvatar size={80} />
                )}
                <div className="avatar-overlay">
                  {uploadingAvatar ? '上传中...' : <CameraIcon />}
                </div>
              </motion.div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                onChange={handleAvatarChange}
                style={{ display: 'none' }}
              />
              <div className="profile-name">{session.profile.user_nickname}</div>
              <div className="profile-id">@{session.userId}</div>
            </div>

            {/* 标签切换 */}
            <div className="profile-tabs">
              <button
                className={`tab-btn ${activeTab === 'info' ? 'active' : ''}`}
                onClick={() => setActiveTab('info')}
              >
                基本信息
              </button>
              <button
                className={`tab-btn ${activeTab === 'password' ? 'active' : ''}`}
                onClick={() => setActiveTab('password')}
              >
                修改密码
              </button>
            </div>

            {/* 表单内容 */}
            <div className="profile-form">
              {activeTab === 'info' ? (
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
                    onClick={handleUpdateProfile}
                    disabled={loading}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    {loading ? '保存中...' : '保存修改'}
                  </motion.button>
                </>
              ) : (
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
                    onClick={handleChangePassword}
                    disabled={loading || !oldPassword || !newPassword || !confirmPassword}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    {loading ? '修改中...' : '修改密码'}
                  </motion.button>
                </>
              )}

              {/* 错误/成功提示 */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    className="form-error"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                  >
                    {error}
                  </motion.div>
                )}
                {success && (
                  <motion.div
                    className="form-success"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                  >
                    {success}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
