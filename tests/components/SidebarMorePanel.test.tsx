/**
 * SidebarMorePanel 测试（dnd-kit 双区拖放的 "more" 区，受控组件）
 *
 * 覆盖：
 * 1. moreKeys 全 8 项按传入顺序渲染
 * 2. moreKeys 乱序子集 → 只渲染子集且顺序跟随
 * 3. 点击某项 → onItemClick 收到该项的 action（精确引用）
 * 4. 标题「更多功能」与提示「拖到侧边栏可钉住」
 * 5. moreKeys=[] 空态文案 + 不渲染任何功能按钮
 *
 * 分层决策：dnd-kit 拖拽手势（PointerSensor 需要真实 pointer 事件序列：
 * pointerdown → 超过 6px distance 的 pointermove → pointerup）jsdom 无法模拟，
 * 不写假拖拽测试；拖放编排/持久化由 tests/unit/sidebarLayout.test.ts 纯函数矩阵
 * + 真机自测覆盖。本文件只测受控渲染契约与点击回调。
 *
 * 渲染注意：
 * - 组件内部用 useDroppable/SortableContext/useSortable，必须包在 <DndContext> 里。
 * - useSortable 的 attributes 会给每行 wrapper div 加 role="button"，因此
 *   getAllByRole('button') 会同时命中 wrapper 与内层真 <button class="more-panel-item">，
 *   断言顺序时过滤到 .more-panel-item。
 * - mock items 的 icon 传空 <span>，按钮 textContent 即 label 本身（无 icon 文本拼接）。
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { SidebarMorePanel } from '../../src/components/sidebar/SidebarMorePanel';
import {
  SIDEBAR_ITEM_KEYS,
  type SidebarItemKey,
  type SidebarItemConfig,
} from '../../src/components/sidebar/sidebarLayout';

const LABELS: Record<SidebarItemKey, string> = {
  files: '我的文件',
  lan: '局域网互传',
  meeting: '视频会议',
  miniapps: '小程序',
  bots: '机器人',
  lowcode: '低代码编辑器',
  guard: 'VPN 组网',
  stocks: '股票研究',
};

/** 构建 8 项 mock items + 每项独立的 onClick spy（icon 为空 span，不参与 textContent） */
function buildItems() {
  const actions = {} as Record<SidebarItemKey, ReturnType<typeof vi.fn<() => void>>>;
  const items = {} as Record<SidebarItemKey, SidebarItemConfig>;
  for (const key of SIDEBAR_ITEM_KEYS) {
    actions[key] = vi.fn<() => void>();
    items[key] = {
      icon: <span data-testid={`icon-${key}`} />,
      label: LABELS[key],
      onClick: actions[key],
    };
  }
  return { items, actions };
}

function renderPanel(moreKeys: SidebarItemKey[], onItemClick = vi.fn()) {
  const { items, actions } = buildItems();
  const utils = render(
    <DndContext>
      <SidebarMorePanel
        items={items}
        moreKeys={moreKeys}
        position={{ top: 100, left: 80 }}
        onItemClick={onItemClick}
      />
    </DndContext>,
  );
  return { actions, onItemClick, ...utils };
}

/** 面板内功能按钮的 label 顺序（过滤掉 useSortable 给 wrapper div 加的 role="button"） */
function itemLabels(): (string | null)[] {
  return screen
    .queryAllByRole('button')
    .filter((el) => el.classList.contains('more-panel-item'))
    .map((el) => el.textContent);
}

describe('SidebarMorePanel', () => {
  it('moreKeys 全 8 项按传入顺序渲染', () => {
    renderPanel([...SIDEBAR_ITEM_KEYS]);
    expect(itemLabels()).toEqual([
      '我的文件', '局域网互传', '视频会议', '小程序', '机器人', '低代码编辑器', 'VPN 组网', '股票研究',
    ]);
  });

  it('moreKeys 乱序子集时只渲染子集且顺序跟随', () => {
    renderPanel(['stocks', 'files', 'lan']);
    expect(itemLabels()).toEqual(['股票研究', '我的文件', '局域网互传']);
  });

  it('点击某项时 onItemClick 收到该项对应的 action 引用', () => {
    const { actions, onItemClick } = renderPanel([...SIDEBAR_ITEM_KEYS]);

    fireEvent.click(screen.getByText('股票研究'));
    expect(onItemClick).toHaveBeenCalledTimes(1);
    expect(onItemClick).toHaveBeenCalledWith(actions.stocks);

    fireEvent.click(screen.getByText('我的文件'));
    expect(onItemClick).toHaveBeenCalledTimes(2);
    expect(onItemClick).toHaveBeenLastCalledWith(actions.files);
  });

  it('渲染标题「更多功能」与提示「拖到侧边栏可钉住」', () => {
    renderPanel([...SIDEBAR_ITEM_KEYS]);
    expect(screen.getByText('更多功能')).toBeInTheDocument();
    expect(screen.getByText('拖到侧边栏可钉住')).toBeInTheDocument();
  });

  it('moreKeys 为空时渲染空态文案且不渲染任何功能按钮', () => {
    renderPanel([]);
    expect(screen.getByText('已全部钉到侧边栏')).toBeInTheDocument();
    expect(screen.getByText('从侧边栏拖回此处可收纳')).toBeInTheDocument();
    expect(itemLabels()).toEqual([]);
  });
});
