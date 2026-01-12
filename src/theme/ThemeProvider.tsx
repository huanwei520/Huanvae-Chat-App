/**
 * 主题提供者组件
 *
 * 负责将主题数据应用到 CSS 变量
 * 监听系统主题变化并自动更新
 * 支持跨窗口主题同步
 *
 * @module theme/ThemeProvider
 */

import React, { useEffect } from 'react';
import { useThemeStore, DEFAULT_GLASS_CONFIG, DEFAULT_OPACITY_LEVELS } from './store';
import type { ThemeData, ColorScale, GlassConfig, OpacityLevels } from './types';
import { hexToRgb } from './utils';

// ============================================================================
// CSS 变量应用
// ============================================================================

/**
 * 将色阶应用到 CSS 变量
 */
function applyColorScale(root: HTMLElement, prefix: string, scale: ColorScale): void {
  Object.entries(scale).forEach(([step, value]) => {
    root.style.setProperty(`--${prefix}-${step}`, value);
  });
}

/**
 * 将毛玻璃配置应用到 CSS 变量
 *
 * 使用用户自定义的透明度层级配置，直接将用户设置的百分比值应用到对应的 CSS 变量
 */
function applyGlassConfig(root: HTMLElement, glass: GlassConfig): void {
  // 基础颜色 RGB 值（用于组合不同透明度）
  const baseRgb = hexToRgb(glass.baseColor);
  root.style.setProperty('--glass-base', baseRgb);

  // 获取用户自定义的透明度层级，如果没有则使用默认值
  const levels: OpacityLevels = glass.opacityLevels ?? DEFAULT_OPACITY_LEVELS;

  // 应用每个透明度层级到 CSS 变量
  // 遍历所有层级并设置对应的 --white-alpha-XX 和 --glass-XX 变量
  const levelEntries: Array<[keyof OpacityLevels, number]> = [
    ['level97', levels.level97],
    ['level95', levels.level95],
    ['level90', levels.level90],
    ['level85', levels.level85],
    ['level80', levels.level80],
    ['level75', levels.level75],
    ['level70', levels.level70],
    ['level60', levels.level60],
    ['level50', levels.level50],
    ['level45', levels.level45],
    ['level40', levels.level40],
    ['level35', levels.level35],
    ['level30', levels.level30],
    ['level25', levels.level25],
    ['level20', levels.level20],
    ['level15', levels.level15],
    ['level10', levels.level10],
  ];

  levelEntries.forEach(([key, value]) => {
    // key: "level97" -> numKey: "97"
    const numKey = key.replace('level', '');
    // 将百分比转换为 0-1 范围
    const opacity = value / 100;
    const rgbaValue = `rgba(${baseRgb}, ${opacity.toFixed(2)})`;
    // 设置两种变量名以保持兼容性
    root.style.setProperty(`--white-alpha-${numKey}`, rgbaValue);
    root.style.setProperty(`--glass-${numKey}`, rgbaValue);
  });

  // 模糊效果
  root.style.setProperty('--glass-blur', `blur(${glass.blur}px)`);

  // 饱和度
  root.style.setProperty('--glass-saturate', `saturate(${glass.saturation}%)`);

  // 边框
  root.style.setProperty(
    '--glass-border',
    `rgba(${baseRgb}, ${glass.borderOpacity.toFixed(2)})`,
  );

  // 组合的 backdrop-filter
  root.style.setProperty(
    '--glass-backdrop',
    `blur(${glass.blur}px) saturate(${glass.saturation}%)`,
  );

  // 模糊变量（相对于基础模糊度的比例）
  root.style.setProperty('--blur-sm', `${Math.round(glass.blur * 0.5)}px`);
  root.style.setProperty('--blur-md', `${glass.blur}px`);
  root.style.setProperty('--blur-lg', `${Math.round(glass.blur * 1.5)}px`);
  root.style.setProperty('--blur-xl', `${Math.round(glass.blur * 2)}px`);
}

/**
 * 将主题数据应用到 CSS 变量
 */
