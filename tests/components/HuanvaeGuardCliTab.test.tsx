/**
 * HuanvaeGuardPage — 「终端下载」tab（A2）
 *
 * huanwei 2026-08-14 原话：「在 vpn 页面增加一个**终端下载**的选项，将 hg-cli 的下载命令和
 * 使用方式放在这个选项中，将其放置在**群组的旁边**」。
 *
 * 四条硬约束（每条都是「照抄即失败」或「红线」级，逐条来自 HuanvaeGuard 线现查的真值文件
 * `hgcli-facts-for-app-terminal-download-tab.md`，不是转述）：
 *   1. **只装 Linux** —— 安装器对非 Linux 内核直接 die，而这个窗口跑在 Windows / macOS 上
 *      ⇒ 页面必须写明「Linux 终端」，否则用户在本机照抄必然失败；
 *   2. **没有官方卸载命令** —— 只能给手工四步，且必须点明删 /etc/huanvae = 删掉设备身份；
 *   3. **不写死版本号** —— 发布清单里的 version 是移动靶；
 *   4. **本仓是 PUBLIC 仓** —— enroll 的服务器地址与 key 只能是占位符。
 *
 * 前两条 + tab 落点用**渲染**验（用户真能看到的那份文本），后两条用**静态扫描**验
 * （脱敏是"整块源码里不许出现"的性质，渲染只能看到当前分支）。
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ============== Mock @tauri-apps/plugin-os ==============
vi.mock('@tauri-apps/plugin-os', () => ({
  platform: () => 'windows',
}));

// ============== Mock @tauri-apps/api/event ==============
vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(() => {}),
}));

// ============== Mock localApi ==============
vi.mock('../../src/huanvaeGuard/localApi', () => ({
  getStatus: vi.fn().mockResolvedValue({ success: false }),
  startTunnel: vi.fn(),
  stopTunnel: vi.fn(),
  resolveLocalPort: vi.fn().mockResolvedValue(19198),
}));

// ============== Mock serverApi ==============
const mockServerApi = vi.hoisted(() => ({
  getDevices: vi.fn(),
  listGroups: vi.fn(),
  listLinks: vi.fn(),
  getGroupDetail: vi.fn(),
  createGroup: vi.fn(),
  createGroupInvite: vi.fn(),
  acceptGroupInvite: vi.fn(),
  joinGroup: vi.fn(),
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

// ============== Mock deviceInfo ==============
vi.mock('../../src/services/deviceInfo', () => ({
  getDeviceInfo: vi.fn().mockResolvedValue({ macAddress: '00:11:22:33:44:55' }),
}));

// 必须在 mock 之后再 import 被测组件
import HuanvaeGuardPage from '../../src/huanvaeGuard/HuanvaeGuardPage';

const PAGE_SRC = readFileSync(
  resolve(__dirname, '../../src/huanvaeGuard/HuanvaeGuardPage.tsx'),
  'utf-8',
);

/** 命令常量块：从块头注释起，到紧随其后的轮询节拍常量为止 */
const CLI_CONSTANTS = (() => {
  const m = PAGE_SRC.match(/\/\/ ── 终端下载 tab 的命令真值[\s\S]*?(?=\/\*\* 常驻状态复查节拍)/);
  expect(m, '终端下载命令常量块没找到').not.toBeNull();
  return m![0];
})();

