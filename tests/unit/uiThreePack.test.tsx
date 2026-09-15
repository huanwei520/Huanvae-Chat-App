/**
 * UI 三件套（#6/#7/#9）实施层的针对性回归
 *
 * 只钉三件「改错了会在真机上静默出问题」的事：
 * 1. #9 上报口径 —— getSignalingUrl 必须把本端平台带上；缺席时不追加参数
 *    （旧调用点/旧测试不受影响，服务端按 None 处理）
 * 2. #9 渲染口径 —— PlatformBadge 对「未上报」「ios」「unknown」一律不渲染，
 *    且四个目标平台各出一枚；这是「不给旧对端扣帽子」的机器口径
 * 3. #6 文件进度环 —— DocumentProgressRing 与图片/视频那圈是两套东西
 *    （不共用 circular-progress 类名），且对外部输入（NaN/越界）保守夹取
 *
 * 真页面截图证据不在这里 —— jsdom 不出图，UI 实测在设备上做（见交付）。
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { getSignalingUrl } from '../../src/meeting/api';
import { PlatformBadge } from '../../src/meeting/components/PlatformBadge';
import { DocumentProgressRing } from '../../src/chat/shared/DocumentProgressRing';

// ---- #9 上报 ----
describe('#9 getSignalingUrl 平台上报', () => {
  it('给了 platform 就带上 &platform= 参数', () => {
    const url = getSignalingUrl('room1', 'tok', 'https://api.example.cn', 'windows');
    expect(url).toBe('wss://api.example.cn/ws/webrtc/rooms/room1?token=tok&platform=windows');
  });

  it('四端各自能带上', () => {
    for (const p of ['windows', 'android', 'macos', 'linux'] as const) {
      expect(getSignalingUrl('r', 't', 'http://h', p)).toContain(`&platform=${p}`);
    }
  });

  it('不给 platform 时不追加参数（旧调用点/旧测试不受影响）', () => {
    const url = getSignalingUrl('room1', 'tok', 'https://api.example.cn');
    expect(url).toBe('wss://api.example.cn/ws/webrtc/rooms/room1?token=tok');
    expect(url).not.toContain('platform');
  });

  it('http → ws / https → wss 的替换不受影响', () => {
    expect(getSignalingUrl('r', 't', 'http://x', 'linux')).toMatch(/^ws:\/\//);
    expect(getSignalingUrl('r', 't', 'https://x', 'linux')).toMatch(/^wss:\/\//);
  });
});

// ---- #9 渲染 ----
describe('#9 PlatformBadge 渲染口径', () => {
  it.each(['windows', 'android', 'macos', 'linux'] as const)('%s 渲染一枚徽章', (p) => {
    render(<PlatformBadge platform={p} />);
    expect(screen.getByLabelText(/^设备平台 /)).toHaveAttribute('data-platform', p);
  });

  it('未上报（undefined）不渲染 —— 旧对端不该被扣「未知平台」的帽子', () => {
    const { container } = render(<PlatformBadge platform={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each(['ios', 'unknown'] as const)('%s 不渲染（本轮无该图标，字段照发）', (p) => {
    const { container } = render(<PlatformBadge platform={p} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('徽章是纯标识：不抢点击（pointer-events 由 CSS none 兜住，这里钉住无 onClick）', () => {
    render(<PlatformBadge platform="windows" />);
    expect(screen.getByLabelText('设备平台 Windows')).not.toHaveAttribute('role', 'button');
  });
});

// ---- #6 文件进度环 ----
describe('#6 DocumentProgressRing（Telegram 式，与图片/视频那圈分开）', () => {
  it('不带 circular-progress 类名（确实是另一套，不是共用实现）', () => {
    const { container } = render(<DocumentProgressRing progress={42} />);
    expect(container.querySelector('.circular-progress-svg')).toBeNull();
    expect(container.querySelector('.document-progress-ring')).not.toBeNull();
  });

  it('进度弧的 stroke-dasharray 随百分比增长', () => {
    const { container: c25 } = render(<DocumentProgressRing progress={25} />);
    const { container: c75 } = render(<DocumentProgressRing progress={75} />);
    const dash = (c: HTMLElement) =>
      c.querySelector('.document-progress-ring-arc')?.getAttribute('stroke-dasharray') ?? '';
    const value = (s: string) => parseFloat(s.split(' ')[0]);
    expect(value(dash(c75))).toBeGreaterThan(value(dash(c25)));
  });

  it('外部输入保守：NaN → 0%，越界夹到 [0,100]', () => {
    const { container: nan } = render(<DocumentProgressRing progress={Number.NaN} />);
    expect(nan.querySelector('[role="progressbar"]')).toHaveAttribute('aria-valuenow', '0');

    const { container: over } = render(<DocumentProgressRing progress={130} />);
    expect(over.querySelector('[role="progressbar"]')).toHaveAttribute('aria-valuenow', '100');

    const { container: under } = render(<DocumentProgressRing progress={-20} />);
    expect(under.querySelector('[role="progressbar"]')).toHaveAttribute('aria-valuenow', '0');
  });

  it('可访问性：role=progressbar + 带百分比的 aria-label', () => {
    render(<DocumentProgressRing progress={66} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-label', '下载中 66%');
  });
});
