/**
 * QQ 风格资料卡的封面/主色派生（纯函数，无副作用）
 *
 * @location src/utils/profileCover.ts
 *
 * 三个资料载体（桌面编辑弹窗 ProfileModal / 桌面+移动只读面板 OtherProfilePanel /
 * 移动编辑页 MobileProfilePage）共用同一套 QQ 视觉骨架：通栏封面 + 上叠圆角淡染卡 +
 * 头像骑边。本模块把「封面主色调」换算成卡片底色 / 封面兜底色 / 文字明暗，集中一处、
 * 便于单测（避开 canvas）。取色逻辑见 [imageColor.ts]。
 */

import { type RGB, rgbToCss, mixWithWhite } from './imageColor';

/** 卡片底色与白混合比例：越大越淡。0.82 接近 QQ 的淡蓝卡底，保证卡内深色文字可读 */
export const CARD_TINT = 0.82;

export interface QQHeroStyles {
  /** 卡片底色（封面主色淡染）；null = 无主色，回落 CSS 默认卡底 */
  cardBackground: string | null;
  /** 封面区无图时的兜底实底（用主色实色）；null = 无主色，回落 CSS 默认渐变 */
  coverFallback: string | null;
}

/**
 * 由封面主色调派生 QQ 资料卡的样式值。
 *
 * - 有主色：卡底 = 主色与白 82% 混合（淡染）；封面兜底 = 主色实色
 * - 无主色（看别人 / 未设封面）：全部 null，交给 CSS 默认底（「留空不兜底」原则下用中性默认）
 *
 * 封面浮层按钮/文字的可读性由 profile-hero.css 的 scrim 渐变保证，不在此处按亮度切色。
 */
export function qqHeroStyles(dominant: RGB | null | undefined): QQHeroStyles {
  if (!dominant) {
    return { cardBackground: null, coverFallback: null };
  }
  return {
    cardBackground: rgbToCss(mixWithWhite(dominant, CARD_TINT)),
    coverFallback: rgbToCss(dominant),
  };
}
