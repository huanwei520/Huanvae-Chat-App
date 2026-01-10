/**
 * 设置分组卡片容器
 *
 * iOS/macOS 风格的圆角卡片，包含多个 SettingsRow
 *
 * @example
 * ```tsx
 * <SettingsGroup>
 *   <SettingsRow title="消息提示音" ... />
 *   <SettingsRow title="免打扰" ... />
 * </SettingsGroup>
 * ```
 */

import React from 'react';

export interface SettingsGroupProps {
  /** 内部的 SettingsRow 组件 */
  children: React.ReactNode;
}

export const SettingsGroup: React.FC<SettingsGroupProps> = ({ children }) => {
  return <div className="settings-group">{children}</div>;
};

export default SettingsGroup;
