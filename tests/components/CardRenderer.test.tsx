/**
 * CardRenderer 测试(可交互卡片渲染器:18 类白名单 + 双受众 + live patch)
 *
 * mock 边界(vi.hoisted 稳定单例):
 * - SessionContext.useApi → 空 api 对象(仅作透传断言锚点)
 * - api/messages.interactWithCard → 唯一交互出口,断言精确入参
 * - klinecharts init/dispose → 外部图表依赖;applyNewData/setStyles 断言 spec 正确翻译
 * cardLiveStore 用真实 store(beforeEach clear),走完整 live 派生链路。
 *
 * 覆盖:非法 JSON 占位 / action-buttons 交互回传 / button 二次确认 / log-tail 截断与省略 /
 * chart 数据过滤与形态 / sandbox 默认关闭占位(不渲 url)/ product 受众隐藏交互节点 /
 * live patch 单调收敛。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';

// 稳定单例 api 对象(真实 Context 的 value 引用稳定,mock 必须对齐)
const apiMock = vi.hoisted(() => ({}));
vi.mock('../../src/contexts/SessionContext', () => ({
  useApi: () => apiMock,
}));

const interactMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/api/messages', () => ({
  interactWithCard: interactMock,
}));

const klinechartsMock = vi.hoisted(() => {
  const applyNewData = vi.fn();
  const setStyles = vi.fn();
  const init = vi.fn(() => ({ applyNewData, setStyles }));
  const dispose = vi.fn();
  return { init, dispose, applyNewData, setStyles };
});
vi.mock('klinecharts', () => ({
  init: klinechartsMock.init,
  dispose: klinechartsMock.dispose,
}));

import { CardRenderer } from '../../src/chat/shared/CardRenderer';
import { useCardLiveStore } from '../../src/stores/cardLiveStore';

/** 构造卡片 schema JSON 串 */
function cardJson(nodes: unknown[]): string {
  return JSON.stringify({ version: 1, nodes });
}

const CANDLE_1 = { timestamp: 1700000000000, open: 10, high: 12, low: 9, close: 11 };
const CANDLE_2 = { timestamp: 1700000060000, open: 11, high: 13, low: 10.5, close: 12.5 };