function applyThemeData(themeData: ThemeData, mode: 'light' | 'dark', glass: GlassConfig): void {
  const root = document.documentElement;

  // 设置主题模式属性
  root.setAttribute('data-theme', mode);

  // 应用色阶
  applyColorScale(root, 'color-primary', themeData.primaryScale);
  applyColorScale(root, 'color-accent', themeData.accentScale);
  applyColorScale(root, 'color-neutral', themeData.neutralScale);

  // 应用语义化 Token - 背景
  const { semantic } = themeData;
  root.style.setProperty('--bg-primary', semantic.bg.primary);
  root.style.setProperty('--bg-secondary', semantic.bg.secondary);
  root.style.setProperty('--bg-tertiary', semantic.bg.tertiary);
  root.style.setProperty('--bg-surface', semantic.bg.surface);
  root.style.setProperty('--bg-surface-hover', semantic.bg.surfaceHover);
  root.style.setProperty('--bg-muted', semantic.bg.muted);
  root.style.setProperty('--bg-inverse', semantic.bg.inverse);

  // 应用语义化 Token - 文字
  root.style.setProperty('--text-primary', semantic.text.primary);
  root.style.setProperty('--text-secondary', semantic.text.secondary);
  root.style.setProperty('--text-muted', semantic.text.muted);
  root.style.setProperty('--text-light', semantic.text.light);
  root.style.setProperty('--text-inverse', semantic.text.inverse);
  root.style.setProperty('--text-link', semantic.text.link);

  // 应用语义化 Token - 边框
  root.style.setProperty('--border-default', semantic.border.default);
  root.style.setProperty('--border-subtle', semantic.border.subtle);
  root.style.setProperty('--border-strong', semantic.border.strong);
  root.style.setProperty('--border-focus', semantic.border.focus);

  // 应用语义化 Token - 主色
  root.style.setProperty('--primary', semantic.primary.default);
  root.style.setProperty('--primary-hover', semantic.primary.hover);
  root.style.setProperty('--primary-active', semantic.primary.active);
  root.style.setProperty('--primary-subtle', semantic.primary.subtle);
  root.style.setProperty('--primary-text', semantic.primary.text);

  // 应用语义化 Token - 强调色
  root.style.setProperty('--accent', semantic.accent.default);
  root.style.setProperty('--accent-hover', semantic.accent.hover);
  root.style.setProperty('--accent-active', semantic.accent.active);
  root.style.setProperty('--accent-subtle', semantic.accent.subtle);
  root.style.setProperty('--accent-text', semantic.accent.text);

  // 应用语义化 Token - 状态色
  root.style.setProperty('--status-success', semantic.status.success);
  root.style.setProperty('--status-success-subtle', semantic.status.successSubtle);
  root.style.setProperty('--status-warning', semantic.status.warning);
  root.style.setProperty('--status-warning-subtle', semantic.status.warningSubtle);
  root.style.setProperty('--status-error', semantic.status.error);
  root.style.setProperty('--status-error-subtle', semantic.status.errorSubtle);
  root.style.setProperty('--status-info', semantic.status.info);
  root.style.setProperty('--status-info-subtle', semantic.status.infoSubtle);

  // 应用语义化 Token - 阴影
  root.style.setProperty('--shadow-sm', semantic.shadow.sm);
  root.style.setProperty('--shadow-md', semantic.shadow.md);
  root.style.setProperty('--shadow-lg', semantic.shadow.lg);
  root.style.setProperty('--shadow-glow', semantic.shadow.glow);
  root.style.setProperty('--shadow-focus', semantic.shadow.focus);

  // 应用毛玻璃配置
  applyGlassConfig(root, glass);
}

// ============================================================================
// 组件
// ============================================================================

interface ThemeProviderProps {
  children: React.ReactNode;
}

/**
 * 主题提供者
 *
 * 使用方式：
 * ```tsx
 * <ThemeProvider>
 *   <App />
 * </ThemeProvider>
 * ```
 */
export function ThemeProvider({ children }: ThemeProviderProps): React.ReactElement {
  const themeData = useThemeStore((state) => state.themeData);
  const effectiveMode = useThemeStore((state) => state.effectiveMode);
  const mode = useThemeStore((state) => state.config.mode);
  const glassConfig = useThemeStore((state) => state.config.customColors.glass ?? DEFAULT_GLASS_CONFIG);
  const refreshThemeData = useThemeStore((state) => state.refreshThemeData);

  // 应用主题到 CSS 变量
  useEffect(() => {
    applyThemeData(themeData, effectiveMode, glassConfig);
  }, [themeData, effectiveMode, glassConfig]);

  // 监听系统主题变化
  useEffect(() => {
    if (mode !== 'system') {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = () => {
      refreshThemeData();
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, [mode, refreshThemeData]);

  // 监听跨窗口 localStorage 变化（用于跨窗口主题同步）
  useEffect(() => {
    const setConfig = useThemeStore.getState().setConfig;

    const handleStorageChange = (e: StorageEvent) => {
      // 检查是否是主题配置变化
      if (e.key === 'huanvae-theme' && e.newValue) {
        try {
          // 解析新的配置
          const parsed = JSON.parse(e.newValue);
          if (parsed?.state?.config) {
            // 直接更新 Zustand store，这会触发重新渲染和 CSS 变量更新
            setConfig(parsed.state.config);
          }
        } catch (err) {
          console.warn('[Theme] 解析跨窗口主题配置失败:', err);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  return <>{children}</>;
}
