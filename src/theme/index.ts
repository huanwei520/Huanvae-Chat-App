/**
 * 主题系统模块导出
 *
 * 提供统一的颜色管理功能：
 * - Design Tokens 三层架构（Primitive → Semantic → Component）
 * - 基于 OKLCH 色彩空间的自动色阶生成
 * - 支持默认主题和用户自定义颜色
 * - 独立窗口的主题编辑器
 * - 毛玻璃效果完整可调整（基础颜色、模糊度、饱和度、边框透明度）
 * - 高级透明度层级控制（17个独立透明度级别，分6个功能分组）
 * - 跨窗口主题同步（通过 localStorage storage 事件）
 * - Zustand 状态管理 + localStorage 持久化
 *
 * 使用方式：
 * 1. 在 App 外层包裹 ThemeProvider
 * 2. 使用 openThemeEditorWindow() 打开主题编辑窗口
 * 3. CSS 中使用 var(--primary)、var(--white-alpha-80) 等变量
 *
 * 毛玻璃 CSS 变量：
 * - --glass-base: RGB 格式基础颜色
 * - --white-alpha-97 到 --white-alpha-10: 各透明度级别（用户可独立调整）
 * - --glass-blur: 模糊滤镜值
 * - --glass-saturate: 饱和度滤镜值
 * - --glass-border: 边框颜色
 * - --glass-backdrop: 组合的 backdrop-filter
 * - --blur-sm/md/lg/xl: 相对模糊度变量
 *
 * 透明度层级分组：
 * - 弹窗层 (97%, 95%): 模态框、右键菜单、搜索弹窗
 * - 主背景层 (90%, 85%): 账号选择卡片、高光效果
 * - 卡片层 (80%, 75%): 头像框、消息气泡、文档卡片
 * - 面板层 (70%, 60%): 侧边栏、会话列表、输入区域
 * - 辅助层 (50%, 45%, 40%, 35%): 菜单选项、表单元素
 * - 遮罩层 (30%, 25%, 20%, 15%, 10%): 边框、阴影、遮罩效果
 *
 * @module theme
 */

// Provider 组件
export { ThemeProvider } from './ThemeProvider';

// 主题编辑器组件（内嵌式，保留兼容）
export { ThemeEditor } from './ThemeEditor';

// 主题编辑器独立窗口页面
export { default as ThemeEditorPage } from './ThemeEditorPage';

// 窗口操作 API
export { openThemeEditorWindow } from './api';

// Store 和 Hooks
export {
  useThemeStore,
  useThemeData,
  useThemeConfig,
  useEffectiveMode,
  useCustomColors,
  useGlassConfig,
  useOpacityLevels,
  DEFAULT_GLASS_CONFIG,
  DEFAULT_OPACITY_LEVELS,
} from './store';

// 类型
export type {
  ThemeMode,
  ThemePreset,
  ThemeConfig,
  ThemeData,
  CustomColors,
  ColorScale,
  SemanticTokens,
  GlassConfig,
  OpacityLevels,
} from './types';

// 预设
export { THEME_PRESETS, getPresetConfig, getAllPresets } from './presets';

// 工具函数
export {
  generateColorScale,
  generateNeutralScale,
  withAlpha,
  isDarkColor,
  getContrastColor,
  hexToRgb,
} from './utils';
