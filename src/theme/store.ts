/**
 * 主题状态管理
 *
 * 使用 Zustand + persist 保存用户主题配置到 localStorage
 *
 * @module theme/store
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ThemeConfig, ThemeData, ThemeMode, ThemePreset, CustomColors, GlassConfig, OpacityLevels } from './types';
import { generateThemeData, getEffectiveMode } from './generator';
import { getPresetConfig } from './presets';

// ============================================================================
// 类型定义
// ============================================================================

interface ThemeState {
  /** 主题配置 */
  config: ThemeConfig;
  /** 生成的主题数据（不持久化） */
  themeData: ThemeData;
  /** 实际生效的模式（考虑 system） */
  effectiveMode: 'light' | 'dark';

  // Actions
  /** 设置主题模式 */
  setMode: (mode: ThemeMode) => void;
  /** 设置预设主题 */
  setPreset: (preset: ThemePreset) => void;
  /** 设置自定义主色 */
  setPrimaryColor: (color: string) => void;
  /** 设置自定义强调色 */
  setAccentColor: (color: string) => void;
  /** 设置毛玻璃配置 */
  setGlassConfig: (glass: Partial<GlassConfig>) => void;
  /** 设置单个透明度层级 */
  setOpacityLevel: (key: keyof OpacityLevels, value: number) => void;
  /** 重置为默认主题 */
  reset: () => void;
  /** 刷新主题数据（在系统主题变化时调用） */
  refreshThemeData: () => void;
  /** 直接设置完整配置（用于跨窗口同步） */
  setConfig: (config: ThemeConfig) => void;
}

// ============================================================================
// 默认配置
// ============================================================================

/** 默认透明度层级配置 */
export const DEFAULT_OPACITY_LEVELS: OpacityLevels = {
  level97: 97,  // 弹窗层 - 模态框主体
  level95: 95,  // 弹窗层 - 菜单背景
  level90: 90,  // 主背景层 - 卡片高光
  level85: 85,  // 主背景层 - 账号选择器
  level80: 80,  // 卡片层 - 头像、气泡
  level75: 75,  // 卡片层 - 边框强调
  level70: 70,  // 面板层 - 侧边栏
  level60: 60,  // 面板层 - 会话列表
  level50: 50,  // 辅助层 - 菜单选项
  level45: 45,  // 辅助层 - 渐变终点
  level40: 40,  // 辅助层 - 表单元素
  level35: 35,  // 辅助层 - 次级元素
  level30: 30,  // 遮罩层 - 轻遮罩
  level25: 25,  // 遮罩层 - 边框
  level20: 20,  // 遮罩层 - 阴影
  level15: 15,  // 遮罩层 - 深遮罩
  level10: 10,  // 遮罩层 - 最透明
};

/** 默认毛玻璃配置 */
export const DEFAULT_GLASS_CONFIG: GlassConfig = {
  baseColor: '#ffffff',
  opacity: 1.0,  // 不再作为乘数使用，保留用于向后兼容
  blur: 16,
  saturation: 180,
  borderOpacity: 0.3,
  opacityLevels: DEFAULT_OPACITY_LEVELS,
};

const DEFAULT_CONFIG: ThemeConfig = {
  mode: 'light', // 默认浅色模式
  preset: 'default',
  customColors: {
    primary: '#3b82f6',
    accent: '#8b5cf6',
    glass: DEFAULT_GLASS_CONFIG,
  },
};

