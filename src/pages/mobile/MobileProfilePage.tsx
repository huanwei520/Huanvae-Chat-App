/**
 * 移动端个人资料页面（QQ 风格）
 *
 * 功能：显示当前用户信息、改昵称/邮箱/签名/密码、上传头像。
 * 头像/昵称等编辑逻辑收口到 [useProfileEditor]（与桌面 ProfileModal 共用）。
 *
 * 版式：通栏封面区（返回浮于其上）+ 上叠圆角卡，头像骑在封面下沿；
 * 下接 tab + 表单（profile-hero.css 骨架）。
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AvatarUploader, ProfileInfoForm, PrivacySettingsForm, PasswordForm, ProfileCoverActions } from '../../components/profile';
import { useProfileEditor } from '../../hooks/useProfileEditor';
import { resolveServerAvatarUrl } from '../../utils/avatar';

// 返回图标
const BackIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="22"
    height="22"
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

type TabType = 'info' | 'privacy' | 'password';

// ============================================
// 主组件
// ============================================

export function MobileProfilePage({ onClose }: MobileProfilePageProps) {
  const [activeTab, setActiveTab] = useState<TabType>('info');
  const {
    session,
    error,
    success,
    uploadingAvatar,
    uploadProgress,
    updatingNickname,
    savingBackground,
    handleAvatarSelect,
    handleNicknameUpdate,
    handleBackgroundSelect,
    handleBackgroundReset,
    handleSuccess,
    handleError,
    cropModal,
  } = useProfileEditor();

  // 封面图走显示收口点（私有 CA）：background_url 是后端原始相对路径。
  const backgroundUrl = resolveServerAvatarUrl(session?.profile.background_url);

  if (!session) {
    return null;
  }

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
      {/* 内容区域（整块滚动，封面区在最顶通栏） */}
      <div className="mobile-profile-content">
        {/* QQ 通栏封面区 + 浮层（返回 / 换封面） */}
        <div className="qq-hero qq-hero--mobile">
          <div
            className="qq-hero-cover"
            style={backgroundUrl ? { backgroundImage: `url("${backgroundUrl}")` } : undefined}
          >
            <div className="qq-hero-back">
              <button
                type="button"
                className="qq-hero-btn qq-hero-btn--icon"
                onClick={onClose}
                aria-label="返回"
              >
                <BackIcon />
              </button>
            </div>
            <div className="qq-hero-actions">
              <ProfileCoverActions
                hasBackground={!!session?.profile.background_url}
                saving={savingBackground}
                onSelect={handleBackgroundSelect}
                onReset={handleBackgroundReset}
              />
            </div>
          </div>
        </div>

        {/* 内层（左右留白），承载头像 / tab / 表单 */}
        <div className="mobile-profile-body">
          {/* 头像区域（含昵称编辑）—— 骑在封面下沿 */}
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
              className={`mobile-profile-tab ${activeTab === 'privacy' ? 'active' : ''}`}
              onClick={() => setActiveTab('privacy')}
            >
              隐私设置
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
            {activeTab === 'info' && (
              <ProfileInfoForm onSuccess={handleSuccess} onError={handleError} />
            )}
            {activeTab === 'privacy' && (
              <PrivacySettingsForm onSuccess={handleSuccess} onError={handleError} />
            )}
            {activeTab === 'password' && (
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
      </div>
      {cropModal}
    </motion.div>
  );
}
