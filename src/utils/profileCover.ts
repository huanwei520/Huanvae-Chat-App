/**
 * QQ 风格资料卡的封面/主色派生（纯函数，无副作用）
 *
 * @location src/utils/profileCover.ts
 *
 * 三个资料载体（桌面编辑弹窗 ProfileModal / 桌面+移动只读面板 OtherProfilePanel /
 * 移动编辑页 MobileProfilePage）共用同一套 QQ 视觉骨架：通栏封面 + 上叠圆角淡染卡 +
 * 头像骑边。本模块把「背景主色」换算成卡片底色淡染（qqHeroStyles），并按背景类型
 * 派生封面区 CSS（backgroundCoverStyle：图片 / 纯色 / 默认）。集中一处便于单测（避开
 * canvas）。取色逻辑见 [imageColor]，背景状态见 [profileBackground] store。
 */

import type { CSSProperties } from 'react';
import { type RGB, rgbToCss, mixWithWhite } from './imageColor';

/** 背景类型：无 / 图片 / 纯色（见 [profileBackground] store） */
export type BackgroundKind = 'none' | 'image' | 'color';

/**
 * 由后端的 (背景图相对路径, 代表色 hex) 判定背景类型：有图 → image，否则有色 → color，都无 → none。
 * 自己（store setFromBackend）与他人（OtherProfilePanel 读公开资料）共用同一判定，避免漂移。
 */
export function backgroundKindOf(backgroundUrl: string | null, color: string | null): BackgroundKind {
  if (backgroundUrl) { return 'image'; }
  if (color) { return 'color'; }
  return 'none';
}

/** 卡片底色与白混合比例：越大越淡。0.82 接近 QQ 的淡蓝卡底，保证卡内深色文字可读 */
export const CARD_TINT = 0.82;

export interface QQHeroStyles {
  /** 卡片底色（背景主色淡染）；null = 无主色，回落 CSS 默认卡底 */
  cardBackground: string | null;
}

/**
 * 由背景主色调派生 QQ 资料卡的卡底淡染色。
 *
 * - 有主色：卡底 = 主色与白 82% 混合（淡染）
 * - 无主色（看别人 / 未设背景）：null，交给 CSS 默认卡底（「留空不兜底」用中性默认）
 *
 * 封面区背景由 [backgroundCoverStyle] 处理（图片/纯色/默认）；浮层按钮可读性由
 * profile-hero.css 的 scrim 渐变保证，不在此处按亮度切色。
 */
export function qqHeroStyles(dominant: RGB | null | undefined): QQHeroStyles {
  if (!dominant) {
    return { cardBackground: null };
  }
  return {
    cardBackground: rgbToCss(mixWithWhite(dominant, CARD_TINT)),
  };
}

/**
 * 由背景类型派生封面区的 CSS 背景（三个资料载体共用，避免各写一份）。
 * - image：用背景图 URL 作 backgroundImage（调用方传**已经过 resolveDisplayUrl 收口**的可显示 URL）
 * - color：用纯色作 backgroundColor（覆盖 CSS 默认渐变）
 * - none / 缺值：返回空对象，回落 profile-hero.css 的默认渐变
 */
export function backgroundCoverStyle(
  kind: BackgroundKind,
  imageUrl: string | null,
  color: string | null,
): CSSProperties {
  if (kind === 'image' && imageUrl) {
    return { backgroundImage: `url(${imageUrl})` };
  }
  if (kind === 'color' && color) {
    return { backgroundImage: 'none', backgroundColor: color };
  }
  return {};
}
