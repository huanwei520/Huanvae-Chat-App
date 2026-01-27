/**
 * 移动端主题设置页面
 *
 * 提供主题配置功能，适配移动端交互：
 * - 选择预设主题（默认/自定义）
 * - 自定义主色和强调色
 * - 毛玻璃效果设置
 * - 高级透明度控制（可折叠）
 *
 * 与桌面端 ThemeEditorPage 功能一致，但使用页面导航而非独立窗口
 *
 * @module pages/mobile/MobileThemePage
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HexColorPicker } from 'react-colorful';
import { useThemeStore, DEFAULT_GLASS_CONFIG, DEFAULT_OPACITY_LEVELS } from '../../theme/store';
import { getAllPresets } from '../../theme/presets';
import type { OpacityLevels } from '../../theme/types';
import '../../styles/mobile/theme-page.css';

// ============================================================================
// 类型定义
// ============================================================================

interface MobileThemePageProps {
  /** 关闭页面回调 */
  onClose: () => void;
}

// ============================================================================
// 图标组件
// ============================================================================

const BackIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

const ResetIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </svg>
);

const ChevronIcon = ({ direction }: { direction: 'up' | 'down' }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    style={{ transform: direction === 'up' ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

// ============================================================================
// 子组件
// ============================================================================

/** 预设选择器 - 移动端优化 */
function PresetSelector() {
  const preset = useThemeStore((s) => s.config.preset);
  const setPreset = useThemeStore((s) => s.setPreset);
  const presets = getAllPresets();

  return (
    <div className="mobile-theme-presets">
      {presets.map(({ key, config }) => (
        <motion.button
          key={key}
          className={`mobile-theme-preset-card ${preset === key ? 'active' : ''}`}
          onClick={() => setPreset(key)}
          whileTap={{ scale: 0.98 }}
        >
          <div className="mobile-theme-preset-colors">
            {config.previewColors.map((color, i) => (
              <div
                key={i}
                className="mobile-theme-preset-color"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
          <div className="mobile-theme-preset-info">
            <span className="mobile-theme-preset-name">{config.name}</span>
            {preset === key && (
              <span className="mobile-theme-preset-check">
                <CheckIcon />
              </span>
            )}
          </div>
          <p className="mobile-theme-preset-desc">{config.description}</p>
        </motion.button>
      ))}
    </div>
  );
}

/** 颜色选择器 - 移动端优化 */
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
    <div className="mobile-theme-color-picker">
      <span className="mobile-theme-color-label">{label}</span>
      <button
        className="mobile-theme-color-swatch"
        style={{ backgroundColor: color }}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="mobile-theme-color-hex">{color.toUpperCase()}</span>
      </button>
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              className="mobile-theme-color-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
            />
            <motion.div
              className="mobile-theme-color-popover"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.15 }}
            >
              <HexColorPicker color={color} onChange={handleColorChange} />
              <input
                type="text"
                className="mobile-theme-color-input"
                value={color}
                onChange={(e) => {
                  const val = e.target.value;
                  if (/^#[0-9a-fA-F]{0,6}$/.test(val)) {
                    onChange(val);
                  }
                }}
                onBlur={() => {
                  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
                    onChange('#3b82f6');
                  }
                }}
              />
              <button
                className="mobile-theme-color-close"
                onClick={() => setIsOpen(false)}
              >
                完成
              </button>
            </motion.div>
          </>
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

  if (preset !== 'custom') {
    return null;
  }

  return (
    <motion.div
      className="mobile-theme-section"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
    >
      <div className="mobile-theme-section-title">自定义颜色</div>
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
    </motion.div>
  );
}

/** 滑块控件 */
interface SliderControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
}

function SliderControl({ label, value, min, max, step = 1, unit = '', onChange }: SliderControlProps) {
  return (
    <div className="mobile-theme-slider">
      <div className="mobile-theme-slider-header">
        <span className="mobile-theme-slider-label">{label}</span>
        <span className="mobile-theme-slider-value">{value}{unit}</span>
      </div>
      <input
        type="range"
        className="mobile-theme-slider-input"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

/** 毛玻璃效果设置 */
function GlassSettings() {
  const preset = useThemeStore((s) => s.config.preset);
  const storeGlassConfig = useThemeStore((s) => s.config.customColors.glass ?? DEFAULT_GLASS_CONFIG);
  const setGlassConfig = useThemeStore((s) => s.setGlassConfig);
  const [showColorPicker, setShowColorPicker] = useState(false);

  const [localGlass, setLocalGlass] = useState(storeGlassConfig);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalGlass(storeGlassConfig);
  }, [storeGlassConfig]);

  const debouncedSetGlassConfig = useCallback((updates: Partial<typeof storeGlassConfig>) => {
    setLocalGlass((prev) => ({ ...prev, ...updates }));

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      setGlassConfig(updates);
    }, 50);
  }, [setGlassConfig]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const handleColorChange = useCallback((color: string) => {
    debouncedSetGlassConfig({ baseColor: color });
  }, [debouncedSetGlassConfig]);

  if (preset !== 'custom') {
    return null;
  }

  return (
    <motion.div
      className="mobile-theme-section"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
    >
      <div className="mobile-theme-section-title">毛玻璃效果</div>

      {/* 基础颜色 */}
      <div className="mobile-theme-color-picker">
        <span className="mobile-theme-color-label">基础颜色</span>
        <button
          className="mobile-theme-color-swatch"
          style={{ backgroundColor: localGlass.baseColor }}
          onClick={() => setShowColorPicker(!showColorPicker)}
        >
          <span className="mobile-theme-color-hex">{localGlass.baseColor.toUpperCase()}</span>
        </button>
        <AnimatePresence>
          {showColorPicker && (
            <>
              <motion.div
                className="mobile-theme-color-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowColorPicker(false)}
              />
              <motion.div
                className="mobile-theme-color-popover"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.15 }}
              >
                <HexColorPicker color={localGlass.baseColor} onChange={handleColorChange} />
                <input
                  type="text"
                  className="mobile-theme-color-input"
                  value={localGlass.baseColor}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (/^#[0-9a-fA-F]{0,6}$/.test(val)) {
                      handleColorChange(val);
                    }
                  }}
                  onBlur={() => {
                    if (!/^#[0-9a-fA-F]{6}$/.test(localGlass.baseColor)) {
                      handleColorChange('#ffffff');
                    }
                  }}
                />
                <button
                  className="mobile-theme-color-close"
                  onClick={() => setShowColorPicker(false)}
                >
                  完成
                </button>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      <SliderControl
        label="模糊度"
        value={localGlass.blur}
        min={4}
        max={40}
        step={2}
        unit="px"
        onChange={(v) => debouncedSetGlassConfig({ blur: v })}
      />

      <SliderControl
        label="饱和度"
        value={localGlass.saturation}
        min={100}
        max={250}
        step={10}
        unit="%"
        onChange={(v) => debouncedSetGlassConfig({ saturation: v })}
      />

      <SliderControl
        label="边框透明度"
        value={Math.round(localGlass.borderOpacity * 100)}
        min={10}
        max={60}
        step={5}
        unit="%"
        onChange={(v) => debouncedSetGlassConfig({ borderOpacity: v / 100 })}
      />
    </motion.div>
  );
}

