/**
 * 主题预设切换不得清空用户调过的透明度层级（src/theme/store.ts setPreset）
 *
 * 🔴 回归目标（外部审计 idx=99）：`setPreset` 原本整体替换 `customColors`，
 * 而预设表里的 glass 配置（presets.ts 的 DEFAULT_GLASS）**没有 opacityLevels 字段** ——
 * 用户在「高级透明度设置」里逐条拖出来的 17 个层级值随之消失，且 store 是 persist 的，
 * 落盘即永久丢失：没有确认、没有 undo、没有提示。预设卡片是**配色**选择器，
 * 不是「恢复出厂」——真要清零有独立的 reset()。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useThemeStore, DEFAULT_OPACITY_LEVELS } from '../../src/theme/store';

describe('setPreset 与 opacityLevels', () => {
  beforeEach(() => {
    useThemeStore.getState().reset();
  });

  it('切到 default 预设后，用户调过的层级值原样保留', () => {
    const store = useThemeStore.getState();
    store.setOpacityLevel('level50', 12);
    store.setOpacityLevel('level10', 3);

    // 调完自动切到 custom（既有行为，一并钉住）
    expect(useThemeStore.getState().config.preset).toBe('custom');

    useThemeStore.getState().setPreset('default');

    const after = useThemeStore.getState().config;
    expect(after.preset).toBe('default');
    expect(after.customColors.glass?.opacityLevels).toEqual({
      ...DEFAULT_OPACITY_LEVELS,
      level50: 12,
      level10: 3,
    });
  });

  it('切预设仍然会同步预设的配色（保留的只是 opacityLevels 这一项）', () => {
    const store = useThemeStore.getState();
    store.setPrimaryColor('#ff0000');
    store.setOpacityLevel('level50', 12);

    useThemeStore.getState().setPreset('default');

    const after = useThemeStore.getState().config.customColors;
    expect(after.primary).toBe('#3b82f6');       // 预设色生效
    expect(after.glass?.opacityLevels?.level50).toBe(12); // 用户层级不受牵连
  });

  it('reset() 才是清零入口：层级值回到默认', () => {
    useThemeStore.getState().setOpacityLevel('level50', 12);
    useThemeStore.getState().reset();

    expect(useThemeStore.getState().config.customColors.glass?.opacityLevels)
      .toEqual(DEFAULT_OPACITY_LEVELS);
  });
});
