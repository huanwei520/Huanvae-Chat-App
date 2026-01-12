/**
 * 主题颜色工具函数
 *
 * 使用 culori 库进行专业的颜色计算
 * 基于 OKLCH 色彩空间确保感知均匀性
 *
 * @module theme/utils
 */

import { oklch, formatHex, parse } from 'culori';
import type { ColorScale } from './types';

// ============================================================================
// 色阶生成
// ============================================================================

/**
 * 亮度分布配置（针对浅色模式优化）
 * 从最浅到最深的 12 级亮度值
 */
const LIGHT_MODE_LIGHTNESS = [
  0.985, // 1: 几乎白色，用于浅背景
  0.965, // 2: 很浅，用于 hover 背景
  0.925, // 3: 浅色，用于 active 背景
  0.885, // 4: 边框浅色
  0.825, // 5: 边框默认
  0.745, // 6: 边框强调
  0.645, // 7: 实色背景浅
  0.565, // 8: 实色背景
  0.485, // 9: 主色（最常用）
  0.425, // 10: 主色深
  0.365, // 11: 文字色
  0.255, // 12: 高对比度文字
];

/**
 * 亮度分布配置（针对深色模式优化）
 */
const DARK_MODE_LIGHTNESS = [
  0.135, // 1: 深背景
  0.165, // 2: 稍浅背景
  0.205, // 3: hover 背景
  0.255, // 4: active 背景
  0.315, // 5: 边框暗
  0.385, // 6: 边框默认
  0.465, // 7: 边框亮
  0.545, // 8: 实色背景
  0.625, // 9: 主色
  0.705, // 10: 主色亮
  0.795, // 11: 文字色
  0.895, // 12: 高对比度文字
];

/**
 * 从单一主色生成 12 级色阶
 *
 * @param baseColor - 基础颜色（hex 格式）
 * @param isDark - 是否为深色模式
 * @returns 12 级色阶
 */
export function generateColorScale(baseColor: string, isDark = false): ColorScale {
  const parsed = parse(baseColor);
  if (!parsed) {
    console.warn('[Theme] 无法解析颜色:', baseColor);
    return generateColorScale('#3b82f6', isDark); // 回退到默认蓝色
  }

  const base = oklch(parsed);
  if (!base) {
    return generateColorScale('#3b82f6', isDark);
  }

  const lightnesses = isDark ? DARK_MODE_LIGHTNESS : LIGHT_MODE_LIGHTNESS;

  // 保持色相和饱和度，只调整亮度
  const scale: Partial<ColorScale> = {};
  lightnesses.forEach((l, i) => {
    const step = (i + 1) as keyof ColorScale;
    const color = { ...base, l };
    scale[step] = formatHex(color) || baseColor;
  });

  return scale as ColorScale;
}

/**
 * 生成中性色阶（灰色系）
 *
 * @param primaryColor - 主色（用于给灰色增加少量色调）
 * @param isDark - 是否为深色模式
 * @returns 12 级中性色阶
 */
export function generateNeutralScale(primaryColor: string, isDark = false): ColorScale {
  const parsed = parse(primaryColor);
  const base = parsed ? oklch(parsed) : null;

  // 从主色提取色相，用于给灰色增加微弱色调
  const hue = base?.h ?? 220; // 默认蓝色色相
  const chroma = 0.01; // 非常低的饱和度，几乎是纯灰

  const lightnesses = isDark ? DARK_MODE_LIGHTNESS : LIGHT_MODE_LIGHTNESS;

  const scale: Partial<ColorScale> = {};
  lightnesses.forEach((l, i) => {
    const step = (i + 1) as keyof ColorScale;
    const color = { mode: 'oklch' as const, l, c: chroma, h: hue };
    scale[step] = formatHex(color) || '#808080';
  });

  return scale as ColorScale;
}

// ============================================================================
// 颜色操作
// ============================================================================

/**
 * 将 HEX 颜色转换为 RGB 数值（用于 CSS 变量组合）
 *
 * @param hex - 十六进制颜色
 * @returns "r, g, b" 格式字符串
 */
export function hexToRgb(hex: string): string {
  // 直接解析 hex 字符串
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) {
    return '255, 255, 255';
  }

  const r = parseInt(result[1], 16);
  const g = parseInt(result[2], 16);
  const b = parseInt(result[3], 16);

  return `${r}, ${g}, ${b}`;
}

/**
 * 调整颜色透明度
 *
 * @param hex - 十六进制颜色
 * @param alpha - 透明度 0-1
 * @returns rgba 格式字符串
 */
export function withAlpha(hex: string, alpha: number): string {
  const rgbStr = hexToRgb(hex);
  return `rgba(${rgbStr}, ${alpha})`;
}

/**
 * 判断颜色是否为深色（用于决定文字颜色）
 *
 * @param hex - 十六进制颜色
 * @returns 是否为深色
 */
export function isDarkColor(hex: string): boolean {
  const parsed = parse(hex);
  if (!parsed) {
    return false;
  }

  const lch = oklch(parsed);
  return lch ? lch.l < 0.5 : false;
}

/**
 * 获取对比色（用于文字）
 *
 * @param bgColor - 背景颜色
 * @returns 适合的文字颜色（黑或白）
 */
export function getContrastColor(bgColor: string): string {
  return isDarkColor(bgColor) ? '#ffffff' : '#1e3a5f';
}

// ============================================================================
// 阴影生成
// ============================================================================

/**
 * 生成基于主色的阴影
 *
 * @param primaryColor - 主色
 * @returns 阴影配置
 */
export function generateShadows(primaryColor: string): {
  sm: string;
  md: string;
  lg: string;
  glow: string;
  focus: string;
} {
  const glowColor = withAlpha(primaryColor, 0.25);
  const focusColor = withAlpha(primaryColor, 0.15);

  return {
    sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
    md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
    lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
    glow: `0 0 20px ${glowColor}, 0 0 40px ${withAlpha(primaryColor, 0.15)}`,
    focus: `0 0 0 3px ${focusColor}`,
  };
}
