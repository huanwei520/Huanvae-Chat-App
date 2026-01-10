/**
 * 设置行组件
 *
 * iOS/macOS 风格的设置项，支持多种右侧控件类型：
 * - toggle: 开关
 * - arrow: 箭头（点击跳转/展开）
 * - value: 显示值
 * - button: 操作按钮
 * - custom: 自定义内容
 *
 * @example
 * ```tsx
 * // 开关类型
 * <SettingsRow
 *   icon={<VolumeIcon />}
 *   title="消息提示音"
 *   subtitle="新消息到达时播放提示音"
 *   type="toggle"
 *   checked={enabled}
 *   onToggle={setEnabled}
 * />
 *
 * // 按钮类型
 * <SettingsRow
 *   title="清空缓存"
 *   type="button"
 *   buttonText="清空"
 *   onButtonClick={handleClear}
 * />
 *
 * // 可展开类型
 * <SettingsRow
 *   title="提示音选择"
 *   type="toggle"
 *   checked={enabled}
 *   onToggle={setEnabled}
 *   expandable
 *   expanded={enabled}
 *   expandContent={<SoundSelector />}
 * />
 * ```
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// ============================================
// 图标组件
// ============================================

const ChevronRightIcon: React.FC = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

// ============================================
// 类型定义
// ============================================

export type SettingsRowType = 'toggle' | 'arrow' | 'value' | 'button' | 'custom';

export interface SettingsRowProps {
  /** 左侧图标 */
  icon?: React.ReactNode;
  /** 主标题 */
  title: string;
  /** 副标题/描述 */
  subtitle?: string;

  /** 右侧控件类型 */
  type: SettingsRowType;

  // toggle 类型
  /** 开关状态 */
  checked?: boolean;
  /** 开关切换回调 */
  onToggle?: (checked: boolean) => void;

  // arrow 类型
  /** 点击回调（arrow 类型） */
  onClick?: () => void;

  // value 类型
  /** 显示的值 */
  value?: string;

  // button 类型
  /** 按钮文本 */
  buttonText?: string;
  /** 按钮变体 */
  buttonVariant?: 'default' | 'danger';
  /** 按钮点击回调 */
  onButtonClick?: () => void;
  /** 按钮禁用状态 */
  buttonDisabled?: boolean;
  /** 按钮加载状态 */
  buttonLoading?: boolean;

  // custom 类型
  /** 自定义右侧内容 */
  rightContent?: React.ReactNode;

  // 可展开内容
  /** 是否可展开 */
  expandable?: boolean;
  /** 是否已展开 */
  expanded?: boolean;
  /** 展开的内容 */
  expandContent?: React.ReactNode;

  /** 危险操作样式 */
  danger?: boolean;

  /** 是否显示分割线（默认 true） */
  showDivider?: boolean;
}

// ============================================
// 组件实现
// ============================================

export const SettingsRow: React.FC<SettingsRowProps> = ({
  icon,
  title,
  subtitle,
  type,
  checked,
  onToggle,
  onClick,
  value,
  buttonText,
  buttonVariant = 'default',
  onButtonClick,
  buttonDisabled,
  buttonLoading,
  rightContent,
  expandable,
  expanded,
  expandContent,
  danger,
  showDivider = true,
}) => {
  // 渲染右侧控件
  const renderRightContent = () => {
    switch (type) {
      case 'toggle':
        return (
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => onToggle?.(e.target.checked)}
            />
            <span className="toggle-slider" />
          </label>
        );

      case 'arrow':
        return (
          <span className="settings-row-arrow">
            {value && <span className="settings-row-value">{value}</span>}
            <ChevronRightIcon />
          </span>
        );

      case 'value':
        return <span className="settings-row-value">{value}</span>;

      case 'button':
        return (
          <button
            className={`settings-row-btn ${buttonVariant === 'danger' ? 'settings-row-btn-danger' : ''}`}
            onClick={onButtonClick}
            disabled={buttonDisabled || buttonLoading}
          >
            {buttonLoading ? '处理中...' : buttonText}
          </button>
        );

      case 'custom':
        return rightContent;

      default:
        return null;
    }
  };

  const rowClassName = [
    'settings-row',
    danger ? 'settings-row-danger' : '',
    showDivider ? '' : 'settings-row-no-divider',
    type === 'arrow' && onClick ? 'settings-row-clickable' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const handleRowClick = () => {
    if (type === 'arrow' && onClick) {
      onClick();
    }
  };

  return (
    <>
      <div
        className={rowClassName}
        onClick={handleRowClick}
        role={type === 'arrow' && onClick ? 'button' : undefined}
        tabIndex={type === 'arrow' && onClick ? 0 : undefined}
        onKeyDown={(e) => {
          if ((type === 'arrow' && onClick) && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onClick();
          }
        }}
      >
        {/* 左侧图标 */}
        {icon && <div className="settings-row-icon">{icon}</div>}

        {/* 标题区域 */}
        <div className="settings-row-content">
          <span className="settings-row-title">{title}</span>
          {subtitle && <span className="settings-row-subtitle">{subtitle}</span>}
        </div>

        {/* 右侧控件 */}
        <div className="settings-row-right">{renderRightContent()}</div>
      </div>

      {/* 可展开内容 */}
      {expandable && (
        <AnimatePresence initial={false}>
          {expanded && expandContent && (
            <motion.div
              className="settings-row-expand"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {expandContent}
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </>
  );
};

export default SettingsRow;
