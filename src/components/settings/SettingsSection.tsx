/**
 * 设置分组组件
 *
 * iOS/macOS 风格的设置分组，包含标题和内容区域
 *
 * @example
 * ```tsx
 * <SettingsSection title="通知与提醒">
 *   <SettingsGroup>
 *     <SettingsRow ... />
 *   </SettingsGroup>
 * </SettingsSection>
 * ```
 */

import React from 'react';

export interface SettingsSectionProps {
  /** 分组标题 */
  title: string;
  /** 分组内容 */
  children: React.ReactNode;
}

export const SettingsSection: React.FC<SettingsSectionProps> = ({
  title,
  children,
}) => {
  return (
    <div className="settings-section">
      <h3 className="settings-section-title">{title}</h3>
      <div className="settings-section-content">{children}</div>
    </div>
  );
};

export default SettingsSection;
