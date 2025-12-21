/**
 * 头像上传组件
 *
 * 功能：
 * - 点击触发文件选择
 * - 显示上传进度
 * - 验证文件大小和类型
 */

import { useRef } from 'react';
import { motion } from 'framer-motion';
import { CircularProgress } from '../common/CircularProgress';
import { UserAvatar } from '../common/Avatar';
import { CameraIcon } from './ProfileIcons';
import type { Session } from '../../types/session';

interface AvatarUploaderProps {
  session: Session;
  uploading: boolean;
  uploadProgress: number;
  onFileSelect: (file: File) => void;
}

export function AvatarUploader({
  session,
  uploading,
  uploadProgress,
  onFileSelect,
}: AvatarUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      <div className="profile-name">{session.profile.user_nickname}</div>
      <div className="profile-id">@{session.userId}</div>
    </div>
  );
}
