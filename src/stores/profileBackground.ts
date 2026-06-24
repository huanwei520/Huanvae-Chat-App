/**
 * 个人资料背景 —— 后端持久化状态 (Zustand)
 *
 * @location src/stores/profileBackground.ts
 *
 * 用户的个人资料背景（也是 App 唯一的「背景」概念）：可为背景图（落 MinIO 公开读桶
 * user-backgrounds）或纯色，由后端 /api/profile/background 持久化、别人主页也可见
 * （见 api/profile + [useHydrateProfileBackground]）。背景主色 dominant（后端
 * user-background-color）用于 QQ 资料卡淡染（见 [profileCover]），并在「主题色跟随背景」
 * 开启时驱动全局主题色（调 [theme/store] 的 setPrimaryColor/setAccentColor）。
 *
 * 跨 store 联动是**单向**的：背景 → 主题（本 store import theme store）；theme store 不反向
 * 依赖本 store，避免循环。
 *
 * 背景数据本身**不**持久化到本地——每次登录由 [useHydrateProfileBackground] 从后端拉取灌入；
 * 仅「主题色跟随背景」开关是本地偏好，persist 到 localStorage(key=huanvae-profile-background)。
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { type RGB, hexToRgb, rgbToHex } from '../utils/imageColor';
import { type BackgroundKind, backgroundKindOf } from '../utils/profileCover';
import { useThemeStore } from '../theme/store';

interface ProfileBackgroundState {
  /** 背景类型：无 / 图片 / 纯色 */
  kind: BackgroundKind;
  /** 背景图相对路径（后端 user-background-url；kind!=='image' 时为 null）。显示前经 resolveDisplayUrl 收口 */
  backgroundUrl: string | null;
  /** 纯色背景 hex（kind!=='color' 时为 null） */
  color: string | null;
  /** 背景主色（后端 user-background-color → RGB）；用于卡底淡染 + 驱动主题色 */
  dominant: RGB | null;
  /** 主题色是否跟随背景（默认开） */
  themeFollowsBackground: boolean;

  /**
   * 用后端返回的 (背景图相对路径, 代表色 hex) 刷新背景状态。
   * 登录拉取 / 上传图 / 设纯色 / 清除 四条路径通用（后端响应均为这两字段）。
   */
  setFromBackend: (backgroundUrl: string, backgroundColor: string) => void;
  /** 切换「主题色跟随背景」；开启时立即用当前背景主色刷新主题 */
  setFollowBackground: (follow: boolean) => void;
}

/**
 * 跟随开启且有主色时，把背景主色写进全局主题（单向：背景 → 主题）。
 * 主色 + 强调色都设为背景主色，让整个主题（含主背景渐变 + 两个装饰球：主色球/强调色球）
 * 统一跟随封面，符合「整个主题保持统一风格」。
 */
function applyFollow(follow: boolean, dominant: RGB | null): void {
  if (follow && dominant) {
    const hex = rgbToHex(dominant);
    const theme = useThemeStore.getState();
    theme.setPrimaryColor(hex);
    theme.setAccentColor(hex);
  }
}

export const useProfileBackground = create<ProfileBackgroundState>()(
  persist(
    (set, get) => ({
      kind: 'none',
      backgroundUrl: null,
      color: null,
      dominant: null,
      themeFollowsBackground: true,

      setFromBackend: (backgroundUrl, backgroundColor) => {
        const url = backgroundUrl.trim() || null;
        const colorHex = backgroundColor.trim() || null;
        const kind = backgroundKindOf(url, colorHex);
        // 主色来自后端代表色（图片=提取主色 / 纯色=该色）；无背景时为 null
        const dominant = kind !== 'none' && colorHex ? hexToRgb(colorHex) : null;
        set({
          kind,
          backgroundUrl: kind === 'image' ? url : null,
          color: kind === 'color' ? colorHex : null, // color 字段仅纯色背景用
          dominant,
        });
        applyFollow(get().themeFollowsBackground, dominant);
      },

      setFollowBackground: (follow) => {
        set({ themeFollowsBackground: follow });
        if (follow) { applyFollow(true, get().dominant); }
      },
    }),
    {
      name: 'huanvae-profile-background',
      // 只持久化本地偏好开关；背景数据每次登录从后端拉取（别人也可见）
      partialize: (state) => ({ themeFollowsBackground: state.themeFollowsBackground }),
    },
  ),
);