/** tab 的 JSX 渲染块：从 activeTab === 'cli' 起，到日志面板为止 */
const CLI_PANEL_JSX = (() => {
  const m = PAGE_SRC.match(/\{activeTab === 'cli' &&[\s\S]*?(?=\{\/\* Log panel)/);
  expect(m, '终端下载渲染块没找到').not.toBeNull();
  return m![0];
})();

const CLI_REGION = `${CLI_CONSTANTS}\n${CLI_PANEL_JSX}`;

function setWindowQuery() {
  const params = new URLSearchParams({
    userId: 'u1',
    serverUrl: btoa('https://api.example.com'),
    accessToken: btoa('access-token'),
    refreshToken: btoa('refresh-token'),
  });
  window.history.replaceState({}, '', `/?${params}`);
}

async function renderAndOpenCliTab() {
  render(<HuanvaeGuardPage />);
  await waitFor(() => expect(mockServerApi.getDevices).toHaveBeenCalled());
  await act(async () => {
    screen.getByRole('button', { name: '终端下载' }).click();
  });
}

describe('终端下载 tab 的位置（他点名要在群组旁边）', () => {
  beforeEach(() => {
    cleanup();
    setWindowQuery();
    Object.values(mockServerApi).forEach((m) => m.mockReset());
    mockServerApi.getDevices.mockResolvedValue([]);
    mockServerApi.listGroups.mockResolvedValue([]);
    mockServerApi.listLinks.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
  });

  it('四个 tab 按 设备 / 链接 / 群组 / 终端下载 排列，终端下载紧跟群组', async () => {
    render(<HuanvaeGuardPage />);
    await waitFor(() => expect(mockServerApi.getDevices).toHaveBeenCalled());

    const nav = document.querySelector('.hg-tabs');
    expect(nav).not.toBeNull();
    const labels = Array.from((nav as HTMLElement).querySelectorAll('.hg-tab'))
      .map(b => b.textContent);

    expect(labels).toEqual(['设备', '链接', '群组', '终端下载']);
  });

  it('点开之后渲染的是这个 tab 自己的卡片（不是别的 tab 漏出来）', async () => {
    await renderAndOpenCliTab();

    expect(screen.getByText('终端下载 · hg-cli')).toBeInTheDocument();
    // 设备 tab 的内容必须已经让位
    expect(screen.queryByText('+ 注册设备')).not.toBeInTheDocument();
  });
});

describe('🔴 四条硬约束在页面文案里的落实', () => {
  beforeEach(() => {
    cleanup();
    setWindowQuery();
    Object.values(mockServerApi).forEach((m) => m.mockReset());
    mockServerApi.getDevices.mockResolvedValue([]);
    mockServerApi.listGroups.mockResolvedValue([]);
    mockServerApi.listLinks.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
  });

  it('约束 1：页面写明只能在 Linux 上装、要在 Linux 终端里执行', async () => {
    await renderAndOpenCliTab();

    const panel = screen.getByText('终端下载 · hg-cli').closest('.hg-card') as HTMLElement;
    const text = panel.textContent ?? '';

    expect(text).toContain('Linux');
    expect(text).toMatch(/只能装在\s*Linux\s*上/);
    expect(text).toContain('Linux 终端');
    // 反向：不许出现「任意系统 / 都能装」这类把限制说没了的话
    expect(text).not.toMatch(/任意系统|任何系统|都能装/);
  });

  it('约束 2：卸载给的是手工四步，且点明删 /etc/huanvae = 删掉设备身份', async () => {
    await renderAndOpenCliTab();

    const panel = screen.getByText('终端下载 · hg-cli').closest('.hg-card') as HTMLElement;
    const text = panel.textContent ?? '';

    expect(text).toContain('没有一键卸载命令');
    expect(text).toContain('sudo rm -rf /etc/huanvae');
    expect(text).toContain('设备身份');
    // 反向：不许凭空发明一个官方卸载子命令（该仓根本没有）
    expect(text).not.toMatch(/hg-cli\s+uninstall|--uninstall/);
  });

  it('约束 3：整块源码里没有硬编码的版本号，改为让用户跑 --version', async () => {
    // 静态扫描：渲染只看得到当前分支，脱敏 / 不硬编是「整块源码里不许出现」的性质
    expect(CLI_REGION).not.toMatch(/\b\d+\.\d+\.\d+\b/);
    // 正对照：这块源码确实抓到了（含安装命令），上面那个 not 不是在空串上恒真
    expect(CLI_REGION).toContain('install.sh');
    expect(CLI_REGION).toContain('hg-cli --version');
  });

  it('约束 4（PUBLIC 仓红线）：enroll 只有变量名与占位符，没有任何真实地址 / 凭据', async () => {
    // 变量名可公开，值一律占位符
    expect(CLI_REGION).toContain('HG_ENROLL_SERVER=https://<你的服务器>:<端口>');
    expect(CLI_REGION).toContain('HG_ENROLL_KEY=<你的-enroll-key>');

    // 允许出现的主机只有公开分发端点 store.huanvae.cn；其余 http(s) 主机一律不许
    const hosts = Array.from(CLI_REGION.matchAll(/https?:\/\/([^\s'"<)/]+)/g)).map(m => m[1]);
    expect(hosts.length).toBeGreaterThan(0); // 正对照：确实扫到了 URL
    expect([...new Set(hosts)]).toEqual(['store.huanvae.cn']);

    // 私网 / 回环地址、mesh 段一个都不许出现
    expect(CLI_REGION).not.toMatch(/\b(?:10|127|192\.168)\.\d{1,3}\.\d{1,3}/);
  });
});
