/**
 * 个人资料弹窗组件（桌面，QQ 风格）
 *
 * 功能：显示当前用户信息、改昵称/邮箱/签名/密码、上传头像、自定义封面背景。
 * 头像/封面/昵称等编辑逻辑收口到 [useProfileEditor]（与移动端 MobileProfilePage 共用）。
 *
 * 版式：通栏封面 + 上叠主色淡染卡（QQ 风），头像骑在封面下沿；下接 tab + 表单。
 * 封面/淡染色由 [profileCover.ts] 从封面主色派生，三个资料载体共用骨架（profile-hero.css）。
 */

import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AvatarUploader, ProfileInfoForm, PrivacySettingsForm, PasswordForm, CoverColorButton } from './profile';
import { useProfileEditor } from '../hooks/useProfileEditor';

// ============================================
// 类型定义
// ============================================

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabType = 'info' | 'privacy' | 'password';

// ============================================
// 主组件
// ============================================

export function ProfileModal({ isOpen, onClose }: ProfileModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('info');
  const coverInputRef = useRef<HTMLInputElement>(null);
  const {
    session,
    error,
    success,
    uploadingAvatar,
    uploadProgress,
    updatingNickname,
    hasBackground,
    backgroundColor,
    cardStyle,
    coverStyle,
    handleAvatarSelect,
    handleImageBackgroundSelect,
    handleColorBackground,
    handleBackgroundRemove,
    handleNicknameUpdate,
    handleSuccess,
    handleError,
    cropModal,
  } = useProfileEditor();

  if (!session) { return null; }

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

  // 点击非编辑区域时，触发当前输入框失焦（退出编辑状态）
  const handleContentMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    // 如果点击的不是输入框，让当前聚焦的输入框失焦
    // 排除昵称显示区域（点击它会进入编辑模式）
    const isNicknameArea = target.closest('.profile-name');
    if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && !isNicknameArea) {
      const activeElement = document.activeElement as HTMLElement;
      if (activeElement?.classList.contains('nickname-input')) {
        activeElement.blur();
      }
    }
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
            style={cardStyle}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={handleContentMouseDown}
          >
            {/* 背景图文件选择（隐藏 input） */}
            <input
              ref={coverInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              style={{ display: 'none' }}
              onChange={handleImageBackgroundSelect}
            />

            {/* QQ 通栏封面 + 浮层操作按钮（背景图 / 纯色 / 移除 / 关闭） */}
            <div className="qq-hero qq-hero--modal">
              <div className="qq-hero-cover" style={coverStyle}>
                <div className="qq-hero-actions">
                  <button
                    type="button"
                    className="qq-hero-btn"
                    onClick={() => coverInputRef.current?.click()}
                  >
                    {hasBackground ? '换封面' : '添加封面'}
                  </button>
                  <CoverColorButton value={backgroundColor} onPick={handleColorBackground} />
                  {hasBackground && (
                    <button type="button" className="qq-hero-btn" onClick={handleBackgroundRemove}>
                      移除
                    </button>
                  )}
                  <button
                    type="button"
                    className="qq-hero-btn qq-hero-btn--icon"
                    onClick={onClose}
                    aria-label="关闭"
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>

            {/* 头像区域（含昵称编辑）—— 骑在封面下沿 */}
            <AvatarUploader
              session={session}
              uploading={uploadingAvatar}
              uploadProgress={uploadProgress}
              onFileSelect={handleAvatarSelect}
              onNicknameUpdate={handleNicknameUpdate}
              nicknameUpdating={updatingNickname}
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
                className={`tab-btn ${activeTab === 'privacy' ? 'active' : ''}`}
                onClick={() => setActiveTab('privacy')}
              >
                隐私设置
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
              {activeTab === 'info' && (
                <ProfileInfoForm
                  onSuccess={handleSuccess}
                  onError={handleError}
                />
              )}
              {activeTab === 'privacy' && (
                <PrivacySettingsForm
                  onSuccess={handleSuccess}
                  onError={handleError}
                />
              )}
              {activeTab === 'password' && (
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
      {cropModal}
    </AnimatePresence>
  );
}
