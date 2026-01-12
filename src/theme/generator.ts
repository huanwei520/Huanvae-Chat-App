/**
 * 主题数据生成器
 *
 * 根据用户配置生成完整的主题数据
 * 包括色阶、语义化 Token 等
 *
 * @module theme/generator
 */

import type { ThemeConfig, ThemeData, SemanticTokens, CustomColors } from './types';
import { generateColorScale, generateNeutralScale, withAlpha, generateShadows } from './utils';
import { getPresetConfig } from './presets';

// ============================================================================
// 语义化 Token 生成
// ============================================================================

/**
 * 生成浅色模式的语义化 Token
 */
function generateLightSemanticTokens(
  primaryScale: ReturnType<typeof generateColorScale>,
  accentScale: ReturnType<typeof generateColorScale>,
  neutralScale: ReturnType<typeof generateColorScale>,
  primaryColor: string,
): SemanticTokens {
  const shadows = generateShadows(primaryColor);

  return {
    bg: {
      primary: '#ffffff',
      secondary: neutralScale[1],
      tertiary: neutralScale[2],
      surface: withAlpha('#ffffff', 0.8),
      surfaceHover: withAlpha('#ffffff', 0.9),
      muted: neutralScale[3],
      inverse: neutralScale[12],
    },
    text: {
      primary: '#1e3a5f',
      secondary: '#475569',
      muted: '#64748b',
      light: '#94a3b8',
      inverse: '#ffffff',
      link: primaryScale[9],
    },
    border: {
      default: withAlpha(primaryScale[5], 0.3),
      subtle: withAlpha(primaryScale[5], 0.15),
      strong: withAlpha(primaryScale[6], 0.5),
      focus: withAlpha(primaryScale[7], 0.6),
    },
    primary: {
      default: primaryScale[9],
      hover: primaryScale[10],
      active: primaryScale[11],
      subtle: withAlpha(primaryScale[4], 0.2),
      text: primaryScale[11],
    },
    accent: {
      default: accentScale[9],
      hover: accentScale[10],
      active: accentScale[11],
      subtle: withAlpha(accentScale[4], 0.2),
      text: accentScale[11],
    },
    status: {
      success: '#22c55e',
      successSubtle: withAlpha('#22c55e', 0.15),
      warning: '#f59e0b',
      warningSubtle: withAlpha('#f59e0b', 0.15),
      error: '#ef4444',
      errorSubtle: withAlpha('#ef4444', 0.15),
      info: '#3b82f6',
      infoSubtle: withAlpha('#3b82f6', 0.15),
    },
    shadow: shadows,
  };
}

/**
 * 生成深色模式的语义化 Token
 */
function generateDarkSemanticTokens(
  primaryScale: ReturnType<typeof generateColorScale>,
  accentScale: ReturnType<typeof generateColorScale>,
  neutralScale: ReturnType<typeof generateColorScale>,
  primaryColor: string,
): SemanticTokens {
  const shadows = generateShadows(primaryColor);

  return {
    bg: {
      primary: neutralScale[1],
      secondary: neutralScale[2],
      tertiary: neutralScale[3],
      surface: withAlpha(neutralScale[2], 0.9),
      surfaceHover: withAlpha(neutralScale[3], 0.9),
      muted: neutralScale[4],
      inverse: neutralScale[12],
    },
    text: {
      primary: '#f8fafc',
      secondary: '#e2e8f0',
      muted: '#94a3b8',
      light: '#64748b',
      inverse: '#1e293b',
      link: primaryScale[9],
    },
    border: {
      default: withAlpha(neutralScale[6], 0.4),
      subtle: withAlpha(neutralScale[5], 0.25),
      strong: withAlpha(neutralScale[7], 0.5),
      focus: withAlpha(primaryScale[7], 0.6),
    },
    primary: {
      default: primaryScale[9],
      hover: primaryScale[8],
      active: primaryScale[7],
      subtle: withAlpha(primaryScale[9], 0.2),
      text: primaryScale[9],
    },
    accent: {
      default: accentScale[9],
      hover: accentScale[8],
      active: accentScale[7],
      subtle: withAlpha(accentScale[9], 0.2),
      text: accentScale[9],
    },
    status: {
      success: '#4ade80',
      successSubtle: withAlpha('#4ade80', 0.2),
      warning: '#fbbf24',
      warningSubtle: withAlpha('#fbbf24', 0.2),
      error: '#f87171',
      errorSubtle: withAlpha('#f87171', 0.2),
      info: '#60a5fa',
      infoSubtle: withAlpha('#60a5fa', 0.2),
    },
    shadow: shadows,
  };
}

// ============================================================================
// 主题生成
// ============================================================================

/**
 * 获取实际的颜色配置
 */
function getColors(config: ThemeConfig): CustomColors {
  if (config.preset === 'custom') {
    return config.customColors;
  }
  return getPresetConfig(config.preset).colors;
}

/**
 * 获取实际的主题模式
 */
export function getEffectiveMode(mode: ThemeConfig['mode']): 'light' | 'dark' {
  if (mode === 'system') {
    if (typeof window !== 'undefined') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  }
  return mode;
}

/**
 * 生成完整的主题数据
 *
 * @param config - 主题配置
 * @returns 完整的主题数据
 */
export function generateThemeData(config: ThemeConfig): ThemeData {
  const colors = getColors(config);
  const isDark = getEffectiveMode(config.mode) === 'dark';

  const primaryColor = colors.primary;
  const accentColor = colors.accent ?? colors.primary;

  // 生成色阶
  const primaryScale = generateColorScale(primaryColor, isDark);
  const accentScale = generateColorScale(accentColor, isDark);
  const neutralScale = generateNeutralScale(primaryColor, isDark);

  // 生成语义化 Token
  const semantic = isDark
    ? generateDarkSemanticTokens(primaryScale, accentScale, neutralScale, primaryColor)
    : generateLightSemanticTokens(primaryScale, accentScale, neutralScale, primaryColor);

  return {
    primaryScale,
    accentScale,
    neutralScale,
    semantic,
  };
}
