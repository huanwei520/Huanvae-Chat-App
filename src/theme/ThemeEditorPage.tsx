/**
 * 主题编辑器独立窗口页面
 *
 * 在独立窗口中运行，提供主题配置功能：
 * - 选择预设（默认/自定义）
 * - 自定义主色和强调色
 * - 实时预览效果
 *
 * @module theme/ThemeEditorPage
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HexColorPicker } from 'react-colorful';
import { useThemeStore, DEFAULT_GLASS_CONFIG, DEFAULT_OPACITY_LEVELS } from './store';
import { getAllPresets } from './presets';
import { ThemeProvider } from './ThemeProvider';
import type { OpacityLevels } from './types';
import './ThemeEditorPage.css';

// ============================================================================
// 图标组件
// ============================================================================

const CloseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
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

/** 预设选择器 */
function PresetSelector() {
  const preset = useThemeStore((s) => s.config.preset);
  const setPreset = useThemeStore((s) => s.setPreset);
  const presets = getAllPresets();

  return (
    <div className="theme-page-presets">
      {presets.map(({ key, config }) => (
        <motion.button
          key={key}
          className={`theme-page-preset-card ${preset === key ? 'active' : ''}`}
          onClick={() => setPreset(key)}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <div className="theme-page-preset-colors">
            {config.previewColors.map((color, i) => (
              <div
                key={i}
                className="theme-page-preset-color"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
          <div className="theme-page-preset-info">
            <span className="theme-page-preset-name">{config.name}</span>
            {preset === key && (
              <span className="theme-page-preset-check">
                <CheckIcon />
              </span>
            )}
          </div>
          <p className="theme-page-preset-desc">{config.description}</p>
        </motion.button>
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
    <div className="theme-page-color-picker">
      <span className="theme-page-color-label">{label}</span>
      <button
        className="theme-page-color-swatch"
        style={{ backgroundColor: color }}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="theme-page-color-hex">{color.toUpperCase()}</span>
      </button>
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              className="theme-page-color-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
            />
            <motion.div
              className="theme-page-color-popover"
              initial={{ opacity: 0, scale: 0.9, y: -10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: -10 }}
              transition={{ duration: 0.15 }}
            >
              <HexColorPicker color={color} onChange={handleColorChange} />
              <input
                type="text"
                className="theme-page-color-input"
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
                className="theme-page-color-close"
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

  // 仅在自定义预设时显示
  if (preset !== 'custom') {
    return null;
  }

  return (
    <motion.div
      className="theme-page-custom-colors"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
    >
      <div className="theme-page-section-title">自定义颜色</div>
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
    <div className="theme-page-slider">
      <div className="theme-page-slider-header">
        <span className="theme-page-slider-label">{label}</span>
        <span className="theme-page-slider-value">{value}{unit}</span>
      </div>
      <input
        type="range"
        className="theme-page-slider-input"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

/** 毛玻璃效果设置 - 使用本地状态减少卡顿 */
function GlassSettings() {
  const preset = useThemeStore((s) => s.config.preset);
  const storeGlassConfig = useThemeStore((s) => s.config.customColors.glass ?? DEFAULT_GLASS_CONFIG);
  const setGlassConfig = useThemeStore((s) => s.setGlassConfig);
  const [showColorPicker, setShowColorPicker] = useState(false);

  // 本地状态用于即时 UI 更新
  const [localGlass, setLocalGlass] = useState(storeGlassConfig);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 同步 store 变化到本地状态
  useEffect(() => {
    setLocalGlass(storeGlassConfig);
  }, [storeGlassConfig]);

  // 节流更新到 store（50ms 延迟）
  const debouncedSetGlassConfig = useCallback((updates: Partial<typeof storeGlassConfig>) => {
    // 立即更新本地状态
    setLocalGlass((prev) => ({ ...prev, ...updates }));

    // 节流更新到 store
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      setGlassConfig(updates);
    }, 50);
  }, [setGlassConfig]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // useCallback 必须在条件判断之前
  const handleColorChange = useCallback((color: string) => {
    debouncedSetGlassConfig({ baseColor: color });
  }, [debouncedSetGlassConfig]);

  // 仅在自定义预设时显示
  if (preset !== 'custom') {
    return null;
  }

  return (
    <motion.div
      className="theme-page-glass-settings"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
    >
      <div className="theme-page-section-title">毛玻璃效果</div>

      {/* 基础颜色 */}
      <div className="theme-page-color-picker">
        <span className="theme-page-color-label">基础颜色</span>
        <button
          className="theme-page-color-swatch"
          style={{ backgroundColor: localGlass.baseColor }}
          onClick={() => setShowColorPicker(!showColorPicker)}
        >
          <span className="theme-page-color-hex">{localGlass.baseColor.toUpperCase()}</span>
        </button>
        <AnimatePresence>
          {showColorPicker && (
            <>
              <motion.div
                className="theme-page-color-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowColorPicker(false)}
              />
              <motion.div
                className="theme-page-color-popover"
                initial={{ opacity: 0, scale: 0.9, y: -10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: -10 }}
                transition={{ duration: 0.15 }}
              >
                <HexColorPicker color={localGlass.baseColor} onChange={handleColorChange} />
                <input
                  type="text"
                  className="theme-page-color-input"
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
                  className="theme-page-color-close"
                  onClick={() => setShowColorPicker(false)}
                >
                  完成
                </button>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      {/* 模糊度 */}
      <SliderControl
        label="模糊度"
        value={localGlass.blur}
        min={4}
        max={40}
        step={2}
        unit="px"
        onChange={(v) => debouncedSetGlassConfig({ blur: v })}
      />

      {/* 饱和度 */}
      <SliderControl
        label="饱和度"
        value={localGlass.saturation}
        min={100}
        max={250}
        step={10}
        unit="%"
        onChange={(v) => debouncedSetGlassConfig({ saturation: v })}
      />

      {/* 边框透明度 */}
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
 * 详细说明每个层级对应的 UI 组件
 */
const OPACITY_GROUPS = [
  {
    name: '弹窗层',
    description: '模态框、右键菜单、搜索弹窗',
    levels: [
      { key: 'level97' as keyof OpacityLevels, label: '97%', hint: '模态框主体' },
      { key: 'level95' as keyof OpacityLevels, label: '95%', hint: '菜单背景' },
    ],
  },
  {
    name: '主背景层',
    description: '账号选择卡片、高光效果',
    levels: [
      { key: 'level90' as keyof OpacityLevels, label: '90%', hint: '卡片高光' },
      { key: 'level85' as keyof OpacityLevels, label: '85%', hint: '账号选择器' },
    ],
  },
  {
    name: '卡片层',
    description: '头像框、消息气泡、文档卡片',
    levels: [
      { key: 'level80' as keyof OpacityLevels, label: '80%', hint: '头像、气泡' },
      { key: 'level75' as keyof OpacityLevels, label: '75%', hint: '边框强调' },
    ],
  },
  {
    name: '面板层',
    description: '侧边栏、会话列表、输入区域',
    levels: [
      { key: 'level70' as keyof OpacityLevels, label: '70%', hint: '侧边栏' },
      { key: 'level60' as keyof OpacityLevels, label: '60%', hint: '会话列表' },
    ],
  },
  {
    name: '辅助层',
    description: '菜单选项、表单元素',
    levels: [
      { key: 'level50' as keyof OpacityLevels, label: '50%', hint: '菜单选项' },
      { key: 'level45' as keyof OpacityLevels, label: '45%', hint: '渐变终点' },
      { key: 'level40' as keyof OpacityLevels, label: '40%', hint: '表单元素' },
      { key: 'level35' as keyof OpacityLevels, label: '35%', hint: '次级元素' },
    ],
  },
  {
    name: '遮罩层',
    description: '边框、阴影、遮罩效果',
    levels: [
      { key: 'level30' as keyof OpacityLevels, label: '30%', hint: '轻遮罩' },
      { key: 'level25' as keyof OpacityLevels, label: '25%', hint: '边框' },
      { key: 'level20' as keyof OpacityLevels, label: '20%', hint: '阴影' },
      { key: 'level15' as keyof OpacityLevels, label: '15%', hint: '深遮罩' },
      { key: 'level10' as keyof OpacityLevels, label: '10%', hint: '最透明' },
    ],
  },
];

/**
 * 高级透明度设置组件
 * 可折叠面板，精细控制每个 UI 层级的透明度
 */
function AdvancedOpacitySettings() {
  const [expanded, setExpanded] = useState(false);
  const preset = useThemeStore((s) => s.config.preset);
  const storeOpacityLevels = useThemeStore(
    (s) => s.config.customColors.glass?.opacityLevels ?? DEFAULT_OPACITY_LEVELS
  );
  const setOpacityLevel = useThemeStore((s) => s.setOpacityLevel);

  // 本地状态用于即时 UI 更新
  const [localLevels, setLocalLevels] = useState(storeOpacityLevels);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 同步 store 变化到本地状态
  useEffect(() => {
    setLocalLevels(storeOpacityLevels);
  }, [storeOpacityLevels]);

  // 节流更新单个层级到 store
  const debouncedSetLevel = useCallback((key: keyof OpacityLevels, value: number) => {
    // 立即更新本地状态
    setLocalLevels((prev) => ({ ...prev, [key]: value }));

    // 节流更新到 store
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      setOpacityLevel(key, value);
    }, 50);
  }, [setOpacityLevel]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // 仅在自定义预设时显示
  if (preset !== 'custom') {
    return null;
  }

  // 动画变体配置
  const contentVariants = {
    hidden: {
      opacity: 0,
      height: 0,
      transition: {
        duration: 0.2,
        ease: [0.4, 0, 0.2, 1] as const, // easeInOut
      },
    },
    visible: {
      opacity: 1,
      height: 'auto',
      transition: {
        duration: 0.25,
        ease: [0, 0, 0.2, 1] as const, // easeOut
      },
    },
  };

  return (
    <div className="theme-page-advanced-opacity">
      <button
        className="theme-page-advanced-toggle"
        onClick={() => setExpanded(!expanded)}
      >
        <span>高级透明度设置</span>
        <ChevronIcon direction={expanded ? 'up' : 'down'} />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            className="theme-page-advanced-content"
            variants={contentVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
          >
            <p className="theme-page-advanced-hint">
              精细控制每个 UI 层级的透明度。100% = 完全不透明，0% = 完全透明
            </p>

            {OPACITY_GROUPS.map((group, groupIndex) => (
              <motion.div
                key={group.name}
                className="theme-page-opacity-group"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: groupIndex * 0.03, duration: 0.2 }}
              >
                <div className="theme-page-opacity-group-header">
                  <span className="theme-page-opacity-group-name">{group.name}</span>
                  <span className="theme-page-opacity-group-desc">{group.description}</span>
                </div>
                <div className="theme-page-opacity-group-sliders">
                  {group.levels.map(({ key, label, hint }) => (
                    <div key={key} className="theme-page-opacity-slider-row">
                      <div className="theme-page-opacity-slider-info">
                        <span className="theme-page-opacity-slider-label">{label}</span>
                        <span className="theme-page-opacity-slider-hint">{hint}</span>
                      </div>
                      <div className="theme-page-opacity-slider-control">
                        <input
                          type="range"
                          className="theme-page-slider-input"
                          min={0}
                          max={100}
                          step={1}
                          value={localLevels[key]}
                          onChange={(e) => debouncedSetLevel(key, Number(e.target.value))}
                        />
                        <span className="theme-page-opacity-slider-value">{localLevels[key]}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// 主页面组件
// ============================================================================

function ThemeEditorContent() {
  const reset = useThemeStore((s) => s.reset);
  const preset = useThemeStore((s) => s.config.preset);

  // ESC 关闭窗口
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        window.close();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="theme-page">
      {/* 标题栏 */}
      <header className="theme-page-header" data-tauri-drag-region>
        <h1 className="theme-page-title">主题设置</h1>
        <motion.button
          className="theme-page-close-btn"
          onClick={() => window.close()}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
        >
          <CloseIcon />
        </motion.button>
      </header>

      {/* 内容区 */}
      <main className="theme-page-content">
        {/* 预设选择 */}
        <div className="theme-page-section">
          <div className="theme-page-section-title">主题选择</div>
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

      {/* 底部操作 */}
      <footer className="theme-page-footer">
        <motion.button
          className="theme-page-reset-btn"
          onClick={reset}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <ResetIcon />
          <span>恢复默认</span>
        </motion.button>
      </footer>
    </div>
  );
}

/**
 * 主题编辑器页面
 *
 * 在独立窗口中运行，需要自己的 ThemeProvider
 */
export default function ThemeEditorPage(): React.ReactElement {
  return (
    <ThemeProvider>
      <ThemeEditorContent />
    </ThemeProvider>
  );
}
