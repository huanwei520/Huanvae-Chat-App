/**
 * 主题系统类型定义
 *
 * 三层 Token 架构：
 * 1. Primitive Tokens - 基础色值（如 blue-500）
 * 2. Semantic Tokens - 语义化映射（如 primary, bg-surface）
 * 3. Component Tokens - 组件级（如 button-bg, card-border）
 *
 * @module theme/types
 */

// ============================================================================
// 色阶类型
// ============================================================================

/**
 * 12 级色阶（基于 Radix Colors 标准）
 *
 * 1-2: 背景色
 * 3-4: 交互状态（hover/active）
 * 5-6: 边框
 * 7-8: 实色背景
 * 9-11: 实色/文字
 * 12: 高对比度
 */
export interface ColorScale {
  1: string;
  2: string;
  3: string;
  4: string;
  5: string;
  6: string;
  7: string;
  8: string;
  9: string;
  10: string;
  11: string;
  12: string;
}

// ============================================================================
// 主题 Token
// ============================================================================

/** 主题模式 */
export type ThemeMode = 'light' | 'dark' | 'system';

/** 主题预设名称（仅保留默认和自定义） */
export type ThemePreset = 'default' | 'custom';

/**
 * 透明度层级配置
 *
 * 控制各 UI 层级的独立透明度，数值范围 0-100（百分比）
 * - 弹窗层 (97%, 95%): 模态框、右键菜单、搜索弹窗
 * - 主背景层 (90%, 85%): 账号选择卡片、高光效果
 * - 卡片层 (80%, 75%): 头像框、消息气泡、文档卡片
 * - 面板层 (70%, 60%): 侧边栏、会话列表、输入区域
 * - 辅助层 (50%, 45%, 40%, 35%): 菜单选项、表单元素
 * - 遮罩层 (30%, 25%, 20%, 15%, 10%): 边框、阴影、遮罩效果
 */
export interface OpacityLevels {
  /** 弹窗层 - 模态框主体 */
  level97: number;
  /** 弹窗层 - 菜单背景 */
  level95: number;
  /** 主背景层 - 卡片高光 */
  level90: number;
  /** 主背景层 - 账号选择器 */
  level85: number;
  /** 卡片层 - 头像、气泡 */
  level80: number;
  /** 卡片层 - 边框强调 */
  level75: number;
  /** 面板层 - 侧边栏 */
  level70: number;
  /** 面板层 - 会话列表 */
  level60: number;
  /** 辅助层 - 菜单选项 */
  level50: number;
  /** 辅助层 - 渐变终点 */
  level45: number;
  /** 辅助层 - 表单元素 */
  level40: number;
  /** 辅助层 - 次级元素 */
  level35: number;
  /** 遮罩层 - 轻遮罩 */
  level30: number;
  /** 遮罩层 - 边框 */
  level25: number;
  /** 遮罩层 - 阴影 */
  level20: number;
  /** 遮罩层 - 深遮罩 */
  level15: number;
  /** 遮罩层 - 最透明 */
  level10: number;
}

/**
 * 毛玻璃效果配置
 *
 * 控制应用中毛玻璃效果的外观参数
 */
export interface GlassConfig {
  /** 基础颜色（HEX 格式，如 "#ffffff"） */
  baseColor: string;
  /** 全局透明度乘数（已弃用，保留用于向后兼容） */
  opacity: number;
  /** 模糊度（4 ~ 40 px） */
  blur: number;
  /** 饱和度（100 ~ 250 %） */
  saturation: number;
  /** 边框透明度（0.1 ~ 0.6） */
  borderOpacity: number;
  /** 各层级透明度（高级选项） */
  opacityLevels?: OpacityLevels;
}

/** 用户自定义颜色配置 */
export interface CustomColors {
  /** 主色（用于生成主色阶） */
  primary: string;
  /** 强调色（用于生成强调色阶） */
  accent?: string;
  /** 毛玻璃效果配置 */
  glass?: GlassConfig;
}

/** 完整主题配置 */
export interface ThemeConfig {
  /** 主题模式 */
  mode: ThemeMode;
  /** 预设名称 */
  preset: ThemePreset;
  /** 自定义颜色（仅 preset=custom 时使用） */
  customColors: CustomColors;
}

/** 语义化 Token */
export interface SemanticTokens {
  // 背景色
  bg: {
    primary: string;      // 主背景
    secondary: string;    // 次级背景
    tertiary: string;     // 第三级背景
    surface: string;      // 表面/卡片
    surfaceHover: string; // 表面悬停
    muted: string;        // 弱化背景
    inverse: string;      // 反色背景
  };
  // 文字颜色
  text: {
    primary: string;      // 主要文字
    secondary: string;    // 次要文字
    muted: string;        // 弱化文字
    light: string;        // 浅色文字
    inverse: string;      // 反色文字
    link: string;         // 链接文字
  };
  // 边框颜色
  border: {
    default: string;      // 默认边框
    subtle: string;       // 微弱边框
    strong: string;       // 强调边框
    focus: string;        // 聚焦边框
  };
  // 主色
  primary: {
    default: string;      // 主色
    hover: string;        // 悬停
    active: string;       // 按下
    subtle: string;       // 浅色背景
    text: string;         // 主色文字
  };
  // 强调色
  accent: {
    default: string;
    hover: string;
    active: string;
    subtle: string;
    text: string;
  };
  // 状态色
  status: {
    success: string;
    successSubtle: string;
    warning: string;
    warningSubtle: string;
    error: string;
    errorSubtle: string;
    info: string;
    infoSubtle: string;
  };
  // 阴影
  shadow: {
    sm: string;
    md: string;
    lg: string;
    glow: string;         // 发光效果（使用主色）
    focus: string;        // 聚焦环效果
  };
}

/** 完整主题数据 */
export interface ThemeData {
  /** 主色阶 */
  primaryScale: ColorScale;
  /** 强调色阶 */
  accentScale: ColorScale;
  /** 中性色阶 */
  neutralScale: ColorScale;
  /** 语义化 Token */
  semantic: SemanticTokens;
}
