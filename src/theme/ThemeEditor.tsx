/**
 * 主题编辑器组件
 *
 * 用于设置面板中的主题配置
 * 提供预设选择和自定义颜色功能
 *
 * @module theme/ThemeEditor
 */

import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HexColorPicker } from 'react-colorful';
import { useThemeStore } from './store';
import { getAllPresets } from './presets';
import type { ThemeMode } from './types';
import './ThemeEditor.css';

// ============================================================================
// 图标组件
// ============================================================================

const SunIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="5" />
    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
  </svg>
);

const MoonIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

const SystemIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </svg>
);

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

// ============================================================================
// 子组件
// ============================================================================

/** 模式选择器 */
function ModeSelector() {
  const mode = useThemeStore((s) => s.config.mode);
  const setMode = useThemeStore((s) => s.setMode);

  const modes: Array<{ value: ThemeMode; icon: React.ReactNode; label: string }> = [
    { value: 'light', icon: <SunIcon />, label: '浅色' },
    { value: 'dark', icon: <MoonIcon />, label: '深色' },
    { value: 'system', icon: <SystemIcon />, label: '跟随系统' },
  ];

  return (
    <div className="theme-mode-selector">
      {modes.map((m) => (
        <button
          key={m.value}
          className={`theme-mode-btn ${mode === m.value ? 'active' : ''}`}
          onClick={() => setMode(m.value)}
          title={m.label}
        >
          {m.icon}
          <span>{m.label}</span>
        </button>
      ))}
    </div>
  );
}

/** 预设选择器 */
function PresetSelector() {
  const preset = useThemeStore((s) => s.config.preset);
  const setPreset = useThemeStore((s) => s.setPreset);
  const presets = getAllPresets();

  return (
    <div className="theme-preset-grid">
      {presets.map(({ key, config }) => (
        <button
          key={key}
          className={`theme-preset-card ${preset === key ? 'active' : ''}`}
          onClick={() => setPreset(key)}
        >
          <div className="theme-preset-colors">
            {config.previewColors.map((color, i) => (
              <div
                key={i}
                className="theme-preset-color"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
          <div className="theme-preset-info">
            <span className="theme-preset-name">{config.name}</span>
            {preset === key && (
              <span className="theme-preset-check">
                <CheckIcon />
              </span>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

/** 颜色选择器 */
interface ColorPickerProps {
  label: string;
  color: string;
  onChange: (color: string) => void;
}

function ColorPicker({ label, color, onChange }: ColorPickerProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleColorChange = useCallback((newColor: string) => {
    onChange(newColor);
  }, [onChange]);

  return (
    <div className="theme-color-picker">
      <span className="theme-color-label">{label}</span>
      <button
        className="theme-color-swatch"
        style={{ backgroundColor: color }}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="theme-color-hex">{color.toUpperCase()}</span>
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="theme-color-popover"
            initial={{ opacity: 0, scale: 0.9, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: -10 }}
            transition={{ duration: 0.15 }}
          >
            <HexColorPicker color={color} onChange={handleColorChange} />
            <input
              type="text"
              className="theme-color-input"
              value={color}
              onChange={(e) => {
                const val = e.target.value;
                if (/^#[0-9a-fA-F]{0,6}$/.test(val)) {
                  onChange(val);
                }
              }}
              onBlur={() => {
                // 验证颜色格式
                if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
                  onChange('#3b82f6');
                }
              }}
            />
            <button
              className="theme-color-close"
              onClick={() => setIsOpen(false)}
            >
              完成
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** 自定义颜色区域 */
function CustomColors() {
  const customColors = useThemeStore((s) => s.config.customColors);
  const preset = useThemeStore((s) => s.config.preset);
  const setPrimaryColor = useThemeStore((s) => s.setPrimaryColor);
  const setAccentColor = useThemeStore((s) => s.setAccentColor);

  // 仅在自定义预设时显示
  if (preset !== 'custom') {
    return null;
  }

  return (
    <div className="theme-custom-colors">
      <ColorPicker
        label="主色"
        color={customColors.primary}
        onChange={setPrimaryColor}
      />
      {customColors.accent && (
        <ColorPicker
          label="强调色"
          color={customColors.accent}
          onChange={setAccentColor}
        />
      )}
    </div>
  );
}

// ============================================================================
// 主组件
// ============================================================================

/**
 * 主题编辑器
 *
 * 用于设置面板中展示主题配置选项
 */
export function ThemeEditor(): React.ReactElement {
  const reset = useThemeStore((s) => s.reset);
  const preset = useThemeStore((s) => s.config.preset);

  return (
    <div className="theme-editor">
      {/* 模式选择 */}
      <div className="theme-section">
        <div className="theme-section-title">外观模式</div>
        <ModeSelector />
      </div>

      {/* 预设选择 */}
      <div className="theme-section">
        <div className="theme-section-title">主题配色</div>
        <PresetSelector />
      </div>

      {/* 自定义颜色 */}
      <AnimatePresence>
        {preset === 'custom' && (
          <motion.div
            className="theme-section"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <div className="theme-section-title">自定义颜色</div>
            <CustomColors />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 重置按钮 */}
      <button className="theme-reset-btn" onClick={reset}>
        恢复默认
      </button>
    </div>
  );
}