describe('CardRenderer', () => {
  beforeEach(() => {
    cleanup();
    useCardLiveStore.getState().clear();
    interactMock.mockReset();
    interactMock.mockResolvedValue({ delivered: true });
    Object.values(klinechartsMock).forEach((m) => m.mockClear());
  });

  it('非法 JSON → 惰性占位 [无法解析的卡片]', () => {
    render(<CardRenderer messageContent="{not-json" messageUuid="u-bad" sourceType="friend" />);
    expect(screen.getByText('[无法解析的卡片]')).toBeInTheDocument();
  });

  it('action-buttons:渲 2 按钮,点击后 interactWithCard 精确入参(message_uuid/action_id/value 透传/nonce)', async () => {
    const content = cardJson([
      {
        type: 'action-buttons',
        buttons: [
          { action_id: 'approve', text: '批准', value: { ok: true } },
          { action_id: 'reject', text: '拒绝' },
        ],
      },
    ]);
    render(<CardRenderer messageContent={content} messageUuid="uuid-1" sourceType="friend" />);

    // 自带 value 的按钮:value 透传进 payload
    fireEvent.click(screen.getByRole('button', { name: '批准' }));
    await waitFor(() => {
      expect(interactMock).toHaveBeenCalledTimes(1);
    });
    expect(interactMock).toHaveBeenLastCalledWith(apiMock, expect.objectContaining({
      message_uuid: 'uuid-1',
      action_id: 'approve',
      value: { value: { ok: true } },
      nonce: expect.any(String),
    }));

    // 无 value 的按钮:value 发 undefined(不携带空壳)
    fireEvent.click(screen.getByRole('button', { name: '拒绝' }));
    await waitFor(() => {
      expect(interactMock).toHaveBeenCalledTimes(2);
    });
    expect(interactMock).toHaveBeenLastCalledWith(apiMock, expect.objectContaining({
      message_uuid: 'uuid-1',
      action_id: 'reject',
      value: undefined,
      nonce: expect.any(String),
    }));
  });

  it('button confirm:true → 第一次点击不调 interact,确认态再点才调用 1 次', async () => {
    const content = cardJson([
      { type: 'button', action_id: 'del', text: '删除', style: 'danger', confirm: true },
    ]);
    render(<CardRenderer messageContent={content} messageUuid="uuid-2" sourceType="friend" />);

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(interactMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '确认删除?' }));
    await waitFor(() => {
      expect(interactMock).toHaveBeenCalledTimes(1);
    });
    expect(interactMock).toHaveBeenLastCalledWith(apiMock, expect.objectContaining({
      message_uuid: 'uuid-2',
      action_id: 'del',
      nonce: expect.any(String),
    }));
  });

  it('log-tail:各行渲在 .card-log-tail-body 内;truncated:true → 省略提示行;非 string 行被过滤', () => {
    const content = cardJson([
      { type: 'log-tail', title: '部署日志', lines: ['line-alpha', 123, 'line-beta'], truncated: true },
    ]);
    const { container } = render(
      <CardRenderer messageContent={content} messageUuid="uuid-3" sourceType="friend" />,
    );

    expect(screen.getByText('部署日志')).toBeInTheDocument();
    const body = container.querySelector('.card-log-tail-body');
    expect(body).not.toBeNull();
    expect(body?.textContent).toContain('…(更早日志已省略)');
    expect(body?.textContent).toContain('line-alpha');
    expect(body?.textContent).toContain('line-beta');
    // 非 string 行(123)被过滤,不出现在日志体
    expect(body?.textContent).not.toContain('123');
  });

  it('log-tail:超过 200 行 → 组件侧截断提示 + 仅末尾 200 行(最早行不出现)', () => {
    const lines = Array.from({ length: 205 }, (_, i) => `row-${i}`);
    const content = cardJson([{ type: 'log-tail', lines }]);
    const { container } = render(
      <CardRenderer messageContent={content} messageUuid="uuid-4" sourceType="friend" />,
    );

    const body = container.querySelector('.card-log-tail-body');
    expect(body).not.toBeNull();
    expect(body?.textContent).toContain('…(仅显示最近 200 行)');
    // 最早 5 行被截掉(取末尾 200 行)
    expect(body?.textContent).not.toContain('\nrow-0\n');
    expect(body?.textContent).not.toContain('\nrow-4\n');
    // 末尾行保留
    expect(body?.textContent).toContain('row-204');
    expect(body?.textContent).toContain('row-5');
  });

  it('chart:非法行被过滤后 applyNewData 仅收 2 行合法数据,值正确', () => {
    const content = cardJson([
      {
        type: 'chart',
        title: 'K线',
        chart_type: 'candlestick',
        data: [
          CANDLE_1,
          { timestamp: 1700000120000, open: 12, high: 14, low: 11, close: 'bad' },
          CANDLE_2,
        ],
      },
    ]);
    render(<CardRenderer messageContent={content} messageUuid="uuid-5" sourceType="friend" />);

    expect(screen.getByText('K线')).toBeInTheDocument();
    expect(klinechartsMock.init).toHaveBeenCalledTimes(1);
    expect(klinechartsMock.applyNewData).toHaveBeenCalledTimes(1);
    const rows = klinechartsMock.applyNewData.mock.calls[0][0] as unknown[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ timestamp: CANDLE_1.timestamp, close: CANDLE_1.close });
    expect(rows[1]).toMatchObject({ timestamp: CANDLE_2.timestamp, close: CANDLE_2.close });
  });

  it("chart:chart_type='area' → setStyles 收到 { candle: { type: 'area' } }", () => {
    const content = cardJson([
      { type: 'chart', chart_type: 'area', data: [CANDLE_1] },
    ]);
    render(<CardRenderer messageContent={content} messageUuid="uuid-6" sourceType="friend" />);

    expect(klinechartsMock.setStyles).toHaveBeenCalledWith({ candle: { type: 'area' } });
  });

  it('chart:空 data → 占位 [图表: 暂无数据],不 init', () => {
    const content = cardJson([{ type: 'chart', title: 'K线', data: [] }]);
    render(<CardRenderer messageContent={content} messageUuid="uuid-7" sourceType="friend" />);

    expect(screen.getByText('[图表: 暂无数据]')).toBeInTheDocument();
    expect(klinechartsMock.init).not.toHaveBeenCalled();
  });

  it('sandbox:默认关闭 → 惰性占位 [富交互卡片],页面中不出现卡片自带 url', () => {
    const content = cardJson([
      { type: 'sandbox', url: 'https://evil.example/x', title: '打开面板' },
    ]);
    const { container } = render(
      <CardRenderer messageContent={content} messageUuid="uuid-8" sourceType="friend" />,
    );

    expect(screen.getByText('[富交互卡片]')).toBeInTheDocument();
    expect(container.innerHTML).not.toContain('evil.example');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it("audience='product':交互/日志/沙箱节点一律不渲染,text/chart 照常", () => {
    const content = cardJson([
      { type: 'text', text: '行情速览' },
      { type: 'button', action_id: 'b1', text: '刷新' },
      { type: 'select', action_id: 's1', options: [{ label: '甲', value: 'a' }] },
      { type: 'input', action_id: 'i1', placeholder: '输入关键词' },
      { type: 'log-tail', lines: ['secret-log-line'] },
      { type: 'action-buttons', buttons: [{ action_id: 'ab1', text: '动作' }] },
      { type: 'sandbox', url: 'https://evil.example/x' },
      { type: 'chart', data: [CANDLE_1] },
    ]);
    const { container } = render(
      <CardRenderer messageContent={content} messageUuid="uuid-9" sourceType="friend" audience="product" />,
    );

    // 布局/内容/chart 照常
    expect(screen.getByText('行情速览')).toBeInTheDocument();
    expect(container.querySelector('.card-chart-canvas')).not.toBeNull();
    expect(klinechartsMock.init).toHaveBeenCalledTimes(1);
    // 交互/日志/沙箱一律不渲染
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText('secret-log-line')).toBeNull();
    expect(screen.queryByText('[富交互卡片]')).toBeNull();
    expect(container.innerHTML).not.toContain('evil.example');
  });

  it('audience 缺省(默认 owner):全部节点照常渲染(回归默认行为)', () => {
    const content = cardJson([
      { type: 'text', text: '行情速览' },
      { type: 'button', action_id: 'b1', text: '刷新' },
      { type: 'select', action_id: 's1', options: [{ label: '甲', value: 'a' }] },
      { type: 'input', action_id: 'i1', placeholder: '输入关键词' },
      { type: 'log-tail', lines: ['secret-log-line'] },
      { type: 'action-buttons', buttons: [{ action_id: 'ab1', text: '动作' }] },
      { type: 'sandbox', url: 'https://evil.example/x' },
      { type: 'chart', data: [CANDLE_1] },
    ]);
    const { container } = render(
      <CardRenderer messageContent={content} messageUuid="uuid-10" sourceType="friend" />,
    );

    expect(screen.getByText('行情速览')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '动作' })).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(container.querySelector('.card-log-tail-body')?.textContent).toContain('secret-log-line');
    expect(screen.getByText('[富交互卡片]')).toBeInTheDocument();
    expect(klinechartsMock.init).toHaveBeenCalledTimes(1);
  });

  it('live patch:rev 推进 → 重渲新内容;同 rev 重放不变化(单调收敛)', () => {
    const uuid = 'uuid-live';
    render(
      <CardRenderer
        messageContent={cardJson([{ type: 'text', text: '旧文案' }])}
        messageUuid={uuid}
        sourceType="friend"
      />,
    );
    expect(screen.getByText('旧文案')).toBeInTheDocument();

    // rev 1 → 采用 live 内容重渲
    act(() => {
      useCardLiveStore.getState().applyUpdate(uuid, cardJson([{ type: 'text', text: '新文案' }]), 1);
    });
    expect(screen.getByText('新文案')).toBeInTheDocument();
    expect(screen.queryByText('旧文案')).toBeNull();

    // 同 rev 重放(乱序/重放)→ 不变化
    act(() => {
      useCardLiveStore.getState().applyUpdate(uuid, cardJson([{ type: 'text', text: '回放文案' }]), 1);
    });
    expect(screen.getByText('新文案')).toBeInTheDocument();
    expect(screen.queryByText('回放文案')).toBeNull();
  });
});
