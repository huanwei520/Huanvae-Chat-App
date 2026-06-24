/**
 * 个人资料编辑共享逻辑（桌面 ProfileModal + 移动 MobileProfilePage 共用）
 *
 * @location src/hooks/useProfileEditor.ts
 *
 * 两个编辑载体的非 JSX 逻辑完全一致：头像上传（裁剪 + 上传 + 同步 session/本地账号缓存）、
 * 个人资料背景（图片压缩后上传后端 / 纯色 / 清除，落后端 user-backgrounds 公开读桶，别人可见，
 * 见 [profileBackground] store + api/profile + [imageBackground]）、昵称更新、错误/成功提示、
 * 以及由背景主色派生的 QQ 卡底/封面样式（见 [profileCover]）。收口到本 hook 避免两份逐字重复；
 * 各载体只保留自己的 JSX 与 activeTab。
 */

import { useState } from 'react';
import { useSession, useApi } from '../contexts/SessionContext';
import { useAccounts } from './useAccounts';
import {
  uploadAvatar,
  getProfile,
  updateProfile,
  uploadBackground,
  setBackgroundColor,
  clearProfileBackground,
} from '../api/profile';
import { resolveServerAvatarUrl } from '../utils/avatar';
import { resolveDisplayUrl } from '../services/secureProxy';
import { useAvatarCrop } from '../components/common/AvatarCropModal';
import { useProfileBackground } from '../stores';
import { extractDominantColor, rgbToHex } from '../utils/imageColor';
import { compressImageToFile } from '../utils/imageBackground';
import { qqHeroStyles, backgroundCoverStyle } from '../utils/profileCover';

// 头像/背景图本地校验（一致）
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

  // 个人资料背景（store 由后端数据驱动：图片相对路径 / 纯色 + 主色；改背景在 store 内联动主题色）
  const bgKind = useProfileBackground((s) => s.kind);
  const bgBackgroundUrl = useProfileBackground((s) => s.backgroundUrl);
  const bgColor = useProfileBackground((s) => s.color);
  const bgDominant = useProfileBackground((s) => s.dominant);
  const setFromBackend = useProfileBackground((s) => s.setFromBackend);
  const [updatingBackground, setUpdatingBackground] = useState(false);

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

  // 背景图选择：本地 blob → 压缩成 File + 提主色 → 上传后端（公开读桶）→ 用响应刷新 store
  const handleImageBackgroundSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许重复选同一文件
    if (!file || !session) { return; }
    // 进入背景操作即清掉上一次的成功/错误提示，避免校验失败时残留旧的成功态
    setError(null);
    setSuccess(null);
    if (file.size > IMAGE_MAX_SIZE) {
      setError('背景图太大，最大 10MB');
      return;
    }
    if (!IMAGE_ALLOWED_TYPES.includes(file.type)) {
      setError('背景图格式不支持，仅支持 jpg、png、gif、webp');
      return;
    }
    const blobUrl = URL.createObjectURL(file);
    setUpdatingBackground(true);
    try {
      const [compressed, dominant] = await Promise.all([
        compressImageToFile(blobUrl),
        extractDominantColor(blobUrl).catch(() => null),
      ]);
      const dominantHex = dominant ? rgbToHex(dominant) : '';
      const res = await uploadBackground(session.serverUrl, session.accessToken, compressed, dominantHex);
      setFromBackend(res.user_background_url, res.user_background_color);
      setSuccess('背景已更新');
    } catch (err) {
      setError(err instanceof Error ? err.message : '背景图上传失败');
    } finally {
      URL.revokeObjectURL(blobUrl);
      setUpdatingBackground(false);
    }
  };

  const handleColorBackground = async (hex: string) => {
    if (!session) { return; }
    setUpdatingBackground(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await setBackgroundColor(api, hex);
      setFromBackend(res.user_background_url, res.user_background_color);
      setSuccess('背景已更新');
    } catch (err) {
      setError(err instanceof Error ? err.message : '设置纯色背景失败');
    } finally {
      setUpdatingBackground(false);
    }
  };

  const handleBackgroundRemove = async () => {
    if (!session) { return; }
    setUpdatingBackground(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await clearProfileBackground(api);
      setFromBackend(res.user_background_url, res.user_background_color);
      setSuccess('背景已清除');
    } catch (err) {
      setError(err instanceof Error ? err.message : '清除背景失败');
    } finally {
      setUpdatingBackground(false);
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

  const handleSuccess = (message: string) => {
    setError(null);
    setSuccess(message);
  };

  const handleError = (message: string) => {
    setSuccess(null);
    setError(message);
  };

  // QQ 淡染 + 封面样式（图片/纯色/无）；无背景回落 CSS 默认渐变。
  // 背景图相对路径必须经 resolveDisplayUrl 收口（webview 验不过私有 CA，裸后端 URL 加载失败）。
  const hero = qqHeroStyles(bgDominant);
  const cardStyle: React.CSSProperties = hero.cardBackground ? { background: hero.cardBackground } : {};
  const coverStyle = backgroundCoverStyle(bgKind, resolveDisplayUrl(bgBackgroundUrl), bgColor);
  const hasBackground = bgKind !== 'none';

  return {
    session,
    error,
    success,
    uploadingAvatar,
    uploadProgress,
    updatingNickname,
    updatingBackground,
    hasBackground,
    backgroundColor: bgColor,
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
  };
}