/**
 * 透明度层级分组配置
 */
const OPACITY_GROUPS = [
  {
    name: '弹窗层',
    description: '模态框、菜单',
    levels: [
      { key: 'level97' as keyof OpacityLevels, label: '97%', hint: '模态框' },
      { key: 'level95' as keyof OpacityLevels, label: '95%', hint: '菜单' },
    ],
  },
  {
    name: '主背景层',
    description: '卡片、高光',
    levels: [
      { key: 'level90' as keyof OpacityLevels, label: '90%', hint: '高光' },
      { key: 'level85' as keyof OpacityLevels, label: '85%', hint: '卡片' },
    ],
  },
  {
    name: '面板层',
    description: '侧边栏、列表',
    levels: [
      { key: 'level70' as keyof OpacityLevels, label: '70%', hint: '侧边栏' },
      { key: 'level60' as keyof OpacityLevels, label: '60%', hint: '列表' },
    ],
  },
];

/** 高级透明度设置 */
function AdvancedOpacitySettings() {
  const [expanded, setExpanded] = useState(false);
  const preset = useThemeStore((s) => s.config.preset);
  const storeOpacityLevels = useThemeStore(
    (s) => s.config.customColors.glass?.opacityLevels ?? DEFAULT_OPACITY_LEVELS,
  );
  const setOpacityLevel = useThemeStore((s) => s.setOpacityLevel);

  const [localLevels, setLocalLevels] = useState(storeOpacityLevels);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalLevels(storeOpacityLevels);
  }, [storeOpacityLevels]);

  const debouncedSetLevel = useCallback((key: keyof OpacityLevels, value: number) => {
    setLocalLevels((prev) => ({ ...prev, [key]: value }));

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      setOpacityLevel(key, value);
    }, 50);
  }, [setOpacityLevel]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  if (preset !== 'custom') {
    return null;
  }

  return (
    <div className="mobile-theme-advanced">
      <button
        className="mobile-theme-advanced-toggle"
        onClick={() => setExpanded(!expanded)}
      >
        <span>高级透明度设置</span>
        <ChevronIcon direction={expanded ? 'up' : 'down'} />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            className="mobile-theme-advanced-content"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            <p className="mobile-theme-advanced-hint">
              控制每个 UI 层级的透明度
            </p>

            {OPACITY_GROUPS.map((group) => (
              <div key={group.name} className="mobile-theme-opacity-group">
                <div className="mobile-theme-opacity-group-header">
                  <span className="mobile-theme-opacity-group-name">{group.name}</span>
                  <span className="mobile-theme-opacity-group-desc">{group.description}</span>
                </div>
                {group.levels.map(({ key, label, hint }) => (
                  <div key={key} className="mobile-theme-opacity-row">
                    <div className="mobile-theme-opacity-info">
                      <span className="mobile-theme-opacity-label">{label}</span>
                      <span className="mobile-theme-opacity-hint">{hint}</span>
                    </div>
                    <div className="mobile-theme-opacity-control">
                      <input
                        type="range"
                        className="mobile-theme-slider-input"
                        min={0}
                        max={100}
                        step={1}
                        value={localLevels[key]}
                        onChange={(e) => debouncedSetLevel(key, Number(e.target.value))}
                      />
                      <span className="mobile-theme-opacity-value">{localLevels[key]}%</span>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// 主组件
// ============================================================================

export function MobileThemePage({ onClose }: MobileThemePageProps): React.ReactElement {
  const reset = useThemeStore((s) => s.reset);
  const preset = useThemeStore((s) => s.config.preset);

  const pageVariants = {
    initial: { x: '100%', opacity: 0 },
    animate: { x: 0, opacity: 1, transition: { type: 'spring' as const, damping: 25, stiffness: 200 } },
    exit: { x: '100%', opacity: 0, transition: { duration: 0.2 } },
  };

  return (
    <motion.div
      className="mobile-theme-page"
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      {/* 顶部导航栏 */}
      <header className="mobile-theme-header">
        <button className="mobile-theme-back" onClick={onClose}>
          <BackIcon />
        </button>
        <h1 className="mobile-theme-title">主题设置</h1>
        <button className="mobile-theme-reset" onClick={reset}>
          <ResetIcon />
        </button>
      </header>

      {/* 内容区 */}
      <main className="mobile-theme-content">
        {/* 预设选择 */}
        <div className="mobile-theme-section">
          <div className="mobile-theme-section-title">主题选择</div>
          <PresetSelector />
        </div>

        {/* 自定义颜色 */}
        <AnimatePresence>
          {preset === 'custom' && <CustomColors />}
        </AnimatePresence>

        {/* 毛玻璃效果 */}
        <AnimatePresence>
          {preset === 'custom' && <GlassSettings />}
        </AnimatePresence>

        {/* 高级透明度设置 */}
        <AnimatePresence>
          {preset === 'custom' && <AdvancedOpacitySettings />}
        </AnimatePresence>
      </main>
    </motion.div>
  );
}
