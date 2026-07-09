/**
 * Unified default avatar placeholder component tests.
 *
 * New spec: uniform white ground + faint ring; the initial glyph is filled with a
 * blue -> light-blue gradient (background-clip:text). Emoji initials skip the gradient
 * clipping and render in their own colors. No per-name color.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AvatarPlaceholder } from '../../src/components/common/AvatarPlaceholder';

describe('AvatarPlaceholder', () => {
  it('renders the upper-cased first character', () => {
    cleanup();
    render(<AvatarPlaceholder name="alice" />);
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('renders ? for an empty name', () => {
    cleanup();
    render(<AvatarPlaceholder name="" />);
    expect(screen.getByText('?')).toBeInTheDocument();
  });

  it('container references the placeholder bg + ring design tokens + passed fontSize', () => {
    cleanup();
    const { container } = render(<AvatarPlaceholder name="bob" fontSize={28} />);
    const el = container.querySelector('.avatar-placeholder-unified') as HTMLElement;
    expect(el).toBeTruthy();
    expect(el.style.backgroundColor).toBe('var(--avatar-placeholder-bg)');
    expect(el.style.border).toBe('1px solid var(--avatar-placeholder-ring)');
    expect(el.style.fontSize).toBe('28px');
    // container ground is a solid token color, never a per-name gradient
    expect(el.style.backgroundImage).toBe('');
  });

  it('text initial glyph gets the fixed blue gradient (token-backed) clipped to text', () => {
    cleanup();
    const { container } = render(<AvatarPlaceholder name="研究员A" />);
    const glyph = container.querySelector('.avatar-placeholder-unified > span') as HTMLElement;
    expect(glyph).toBeTruthy();
    expect(glyph.textContent).toBe('研');
    expect(glyph.style.backgroundImage).toContain('linear-gradient');
    // gradient stops resolve from the fixed-blue tokens (var refs; CSS resolves them to hex)
    expect(glyph.style.backgroundImage).toContain('var(--avatar-placeholder-initial-start)');
    expect(glyph.style.backgroundImage).toContain('var(--avatar-placeholder-initial-end)');
    expect(glyph.style.color).toBe('transparent');
  });

  it('emoji initial glyph is NOT gradient-clipped (renders in its own colors)', () => {
    cleanup();
    const { container } = render(<AvatarPlaceholder name="🐱喵喵" />);
    const glyph = container.querySelector('.avatar-placeholder-unified > span') as HTMLElement;
    expect(glyph).toBeTruthy();
    expect(glyph.textContent).toBe('🐱');
    // emoji path applies no background clipping
    expect(glyph.style.backgroundImage).toBe('');
    expect(glyph.style.color).toBe('');
  });

  // a11y 保持性契约（配合「可点击头像容器 a11y 修复」）：
  // 占位组件本身只画装饰性回退图形，绝不承担交互语义。可点击性由外层容器
  // （role=button + tabIndex + aria-label）提供，占位容器必须保持 aria-hidden="true"
  // 以免屏幕阅读器把首字母图形当成可读内容 / 重复朗读外层容器的 aria-label。
  it('container stays aria-hidden="true" (decorative fallback, never announced)', () => {
    cleanup();
    const { container } = render(<AvatarPlaceholder name="bob" />);
    const el = container.querySelector('.avatar-placeholder-unified') as HTMLElement;
    expect(el).toBeTruthy();
    expect(el).toHaveAttribute('aria-hidden', 'true');
    // 装饰性回退不应自带任何交互语义属性
    expect(el).not.toHaveAttribute('role');
    expect(el).not.toHaveAttribute('tabindex');
    expect(el).not.toHaveAttribute('aria-label');
  });
});
