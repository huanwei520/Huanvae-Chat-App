/**
 * 主题预设配置
 *
 * 定义内置的主题预设，以当前应用的蓝色系为默认主题
 *
 * @module theme/presets
 */

import type { CustomColors, ThemePreset, GlassConfig } from './types';

// ============================================================================
// 预设定义
// ============================================================================

/** 预设配置 */
export interface PresetConfig {
  /** 预设名称（显示用） */
  name: string;
  /** 描述 */
  description: string;
  /** 颜色配置 */
  colors: CustomColors;
  /** 预览色（用于选择器展示） */
  previewColors: string[];
}

/** 默认毛玻璃配置 */
const DEFAULT_GLASS: GlassConfig = {
  baseColor: '#ffffff',
  opacity: 0.8,
  blur: 16,
  saturation: 180,
  borderOpacity: 0.3,
};

/**
 * 所有预设（仅保留默认和自定义）
 *
 * 默认主题使用当前应用的硬编码颜色，不会改变界面外观
 * 自定义主题允许用户选择主色和强调色
 */
export const THEME_PRESETS: Record<ThemePreset, PresetConfig> = {
  // 默认主题 - 当前应用硬编码的蓝色系
  default: {
    name: '默认',
    description: '应用默认配色方案',
    colors: {
      primary: '#3b82f6', // 当前应用使用的主蓝色
      accent: '#8b5cf6',  // 紫色强调
      glass: DEFAULT_GLASS,
    },
    previewColors: ['#3b82f6', '#60a5fa', '#93c5fd'],
  },

  // 自定义主题 - 用户自定义颜色
  custom: {
    name: '自定义',
    description: '自定义您的专属配色',
    colors: {
      primary: '#3b82f6',
      accent: '#8b5cf6',
      glass: DEFAULT_GLASS,
    },
    previewColors: ['#3b82f6', '#60a5fa', '#93c5fd'],
  },
};

/**
 * 获取预设配置
 */
export function getPresetConfig(preset: ThemePreset): PresetConfig {
  return THEME_PRESETS[preset];
}

/**
 * 获取所有预设列表（用于 UI 展示）
 */
export function getAllPresets(): Array<{ key: ThemePreset; config: PresetConfig }> {
  return (Object.keys(THEME_PRESETS) as ThemePreset[]).map((key) => ({
    key,
    config: THEME_PRESETS[key],
  }));
}
