/**
 * 登录后从后端拉取自己的个人资料背景，灌入 [profileBackground] store
 *
 * @location src/hooks/useHydrateProfileBackground.ts
 *
 * 背景数据（图/纯色 + 代表色）由后端持久化、不存本地，故每次会话就绪时拉一次 GET /api/profile
 * 把 user_background_url / user_background_color 写进 store，驱动 QQ 卡底淡染 + 「主题色跟随背景」。
 * 在 App 顶层调用一次即可（session 变化时重新拉取）。
 */

import { useEffect } from 'react';
import { useSession, useApi } from '../contexts/SessionContext';
import { getProfile } from '../api/profile';
import { useProfileBackground } from '../stores';

export function useHydrateProfileBackground(): void {
  const { session } = useSession();
  const api = useApi();
  const userId = session?.userId;

  useEffect(() => {
    // 登出/未登录：清掉上一个账号的背景，避免跨账号残留
    if (!userId) {
      useProfileBackground.getState().setFromBackend('', '');
      return;
    }
    let cancelled = false;
    // 切账号时先清空，避免拉取窗口期（或拉取失败时）仍显示上一个账号的背景
    useProfileBackground.getState().setFromBackend('', '');
    getProfile(api)
      .then((p) => {
        if (cancelled) { return; }
        useProfileBackground.getState().setFromBackend(
          p.user_background_url ?? '',
          p.user_background_color ?? '',
        );
      })
      .catch(() => { /* 拉取失败保持已清空状态（无背景），不兜底 */ });
    return () => { cancelled = true; };
  }, [api, userId]);
}
