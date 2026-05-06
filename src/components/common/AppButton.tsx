/**
 * AppButton — 全应用统一的按钮组件
 *
 * ## 为什么存在
 * 之前应用里有 5 套互不相通的按钮 CSS（见下方迁移映射表），共 42 处内联使用，
 * 视觉风格不一致、设计 token 部分硬编码。本组件以登录页 `.glass-button` 的
 * 玻璃 + 渐变 + 扫光的视觉为基线，抽象成 4 种 variant × 3 种 size 的可配置组件，
 * 既保证视觉一致，又能覆盖所有现有用法。
 *
 * ## API
 * 三轴可组合：variant × size × modifiers
 *
 * ```tsx
 * <AppButton>Click</AppButton>                                  // 默认 primary / md
 * <AppButton variant="danger">Delete</AppButton>
 * <AppButton variant="primary" size="lg" block>登录</AppButton>  // 替代 .glass-button
 * <AppButton variant="ghost" size="sm">+ Register</AppButton>
 * <AppButton variant="secondary">Cancel</AppButton>
 * <AppButton variant="primary" loading>Saving...</AppButton>
 * <AppButton variant="ghost" iconOnly aria-label="delete"><TrashIcon /></AppButton>
 * <AppButton leftIcon={<SaveIcon />}>Save</AppButton>
 * ```
 *
 * ## 变体语义（决定渐变色 + 视觉强度）
 * | variant   | 适用场景                              | 视觉                        |
 * |-----------|---------------------------------------|-----------------------------|
 * | primary   | 主行动 (登录/Connect/Save/Submit)     | 蓝色玻璃渐变 + 扫光         |
 * | danger    | 破坏性操作 (Disconnect/Delete/Reset)  | 红色玻璃渐变 + 扫光         |
 * | secondary | 次操作 (Cancel/取消/关闭)             | 半透明白底 + 边框           |
 * | ghost     | 弱操作 (+ Register / 列表内小动作)    | 完全透明，hover 才上色      |
 *
 * ## 尺寸语义
 * | size | padding   | font-size | radius      | 典型用法                      |
 * |------|-----------|-----------|-------------|-------------------------------|
 * | sm   | 4px 12px  | xs        | radius-sm   | 列表行内动作、标签按钮        |
 * | md   | 10px 18px | sm        | radius-md   | 对话框默认 / 一般操作         |
 * | lg   | 16px 24px | xl        | radius-xl   | 全宽主行动 (登录/注册)        |
 *
 * ## 迁移映射（旧 className → 新组件/类）
 * 历史记录。下方原始映射表是 AppButton 设计阶段的全景规划；实际迁移后部分按钮根据视觉风格
 * 归到了不同的统一组件：
 *
 *   - 玻璃渐变主按钮 → AppButton（本组件）
 *   - 浅色底扁平按钮（settings-row / reset-confirm / lan-btn 系列） → .subtle-btn
 *     （src/styles/components/subtle-button.css）
 *   - hg-btn 系列已由 HuanvaeGuard 模块自管，不收口到 AppButton
 *   - update-toast-btn / lowcode .btn-* 因视觉独立，保留各自原 CSS
 *
 * **当前 AppButton 实际承载：**
 *   .glass-button                  → <AppButton variant="primary" size="lg" block>      [12×, 已迁移]
 *
 * **下方为设计阶段的全景规划（历史记录，部分已转由 subtle-btn 等其他系统承担）：**
 *   .hg-btn-primary                → variant="primary" size="md"             [由 HuanvaeGuard 自管]
 *   .lan-btn / .lan-btn-small      → 改归 .subtle-btn--xs --neutral
 *   .lan-btn-danger                → 改归 .subtle-btn--xs --danger
 *   .lan-request-accept/reject     → 死代码，已删除
 *   .btn-primary (lowcode)         → 保留独立 lowcode 工业风
 *   .update-toast-btn-*            → 保留独立 toast 胶囊风
 *   .settings-row-btn / -danger    → 改归 .subtle-btn--sm --primary/--danger
 *   .reset-confirm-btn-*           → 改归 .subtle-btn--sm --danger/--neutral
 *
 * ## 实现细节
 * 视觉效果由 src/styles/components/app-button.css 提供。CSS 用 3 个局部 RGB 变量
 * 控制渐变色，variant 只覆盖 RGB 变量、不重写整个 background，保持 base 样式单点维护。
 */

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { motion } from 'framer-motion';

export type AppButtonVariant = 'primary' | 'danger' | 'secondary' | 'ghost';
export type AppButtonSize = 'sm' | 'md' | 'lg';

export interface AppButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  /** 视觉变体；默认 primary */
  variant?: AppButtonVariant;
  /** 尺寸；默认 md */
  size?: AppButtonSize;
  /** 是否撑满父容器宽度（替代 .glass-button 的 width:100%）*/
  block?: boolean;
  /** loading 状态：显示 spinner、强制 disabled */
  loading?: boolean;
  /** 图标按钮：方形 padding，aspect-ratio 1:1 */
  iconOnly?: boolean;
  /** 文本左侧的图标节点 */
  leftIcon?: ReactNode;
  /** 文本右侧的图标节点 */
  rightIcon?: ReactNode;
  /** HTML button type；默认 'button'（避免在 form 中误触提交）*/
  type?: 'button' | 'submit' | 'reset';
}

export const AppButton = forwardRef<HTMLButtonElement, AppButtonProps>(function AppButton(
  {
    variant = 'primary',
    size = 'md',
    block = false,
    loading = false,
    iconOnly = false,
    leftIcon,
    rightIcon,
    children,
    className,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  const cls = [
    'app-btn',
    `app-btn--${variant}`,
    `app-btn--${size}`,
    block && 'app-btn--block',
    iconOnly && 'app-btn--icon-only',
    loading && 'app-btn--loading',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      ref={ref}
      type={type}
      className={cls}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <span className="app-btn__spinner" aria-hidden="true" />}
      {!loading && leftIcon && (
        <span className="app-btn__icon app-btn__icon--left" aria-hidden="true">
          {leftIcon}
        </span>
      )}
      {children}
      {!loading && rightIcon && (
        <span className="app-btn__icon app-btn__icon--right" aria-hidden="true">
          {rightIcon}
        </span>
      )}
    </button>
  );
});

/**
 * Framer-motion 包装版 AppButton。
 * 用法：替换原 `<motion.button className="glass-button" variants={...}>` 为
 *      `<MotionAppButton variant="primary" size="lg" block variants={...}>`
 *
 * 实现：framer-motion v12 的 `motion.create()`（v11 起替代被废弃的 `motion()`）。
 * forwardRef 已在 AppButton 中处理，motion.create 直接生效。
 */
export const MotionAppButton = motion.create(AppButton);
