/**
 * 个人资料弹窗组件
 *
 * 功能：
 * - 显示当前用户信息
 * - 修改邮箱/签名
 * - 修改密码
 * - 上传头像（同时更新本地账号缓存，确保退出后账户选择页面显示最新头像）
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSession, useApi } from '../contexts/SessionContext';
import { useAccounts } from '../hooks/useAccounts';
import { uploadAvatar, getProfile } from '../api/profile';
import { AvatarUploader, ProfileInfoForm, PasswordForm, CloseIcon } from './profile';

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
  const { updateAvatar } = useAccounts();

  const [activeTab, setActiveTab] = useState<TabType>('info');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // 头像上传状态
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  if (!session) { return null; }

  const handleAvatarSelect = async (file: File) => {
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
    setUploadProgress(0);
    setError(null);

    try {
      await uploadAvatar(
        session.serverUrl,
        session.accessToken,
        file,
        (progress) => setUploadProgress(progress),
      );

      // 从服务器重新获取最新资料
      const profileResult = await getProfile(api);
      const newAvatarUrl = profileResult.data.user_avatar_url;

      // 更新 session 中的头像 URL
      setSession({
        ...session,
        profile: {
          ...session.profile,
          user_avatar_url: newAvatarUrl,
        },
      });

      // 更新本地账号缓存（确保退出后账户选择页面显示最新头像）
      if (newAvatarUrl) {
        try {
          await updateAvatar(session.serverUrl, session.userId, newAvatarUrl);
        } catch {
          // 本地缓存更新失败不影响使用
        }
      }

      setSuccess('头像已更新');
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传头像失败');
    } finally {
      setUploadingAvatar(false);
      setUploadProgress(0);
    }
  };

  const handleSuccess = (message: string) => {
    setError(null);
    setSuccess(message);
  };

  const handleError = (message: string) => {
    setSuccess(null);
    setError(message);
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
      transition: { type: 'spring' as const, damping: 25, stiffness: 300 },
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
            <AvatarUploader
              session={session}
              uploading={uploadingAvatar}
              uploadProgress={uploadProgress}
              onFileSelect={handleAvatarSelect}
            />

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
                <ProfileInfoForm
                  onSuccess={handleSuccess}
                  onError={handleError}
                />
              ) : (
                <PasswordForm
                  onSuccess={handleSuccess}
                  onError={handleError}
                />
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
