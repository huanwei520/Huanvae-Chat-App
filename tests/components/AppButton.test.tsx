/**
 * AppButton + MotionAppButton 组件契约测试
 *
 * 测试范围：
 * 1. AppButton 4 variant × 3 size + block/iconOnly/loading/disabled 渲染
 * 2. leftIcon / rightIcon 槽位
 * 3. click handler 触发
 * 4. type 默认 'button'（防止 form 内误提交）
 * 5. forwardRef 转发到 button DOM
 * 6. MotionAppButton 接收 framer-motion props 后仍渲染按钮 + 透传 AppButton props
 * 7. subtle-btn className 静态渲染（验证 BEM 命名约定）
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { createRef } from 'react';
import { AppButton, MotionAppButton } from '../../src/components/common/AppButton';

describe('AppButton', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders as <button> with default variant=primary, size=md', () => {
    render(<AppButton>Click</AppButton>);
    const btn = screen.getByRole('button', { name: 'Click' });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn).toHaveClass('app-btn', 'app-btn--primary', 'app-btn--md');
  });

  it('applies all 4 variants', () => {
    const { rerender } = render(<AppButton variant="primary">P</AppButton>);
    expect(screen.getByRole('button')).toHaveClass('app-btn--primary');
    rerender(<AppButton variant="danger">D</AppButton>);
    expect(screen.getByRole('button')).toHaveClass('app-btn--danger');
    rerender(<AppButton variant="secondary">S</AppButton>);
    expect(screen.getByRole('button')).toHaveClass('app-btn--secondary');
    rerender(<AppButton variant="ghost">G</AppButton>);
    expect(screen.getByRole('button')).toHaveClass('app-btn--ghost');
  });

  it('applies all 3 sizes', () => {
    const { rerender } = render(<AppButton size="sm">x</AppButton>);
    expect(screen.getByRole('button')).toHaveClass('app-btn--sm');
    rerender(<AppButton size="md">x</AppButton>);
    expect(screen.getByRole('button')).toHaveClass('app-btn--md');
    rerender(<AppButton size="lg">x</AppButton>);
    expect(screen.getByRole('button')).toHaveClass('app-btn--lg');
  });

  it('block adds app-btn--block', () => {
    render(<AppButton block>x</AppButton>);
    expect(screen.getByRole('button')).toHaveClass('app-btn--block');
  });

  it('iconOnly adds app-btn--icon-only', () => {
    render(<AppButton iconOnly aria-label="del">i</AppButton>);
    expect(screen.getByRole('button')).toHaveClass('app-btn--icon-only');
  });

  it('loading shows spinner, sets aria-busy and disables click', () => {
    const onClick = vi.fn();
    render(<AppButton loading onClick={onClick}>Save</AppButton>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveClass('app-btn--loading');
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toBeDisabled();
    expect(btn.querySelector('.app-btn__spinner')).not.toBeNull();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('disabled prop disables button and prevents click', () => {
    const onClick = vi.fn();
    render(<AppButton disabled onClick={onClick}>x</AppButton>);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('default type is "button" (avoids accidental form submit)', () => {
    render(<AppButton>x</AppButton>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('honors explicit type="submit"', () => {
    render(<AppButton type="submit">Go</AppButton>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
  });

  it('renders leftIcon + rightIcon when not loading', () => {
    render(
      <AppButton leftIcon={<span data-testid="left">L</span>} rightIcon={<span data-testid="right">R</span>}>
        x
      </AppButton>,
    );
    expect(screen.getByTestId('left').parentElement).toHaveClass('app-btn__icon--left');
    expect(screen.getByTestId('right').parentElement).toHaveClass('app-btn__icon--right');
  });

  it('hides leftIcon/rightIcon while loading', () => {
    render(
      <AppButton loading leftIcon={<span data-testid="left">L</span>}>x</AppButton>,
    );
    expect(screen.queryByTestId('left')).toBeNull();
  });

  it('triggers onClick when not loading or disabled', () => {
    const onClick = vi.fn();
    render(<AppButton onClick={onClick}>Hit</AppButton>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('forwards ref to underlying button element', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<AppButton ref={ref}>x</AppButton>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    expect(ref.current!.textContent).toBe('x');
  });

  it('appends external className without overwriting base classes', () => {
    render(<AppButton className="extra">x</AppButton>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveClass('app-btn');
    expect(btn).toHaveClass('app-btn--primary');
    expect(btn).toHaveClass('extra');
  });
});

describe('MotionAppButton', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders as <button> with AppButton classes when given AppButton props', () => {
    render(
      <MotionAppButton variant="danger" size="lg" block>
        Delete
      </MotionAppButton>,
    );
    const btn = screen.getByRole('button', { name: 'Delete' });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn).toHaveClass('app-btn--danger', 'app-btn--lg', 'app-btn--block');
  });

  it('triggers onClick (motion does not block click handler)', () => {
    const onClick = vi.fn();
    render(
      <MotionAppButton variant="primary" size="lg" block onClick={onClick}>
        Login
      </MotionAppButton>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not throw when given framer-motion props (variants/whileHover/whileTap)', () => {
    render(
      <MotionAppButton
        variant="primary"
        size="lg"
        block
        variants={{ hover: { scale: 1.02 }, tap: { scale: 0.98 } }}
        whileHover="hover"
        whileTap="tap"
      >
        Submit
      </MotionAppButton>,
    );
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
  });

  it('respects disabled prop and skips click', () => {
    const onClick = vi.fn();
    render(
      <MotionAppButton variant="primary" size="lg" block disabled onClick={onClick}>
        x
      </MotionAppButton>,
    );
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders rightIcon (used by Register.tsx ArrowRightIcon)', () => {
    render(
      <MotionAppButton variant="primary" size="lg" block rightIcon={<span data-testid="arrow">→</span>}>
        Next
      </MotionAppButton>,
    );
    expect(screen.getByTestId('arrow').parentElement).toHaveClass('app-btn__icon--right');
  });
});

/**
 * SettingsRow 真渲染：覆盖 type="button" 下 `buttonVariant === 'danger'` 三元拼接的两个分支。
 * 这是 subtle-btn className 唯一会被运行时拼错的地方（其他用法都是字面量字符串），
 * 真实的回归保护应该在这里。
 */
