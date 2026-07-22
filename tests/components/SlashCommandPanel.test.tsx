/**
 * SlashCommandPanel 组件测试（纯展示，无 store/session 依赖）
 *
 * 覆盖：
 * - open + 命令列表渲染，activeIndex 高亮命中正确项
 * - mouseDown 命中项 → onSelect 回传对应命令对象
 * - open=false / 空命令 → 不渲染任何内容（AnimatePresence 卸载 + length 守卫）
 *
 * 命令名一律用中性 fixture（/status /report），不含任何真实内部指令名。
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SlashCommandPanel } from '../../src/chat/shared/SlashCommandPanel';
import type { BotCommand } from '../../src/api/bots';

const COMMANDS: BotCommand[] = [
  { command: 'status', description: '状态' },
  { command: 'report', description: '报告' },
];

const POSITION = { left: 100, bottom: 200 };

describe('SlashCommandPanel', () => {
  it('open + 命令列表：全部命令可见，activeIndex 命中项加 --active，其它项不加', () => {
    render(
      <SlashCommandPanel
        open
        commands={COMMANDS}
        activeIndex={1}
        position={POSITION}
        onSelect={vi.fn()}
        onHoverIndex={vi.fn()}
      />,
    );

    expect(screen.getByText('/status')).toBeInTheDocument();
    expect(screen.getByText('/report')).toBeInTheDocument();

    const statusItem = screen.getByText('/status').closest('button');
    const reportItem = screen.getByText('/report').closest('button');
    expect(reportItem).toHaveClass('slash-command-item--active');
    expect(statusItem).toHaveClass('slash-command-item');
    expect(statusItem).not.toHaveClass('slash-command-item--active');
  });

  it('mouseDown 某项 → onSelect 回传该命令对象', () => {
    const onSelect = vi.fn();
    render(
      <SlashCommandPanel
        open
        commands={COMMANDS}
        activeIndex={0}
        position={POSITION}
        onSelect={onSelect}
        onHoverIndex={vi.fn()}
      />,
    );

    const statusItem = screen.getByText('/status').closest('button')!;
    fireEvent.mouseDown(statusItem);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith({ command: 'status', description: '状态' });
  });

  it('open=false → 不渲染（AnimatePresence 卸载）', () => {
    render(
      <SlashCommandPanel
        open={false}
        commands={COMMANDS}
        activeIndex={0}
        position={POSITION}
        onSelect={vi.fn()}
        onHoverIndex={vi.fn()}
      />,
    );

    expect(screen.queryByText('/status')).toBeNull();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('open 但命令为空 → 不渲染（length 守卫）', () => {
    render(
      <SlashCommandPanel
        open
        commands={[]}
        activeIndex={0}
        position={POSITION}
        onSelect={vi.fn()}
        onHoverIndex={vi.fn()}
      />,
    );

    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