// ============================================================================
// Store 实现
// ============================================================================

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      config: DEFAULT_CONFIG,
      themeData: generateThemeData(DEFAULT_CONFIG),
      effectiveMode: getEffectiveMode(DEFAULT_CONFIG.mode),

      setMode: (mode: ThemeMode) => {
        const newConfig = { ...get().config, mode };
        set({
          config: newConfig,
          themeData: generateThemeData(newConfig),
          effectiveMode: getEffectiveMode(mode),
        });
      },

      setPreset: (preset: ThemePreset) => {
        const newConfig = { ...get().config, preset };
        // 如果切换到非自定义预设，同步更新自定义颜色（便于之后切换回自定义时使用）
        if (preset !== 'custom') {
          const presetColors = getPresetConfig(preset).colors;
          newConfig.customColors = { ...presetColors };
        }
        set({
          config: newConfig,
          themeData: generateThemeData(newConfig),
        });
      },

      setPrimaryColor: (color: string) => {
        const config = get().config;
        const newConfig: ThemeConfig = {
          ...config,
          preset: 'custom', // 修改颜色自动切换到自定义
          customColors: {
            ...config.customColors,
            primary: color,
          },
        };
        set({
          config: newConfig,
          themeData: generateThemeData(newConfig),
        });
      },

      setAccentColor: (color: string) => {
        const config = get().config;
        const newConfig: ThemeConfig = {
          ...config,
          preset: 'custom',
          customColors: {
            ...config.customColors,
            accent: color,
          },
        };
        set({
          config: newConfig,
          themeData: generateThemeData(newConfig),
        });
      },

      setGlassConfig: (glass: Partial<GlassConfig>) => {
        const config = get().config;
        const currentGlass = config.customColors.glass ?? DEFAULT_GLASS_CONFIG;
        const newConfig: ThemeConfig = {
          ...config,
          preset: 'custom', // 修改毛玻璃自动切换到自定义
          customColors: {
            ...config.customColors,
            glass: { ...currentGlass, ...glass },
          },
        };
        set({
          config: newConfig,
          themeData: generateThemeData(newConfig),
        });
      },

      setOpacityLevel: (key: keyof OpacityLevels, value: number) => {
        const config = get().config;
        const currentGlass = config.customColors.glass ?? DEFAULT_GLASS_CONFIG;
        const currentLevels = currentGlass.opacityLevels ?? DEFAULT_OPACITY_LEVELS;
        const newConfig: ThemeConfig = {
          ...config,
          preset: 'custom', // 修改透明度自动切换到自定义
          customColors: {
            ...config.customColors,
            glass: {
              ...currentGlass,
              opacityLevels: {
                ...currentLevels,
                [key]: value,
              },
            },
          },
        };
        set({
          config: newConfig,
          themeData: generateThemeData(newConfig),
        });
      },

      reset: () => {
        set({
          config: DEFAULT_CONFIG,
          themeData: generateThemeData(DEFAULT_CONFIG),
          effectiveMode: getEffectiveMode(DEFAULT_CONFIG.mode),
        });
      },

      refreshThemeData: () => {
        const config = get().config;
        set({
          themeData: generateThemeData(config),
          effectiveMode: getEffectiveMode(config.mode),
        });
      },

      setConfig: (config: ThemeConfig) => {
        set({
          config,
          themeData: generateThemeData(config),
          effectiveMode: getEffectiveMode(config.mode),
        });
      },
    }),
    {
      name: 'huanvae-theme',
      // 只持久化配置，不持久化生成的数据
      partialize: (state) => ({ config: state.config }),
      // 恢复时重新生成主题数据
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.themeData = generateThemeData(state.config);
          state.effectiveMode = getEffectiveMode(state.config.mode);
        }
      },
    },
  ),
);

// ============================================================================
// 便捷 Hook
// ============================================================================

/**
 * 获取当前主题数据
 */
export function useThemeData(): ThemeData {
  return useThemeStore((state) => state.themeData);
}

/**
 * 获取当前主题配置
 */
export function useThemeConfig(): ThemeConfig {
  return useThemeStore((state) => state.config);
}

/**
 * 获取当前生效的模式
 */
export function useEffectiveMode(): 'light' | 'dark' {
  return useThemeStore((state) => state.effectiveMode);
}

/**
 * 获取当前自定义颜色
 */
export function useCustomColors(): CustomColors {
  return useThemeStore((state) => state.config.customColors);
}

/**
 * 获取当前毛玻璃配置
 */
export function useGlassConfig(): GlassConfig {
  return useThemeStore((state) => state.config.customColors.glass ?? DEFAULT_GLASS_CONFIG);
}

/**
 * 获取当前透明度层级配置
 */
export function useOpacityLevels(): OpacityLevels {
  return useThemeStore((state) => state.config.customColors.glass?.opacityLevels ?? DEFAULT_OPACITY_LEVELS);
}