import { SettingsRow } from '../../src/components/settings/SettingsRow';

describe('SettingsRow button — subtle-btn variant 拼接（防回归）', () => {
  beforeEach(() => {
    cleanup();
  });

  it('default buttonVariant renders subtle-btn--primary', () => {
    render(
      <SettingsRow
        type="button"
        title="Edit"
        buttonText="Edit"
        onButtonClick={() => {}}
      />,
    );
    const btn = screen.getByRole('button', { name: 'Edit' });
    expect(btn).toHaveClass('subtle-btn', 'subtle-btn--sm', 'subtle-btn--primary');
    expect(btn).not.toHaveClass('subtle-btn--danger');
  });

  it('buttonVariant="danger" renders subtle-btn--danger (not --primary)', () => {
    render(
      <SettingsRow
        type="button"
        title="Delete"
        buttonText="Delete"
        buttonVariant="danger"
        onButtonClick={() => {}}
      />,
    );
    const btn = screen.getByRole('button', { name: 'Delete' });
    expect(btn).toHaveClass('subtle-btn', 'subtle-btn--sm', 'subtle-btn--danger');
    expect(btn).not.toHaveClass('subtle-btn--primary');
  });

  it('triggers onButtonClick on click', () => {
    const onButtonClick = vi.fn();
    render(
      <SettingsRow
        type="button"
        title="Run"
        buttonText="Run"
        onButtonClick={onButtonClick}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(onButtonClick).toHaveBeenCalledTimes(1);
  });

  it('shows loading text + disables when buttonLoading=true', () => {
    const onButtonClick = vi.fn();
    render(
      <SettingsRow
        type="button"
        title="Run"
        buttonText="Run"
        buttonLoading
        onButtonClick={onButtonClick}
      />,
    );
    const btn = screen.getByRole('button', { name: '处理中...' });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onButtonClick).not.toHaveBeenCalled();
  });
});
