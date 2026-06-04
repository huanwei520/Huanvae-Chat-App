/**
 * HuanvaeGuardPage — macOS 专属行为测试
 *
 * 覆盖：platform()==='macos' 且服务未运行时，header 显示「安装/修复服务」按钮，
 * 点击调用 invoke('hg_repair')（半装态恢复入口）并重新探活。
 *
 * 注：与默认 HuanvaeGuardPage.test.tsx（platform→windows）分文件，因 platform mock
 * 是模块级、无法逐用例覆盖。
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';

// platform → macos
vi.mock('@tauri-apps/plugin-os', () => ({
  platform: () => 'macos',
}));

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(() => {}),
}));

// invoke spy（断言 hg_repair 被调用；覆盖 tests/setup.ts 的全局 core mock）
const mockInvoke = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

// localApi：服务未运行（让按钮显示）
const mockLocalApi = vi.hoisted(() => ({
  checkServiceRunning: vi.fn().mockResolvedValue(false),
  getStatus: vi.fn().mockResolvedValue({ success: false }),
  startTunnel: vi.fn(),
  stopTunnel: vi.fn(),
}));
vi.mock('../../src/huanvaeGuard/localApi', () => mockLocalApi);

const mockServerApi = vi.hoisted(() => ({
  getDevices: vi.fn().mockResolvedValue([]),
  listGroups: vi.fn().mockResolvedValue([]),
  listLinks: vi.fn().mockResolvedValue([]),
  getGroupDetail: vi.fn(),
  createGroup: vi.fn(),
  createGroupInvite: vi.fn(),
  acceptGroupInvite: vi.fn(),
  leaveGroup: vi.fn(),
  toggleGroup: vi.fn(),
  deleteGroup: vi.fn(),
  registerDevice: vi.fn(),
  deleteDevice: vi.fn(),
  lockDevice: vi.fn(),
  unlockDevice: vi.fn(),
  getDeviceConfig: vi.fn(),
  createLinkInvite: vi.fn(),
  acceptLinkInvite: vi.fn(),
  deleteLink: vi.fn(),
}));
vi.mock('../../src/huanvaeGuard/serverApi', () => mockServerApi);

vi.mock('../../src/services/deviceInfo', () => ({
  getDeviceInfo: vi.fn().mockResolvedValue({ macAddress: '00:11:22:33:44:55' }),
}));

import HuanvaeGuardPage from '../../src/huanvaeGuard/HuanvaeGuardPage';

function setWindowQuery() {
  const params = new URLSearchParams({
    userId: 'u1',
    serverUrl: btoa('https://api.example.com'),
    accessToken: btoa('access-token'),
    refreshToken: btoa('refresh-token'),
  });
  window.history.replaceState({}, '', `/?${params}`);
}

describe('HuanvaeGuardPage (macOS)', () => {
  beforeEach(() => {
    cleanup();
    setWindowQuery();
    mockInvoke.mockClear();
    mockLocalApi.checkServiceRunning.mockClear();
    mockLocalApi.checkServiceRunning.mockResolvedValue(false);
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
  });

  it('shows 安装/修复服务 button when service not running on macOS (no unsupported hint)', async () => {
    render(<HuanvaeGuardPage />);
    await waitFor(() => expect(mockServerApi.getDevices).toHaveBeenCalled());

    expect(screen.getByRole('button', { name: '安装/修复服务' })).toBeInTheDocument();
    // macOS 受支持 → 不显示"仅 Windows / macOS 支持"提示
    expect(screen.queryByText('仅 Windows / macOS 支持')).not.toBeInTheDocument();
  });

  it('clicking 安装/修复服务 invokes hg_repair then re-checks service', async () => {
    render(<HuanvaeGuardPage />);
    await waitFor(() => expect(mockServerApi.getDevices).toHaveBeenCalled());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '安装/修复服务' }));
    });

    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('hg_repair'));
    // 修复后再次探活（mount 一次 + 修复后一次 = ≥2）
    await waitFor(() =>
      expect(mockLocalApi.checkServiceRunning.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
  });
});
