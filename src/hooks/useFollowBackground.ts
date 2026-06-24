/**
 * 「主题色跟随背景」开关的共享读写（桌面 ThemeEditor + 移动 MobileThemePage 共用）
 *
 * @location src/hooks/useFollowBackground.ts
 *
 * 开关状态存于 [profileBackground] store（跟随逻辑也在那：开时背景主色 → setPrimaryColor）。
 * 两个主题编辑器的开关订阅与门控判定走同一 hook，避免两份 store 订阅逐字漂移。
 */

import { useProfileBackground } from '../stores';

export function useFollowBackground(): { follow: boolean; setFollow: (follow: boolean) => void } {
  const follow = useProfileBackground((s) => s.themeFollowsBackground);
  const setFollow = useProfileBackground((s) => s.setFollowBackground);
  return { follow, setFollow };
}
