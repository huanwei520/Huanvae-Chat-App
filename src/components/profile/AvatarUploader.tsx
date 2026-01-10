/**
 * 头像上传组件
 *
 * 功能：
 * - 点击头像触发文件选择上传
 * - 显示上传进度
 * - 验证文件大小和类型
 * - 点击昵称可编辑（回车/失焦保存，Esc 取消）
 *
 * @example
 * ```tsx
 * <AvatarUploader
 *   session={session}
 *   uploading={uploadingAvatar}
 *   uploadProgress={uploadProgress}
 *   onFileSelect={handleAvatarSelect}
 *   onNicknameUpdate={handleNicknameUpdate}  // 可选，传入则启用昵称编辑
 *   nicknameUpdating={updatingNickname}
 * />
 * ```
 */

import { useRef, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CircularProgress } from '../common/CircularProgress';
import { UserAvatar } from '../common/Avatar';
import { CameraIcon, EditIcon } from './ProfileIcons';
import type { Session } from '../../types/session';

interface AvatarUploaderProps {
  session: Session;
  uploading: boolean;
  uploadProgress: number;
  onFileSelect: (file: File) => void;
  /** 昵称更新回调，传入则显示编辑功能 */
  onNicknameUpdate?: (nickname: string) => Promise<void>;
  /** 昵称更新中状态 */
  nicknameUpdating?: boolean;
}

export function AvatarUploader({
  session,
  uploading,
  uploadProgress,
  onFileSelect,
  onNicknameUpdate,
  nicknameUpdating = false,
}: AvatarUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nicknameInputRef = useRef<HTMLInputElement>(null);

  // 昵称编辑状态
  const [isEditingNickname, setIsEditingNickname] = useState(false);
  const [nicknameValue, setNicknameValue] = useState(session.profile.user_nickname);

  // 同步 session 变化
  useEffect(() => {
    setNicknameValue(session.profile.user_nickname);
  }, [session.profile.user_nickname]);

  // 进入编辑模式时自动聚焦（延迟确保动画渲染完成）
  useEffect(() => {
    if (isEditingNickname) {
      // AnimatePresence mode="wait" 需要等待退出动画完成
      // 使用 setTimeout 确保输入框已渲染
      const timer = setTimeout(() => {
        if (nicknameInputRef.current) {
          nicknameInputRef.current.focus();
          nicknameInputRef.current.select();
        }
      }, 200); // 等待动画完成
      return () => clearTimeout(timer);
    }
  }, [isEditingNickname]);

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelect(file);
    }
    // 清空 input 以支持重复选择同一文件
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // 昵称编辑相关
  const handleNicknameClick = () => {
    if (onNicknameUpdate && !nicknameUpdating) {
      setIsEditingNickname(true);
    }
  };

  const handleNicknameSubmit = async () => {
    const trimmed = nicknameValue.trim();
    if (!trimmed || trimmed === session.profile.user_nickname) {
      setIsEditingNickname(false);
      setNicknameValue(session.profile.user_nickname);
      return;
    }

    if (onNicknameUpdate) {
      try {
        await onNicknameUpdate(trimmed);
        setIsEditingNickname(false);
      } catch {
        // 失败时恢复原值
        setNicknameValue(session.profile.user_nickname);
        setIsEditingNickname(false);
      }
    }
  };

  const handleNicknameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleNicknameSubmit();
    } else if (e.key === 'Escape') {
      setIsEditingNickname(false);
      setNicknameValue(session.profile.user_nickname);
    }
  };

  const handleNicknameBlur = () => {
    handleNicknameSubmit();
  };

  return (
    <div className="profile-avatar-section">
      {uploading ? (
        <CircularProgress
          progress={uploadProgress}
          size={86}
          strokeWidth={3}
          progressColor="#3b82f6"
          backgroundColor="rgba(147, 197, 253, 0.3)"
        >
          <div className="avatar-upload-content">
            <UserAvatar session={session} />
            <div className="avatar-progress-overlay">
              {Math.round(uploadProgress)}%
            </div>
          </div>
        </CircularProgress>
      ) : (
        <motion.div
          className="avatar-container"
          style={{ cursor: 'pointer' }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={handleClick}
        >
          <UserAvatar session={session} />
          <div className="avatar-overlay">
            <CameraIcon />
          </div>
        </motion.div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />

      {/* 昵称区域 - 可编辑 */}
      <AnimatePresence mode="wait">
        {isEditingNickname ? (
          <motion.div
            key="nickname-input"
            className="profile-name-edit"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
          >
            <input
              ref={nicknameInputRef}
              type="text"
              className="nickname-input"
              value={nicknameValue}
              onChange={(e) => setNicknameValue(e.target.value)}
              onKeyDown={handleNicknameKeyDown}
              onBlur={handleNicknameBlur}
              maxLength={50}
              disabled={nicknameUpdating}
              placeholder="输入昵称"
            />
            {nicknameUpdating && (
              <span className="nickname-saving">保存中...</span>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="nickname-display"
            className={`profile-name ${onNicknameUpdate ? 'editable' : ''}`}
            onClick={handleNicknameClick}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            whileHover={onNicknameUpdate ? { scale: 1.02 } : undefined}
            title={onNicknameUpdate ? '点击编辑昵称' : undefined}
          >
            {session.profile.user_nickname}
            {onNicknameUpdate && (
              <span className="nickname-edit-icon">
                <EditIcon />
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="profile-id">@{session.userId}</div>
    </div>
  );
}
