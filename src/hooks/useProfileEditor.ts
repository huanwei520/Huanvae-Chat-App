/**
 * 个人资料编辑共享逻辑（桌面 ProfileModal + 移动 MobileProfilePage 共用）
 *
 * @location src/hooks/useProfileEditor.ts
 *
 * 两个编辑载体的非 JSX 逻辑完全一致：头像上传（裁剪 + 上传 + 同步 session/本地账号缓存）、
 * 昵称更新、错误/成功提示。收口到本 hook，避免两份逐字重复漂移；各载体只保留自己的
 * JSX 与 activeTab 等纯 UI 状态。
 */

import { useState } from 'react';
import { useSession, useApi } from '../contexts/SessionContext';
import { useAccounts } from './useAccounts';
import {
  uploadAvatar,
  uploadBackground,
  resetBackground,
  getProfile,
  updateProfile,
} from '../api/profile';
import { resolveServerAvatarUrl } from '../utils/avatar';
import { useAvatarCrop } from '../components/common/AvatarCropModal';

// 头像本地校验
const IMAGE_MAX_SIZE = 10 * 1024 * 1024; // 10MB
const IMAGE_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

export function useProfileEditor() {
  const { session, setSession } = useSession();
  const api = useApi();
  const { updateAvatar, updateNickname } = useAccounts();
  const { requestCrop, cropModal } = useAvatarCrop();

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [updatingNickname, setUpdatingNickname] = useState(false);
  const [savingBackground, setSavingBackground] = useState(false);

  const handleAvatarSelect = async (file: File) => {
    if (!session) { return; }
    if (file.size > IMAGE_MAX_SIZE) {
      setError('文件太大，最大 10MB');
      return;
    }
    if (!IMAGE_ALLOWED_TYPES.includes(file.type)) {
      setError('不支持的文件格式，仅支持 jpg、png、gif、webp');
      return;
    }

    // 选图后先裁剪（1:1）；取消则不上传
    const cropped = await requestCrop(file);
    if (!cropped) { return; }

    setUploadingAvatar(true);
    setUploadProgress(0);
    setError(null);

    try {
      await uploadAvatar(
        session.serverUrl,
        session.accessToken,
        cropped,
        (progress) => setUploadProgress(progress),
      );

      // 从服务器重新获取最新资料
      const profileResult = await getProfile(api);
      const newAvatarUrl = resolveServerAvatarUrl(profileResult.user_avatar_url);

      // 更新 session 中的头像 URL
      setSession({
        ...session,
        profile: {
          ...session.profile,
          user_avatar_url: newAvatarUrl,
        },
      });

      // 更新本地账号缓存（确保退出后账户选择页面显示最新头像）：传后端原始路径，
      // updateAvatar 内部解析为逻辑域名 URL + directIp 下载（非显示用的回环代理 URL）。
      if (profileResult.user_avatar_url) {
        try {
          await updateAvatar(session.serverUrl, session.userId, profileResult.user_avatar_url);
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
    if (!session) { return; }
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
      throw err; // 重新抛出让 AvatarUploader 知道失败了
    } finally {
      setUpdatingNickname(false);
    }
  };

  // 背景图（封面）上传：background_url 保持后端原始相对路径，展示时由资料卡片经
  // resolveServerAvatarUrl 收口（私有 CA 红线，与 user_avatar_url 显示侧一致）。
  const handleBackgroundSelect = async (file: File) => {
    if (!session) { return; }
    if (file.size > IMAGE_MAX_SIZE) {
      setError('文件太大，最大 10MB');
      return;
    }
    if (!IMAGE_ALLOWED_TYPES.includes(file.type)) {
      setError('不支持的文件格式，仅支持 jpg、png、gif、webp');
      return;
    }
    setSavingBackground(true);
    setError(null);
    try {
      const res = await uploadBackground(session.serverUrl, session.accessToken, file);
      setSession({
        ...session,
        profile: { ...session.profile, background_url: res.background_url },
      });
      setSuccess('背景图已更新');
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传背景图失败');
    } finally {
      setSavingBackground(false);
    }
  };

  // 背景图重置为默认封面（后端置 null）
  const handleBackgroundReset = async () => {
    if (!session) { return; }
    setSavingBackground(true);
    setError(null);
    try {
      await resetBackground(api);
      setSession({
        ...session,
        profile: { ...session.profile, background_url: null },
      });
      setSuccess('背景图已重置');
    } catch (err) {
      setError(err instanceof Error ? err.message : '重置背景图失败');
    } finally {
      setSavingBackground(false);
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

  return {
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
  };
}
