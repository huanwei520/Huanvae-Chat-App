/**
 * Default avatar placeholder pure-function tests: initial glyph + emoji detection +
 * fixed styling constants (no per-name color).
 */

import { describe, it, expect } from 'vitest';
import {
  avatarInitial,
  isEmojiChar,
  AVATAR_PLACEHOLDER_BG,
  AVATAR_PLACEHOLDER_BORDER,
  AVATAR_INITIAL_GRADIENT,
} from '../../src/utils/avatarColor';

describe('avatarInitial', () => {
  it('takes the first char and upper-cases it', () => {
    expect(avatarInitial('alice')).toBe('A');
    expect(avatarInitial('Bob')).toBe('B');
  });

  it('CJK keeps the first char (no case change)', () => {
    expect(avatarInitial('张三')).toBe('张');
  });

  it('emoji name keeps the emoji code point as the initial', () => {
    expect(avatarInitial('🐱喵喵')).toBe('🐱');
  });

  it('trims leading whitespace before taking the first char', () => {
    expect(avatarInitial('  kevin')).toBe('K');
  });

  it('empty / nullish returns ?', () => {
    expect(avatarInitial('')).toBe('?');
    expect(avatarInitial('   ')).toBe('?');
    expect(avatarInitial(null)).toBe('?');
    expect(avatarInitial(undefined)).toBe('?');
  });
});

describe('isEmojiChar', () => {
  it('detects pictographic emoji', () => {
    expect(isEmojiChar('🐱')).toBe(true);
    expect(isEmojiChar('🎉')).toBe(true);
  });

  it('CJK / letters / digits / ? are not emoji (they get the gradient)', () => {
    expect(isEmojiChar('张')).toBe(false);
    expect(isEmojiChar('A')).toBe(false);
    expect(isEmojiChar('1')).toBe(false);
    expect(isEmojiChar('?')).toBe(false);
  });

  it('composes with avatarInitial: emoji name -> emoji initial -> detected', () => {
    expect(isEmojiChar(avatarInitial('🐱喵喵'))).toBe(true);
    expect(isEmojiChar(avatarInitial('研究员A'))).toBe(false);
  });
});

describe('placeholder styling constants (deterministic, not per-name; token-backed)', () => {
  it('white ground references the --avatar-placeholder-bg design token', () => {
    expect(AVATAR_PLACEHOLDER_BG).toBe('var(--avatar-placeholder-bg)');
  });

  it('faint ring references the --avatar-placeholder-ring design token', () => {
    expect(AVATAR_PLACEHOLDER_BORDER).toBe('1px solid var(--avatar-placeholder-ring)');
  });

  it('initial gradient is a fixed blue via design tokens (no hard-coded hex in the gradient string)', () => {
    expect(AVATAR_INITIAL_GRADIENT).toMatch(/^linear-gradient\(135deg,/);
    // both gradient stops come from the fixed-blue tokens; the actual hex lives in the
    // CSS token values (variables.css), not in this JS string
    expect(AVATAR_INITIAL_GRADIENT).toContain('var(--avatar-placeholder-initial-start)');
    expect(AVATAR_INITIAL_GRADIENT).toContain('var(--avatar-placeholder-initial-end)');
    // regression guard: no hard-coded hex leaks into the gradient string itself
    expect(AVATAR_INITIAL_GRADIENT).not.toContain('#4f46e5');
    expect(AVATAR_INITIAL_GRADIENT).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});
