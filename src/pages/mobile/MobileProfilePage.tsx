/**
 * 移动端个人资料页面
 *
 * 功能：
 * - 显示当前用户信息
 * - 修改昵称（点击昵称即可编辑）
 * - 修改邮箱/签名
 * - 修改密码
 * - 上传头像
 *
 * 样式：
 * - 使用与抽屉一致的白色毛玻璃效果
 * - 颜色通过 CSS 变量统一管理，支持主题切换
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSession, useApi } from '../../contexts/SessionContext';
import { useAccounts } from '../../hooks/useAccounts';
import { uploadAvatar, getProfile, updateProfile } from '../../api/profile';
import { AvatarUploader, ProfileInfoForm, PasswordForm } from '../../components/profile';

// 返回图标
const BackIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="24"
    height="24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M15.75 19.5L8.25 12l7.5-7.5"
    />
  </svg>
);

// ============================================
// 类型定义
// ============================================

interface MobileProfilePageProps {
  /** 关闭页面回调 */
  onClose: () => void;
}

type TabType = 'info' | 'password';

// ============================================
// 主组件
// ============================================

export function MobileProfilePage({ onClose }: MobileProfilePageProps) {
  const { session, setSession } = useSession();
  const api = useApi();
  const { updateAvatar, updateNickname } = useAccounts();

  const [activeTab, setActiveTab] = useState<TabType>('info');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // 头像上传状态
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // 昵称更新状态
  const [updatingNickname, setUpdatingNickname] = useState(false);

  if (!session) {
    return null;
  }

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

      // 更新本地账号缓存
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

  // 昵称更新处理
  const handleNicknameUpdate = async (nickname: string) => {
    setUpdatingNickname(true);
    setError(null);

    try {
      await updateProfile(api, { nickname });

      // 更新 session 中的昵称
      setSession({
        ...session,
        profile: {
          ...session.profile,
          user_nickname: nickname,
        },
      });

      // 更新本地账号缓存
      try {
        await updateNickname(session.serverUrl, session.userId, nickname);
      } catch {
        // 本地缓存更新失败不影响使用
      }

      setSuccess('昵称已更新');
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新昵称失败');
      throw err;
    } finally {
      setUpdatingNickname(false);
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

  // 页面动画
  const pageVariants = {
    initial: { x: '100%', opacity: 0 },
    animate: { x: 0, opacity: 1, transition: { type: 'spring' as const, damping: 25, stiffness: 200 } },
    exit: { x: '100%', opacity: 0, transition: { duration: 0.2 } },
  };

  return (
    <motion.div
      className="mobile-profile-page"
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      {/* 顶部栏 */}
      <header className="mobile-profile-header">
        <button className="mobile-profile-back" onClick={onClose}>
          <BackIcon />
        </button>
        <h1 className="mobile-profile-title">个人资料</h1>
        <div className="mobile-profile-placeholder" />
      </header>

      {/* 内容区域 */}
      <div className="mobile-profile-content">
        {/* 头像区域（含昵称编辑） */}
        <div className="mobile-profile-avatar-section">
          <AvatarUploader
            session={session}
            uploading={uploadingAvatar}
            uploadProgress={uploadProgress}
            onFileSelect={handleAvatarSelect}
            onNicknameUpdate={handleNicknameUpdate}
            nicknameUpdating={updatingNickname}
          />
        </div>

        {/* 标签切换 */}
        <div className="mobile-profile-tabs">
          <button
            className={`mobile-profile-tab ${activeTab === 'info' ? 'active' : ''}`}
            onClick={() => setActiveTab('info')}
          >
            基本信息
          </button>
          <button
            className={`mobile-profile-tab ${activeTab === 'password' ? 'active' : ''}`}
            onClick={() => setActiveTab('password')}
          >
            修改密码
          </button>
        </div>

        {/* 表单内容 */}
        <div className="mobile-profile-form">
          {activeTab === 'info' ? (
            <ProfileInfoForm onSuccess={handleSuccess} onError={handleError} />
          ) : (
            <PasswordForm onSuccess={handleSuccess} onError={handleError} />
          )}

          {/* 错误/成功提示 */}
          <AnimatePresence>
            {error && (
              <motion.div
                className="mobile-profile-error"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                {error}
              </motion.div>
            )}
            {success && (
              <motion.div
                className="mobile-profile-success"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                {success}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
