/**
 * 个人资料编辑共享逻辑（桌面 ProfileModal + 移动 MobileProfilePage 共用）
 *
 * @location src/hooks/useProfileEditor.ts
 *
 * 两个编辑载体的非 JSX 逻辑完全一致：头像上传（裁剪 + 上传 + 同步 session/本地账号缓存）、
 * 封面选择/移除（原型 blob 预览 + 异步提主色，见 [profileCoverPrototype]）、昵称更新、
 * 错误/成功提示、以及由封面主色派生的 QQ 卡底/封面样式（见 [profileCover]）。
 * 收口到本 hook，避免两份逐字重复漂移；各载体只保留自己的 JSX 与 activeTab 等纯 UI 状态。
 */

import { useRef, useState } from 'react';
import { useSession, useApi } from '../contexts/SessionContext';
import { useAccounts } from './useAccounts';
import { uploadAvatar, getProfile, updateProfile } from '../api/profile';
import { resolveServerAvatarUrl } from '../utils/avatar';
import { useAvatarCrop } from '../components/common/AvatarCropModal';
import { useProfileCoverPrototype } from '../stores';
import { extractDominantColor } from '../utils/imageColor';
import { qqHeroStyles } from '../utils/profileCover';

// 头像/封面本地校验（一致）
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

  // 封面背景（原型：共享 store 持有本地 blob URL + 主色调；blob 生命周期由 store 管理）
  const coverUrl = useProfileCoverPrototype((s) => s.coverUrl);
  const dominant = useProfileCoverPrototype((s) => s.dominant);
  const setCover = useProfileCoverPrototype((s) => s.setCover);
  const clearCover = useProfileCoverPrototype((s) => s.clearCover);
  const coverInputRef = useRef<HTMLInputElement>(null);

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

  // 封面背景选择（原型：仅本地预览，不上传、不落库）。先显示图，主色调随后异步补上。
  const handleCoverSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许重复选同一文件
    if (!file) { return; }
    if (file.size > IMAGE_MAX_SIZE) {
      setError('封面图太大，最大 10MB');
      return;
    }
    if (!IMAGE_ALLOWED_TYPES.includes(file.type)) {
      setError('封面图格式不支持，仅支持 jpg、png、gif、webp');
      return;
    }
    const url = URL.createObjectURL(file);
    setCover(url, null);
    setError(null);
    // 异步提取主色调（同一 url 再次 setCover 不会回收 blob），失败则保持无染色
    extractDominantColor(url)
      .then((rgb) => { if (rgb) { setCover(url, rgb); } })
      .catch(() => { /* 提取失败：背景保持默认色 */ });
  };

  const handleCoverRemove = () => {
    clearCover();
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

  const handleSuccess = (message: string) => {
    setError(null);
    setSuccess(message);
  };

  const handleError = (message: string) => {
    setSuccess(null);
    setError(message);
  };

  // QQ 淡染：封面主色 → 卡底淡色；无封面/未提色回落 CSS 默认背景
  const hero = qqHeroStyles(dominant);
  const cardStyle: React.CSSProperties = hero.cardBackground ? { background: hero.cardBackground } : {};
  const coverStyle: React.CSSProperties = coverUrl ? { backgroundImage: `url(${coverUrl})` } : {};

  return {
    session,
    error,
    success,
    uploadingAvatar,
    uploadProgress,
    updatingNickname,
    coverUrl,
    coverInputRef,
    cardStyle,
    coverStyle,
    handleAvatarSelect,
    handleCoverSelect,
    handleCoverRemove,
    handleNicknameUpdate,
    handleSuccess,
    handleError,
    cropModal,
  };
}
