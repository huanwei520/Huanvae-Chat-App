/**
 * HuanvaeGuardPage 组件测试
 *
 * 覆盖重点：
 *   1. Tabs 中文化（设备 / 链接 / 群组）
 *   2. 顶部"通过邀请加入群组"独立入口（不依赖展开任何群组）
 *   3. acceptGroupInvite 调用参数正确（groupId / token / deviceId 三段）
 *   4. 群组卡片上无"加入"按钮（且全程不调用 serverApi.joinGroup）
 *   5. 创建群组使用 PromptDialog（不调用 window.prompt）
 *   6. 删除群组使用中文确认对话框
 *   7. Header 状态文案中文
 *   8. acceptGroupInvite 成功后表单清空 + 列表重载
 *   9. 群组邀请码 SecretDisplay portal 到 body fixed 高层容器（防遮挡回归）
 *
 * 注：`formatHandshake` 作为纯函数在 huanvaeGuard.formatHandshake.test.ts 中单测覆盖
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act, within } from '@testing-library/react';

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
// 页面的常驻单飞探活只调 getStatus（localApi 已无 checkServiceRunning）：
// 默认 {success:false} → 探活判定「本地服务未运行」
vi.mock('../../src/huanvaeGuard/localApi', () => ({
  getStatus: vi.fn().mockResolvedValue({ success: false }),
  startTunnel: vi.fn(),
  stopTunnel: vi.fn(),
  // 探活转为「运行中」时页面用它取真实控制端口打日志（端口不写死）：19198 = 模块内的默认端口
  resolveLocalPort: vi.fn().mockResolvedValue(19198),
}));

// ============== Mock serverApi ==============
// vi.hoisted 让 mockServerApi 在 vi.mock 工厂调用时已存在（vi.mock 会被提升到 import 之前）
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

// ============== 测试工具 ==============

const TEST_DEVICES = [
  {
    device_id: 'dev-1',
    user_id: 'u1',
    device_name: '我的电脑',
    public_key: 'pk1',
    virtual_ip: '10.10.0.1',
    node_id: null,
    psk_hash: null,
    os: 'Windows',
    device_fingerprint: null,
    status: 'offline',
    locked_endpoint: null,
    last_heartbeat: null,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
  },
  {
    device_id: 'dev-2',
    user_id: 'u1',
    device_name: '我的笔记本',
    public_key: 'pk2',
    virtual_ip: '10.10.0.2',
    node_id: null,
    psk_hash: null,
    os: 'Windows',
    device_fingerprint: null,
    status: 'offline',
    locked_endpoint: null,
    last_heartbeat: null,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
  },
];

const TEST_GROUPS = [
  {
    group_id: 'grp-1',
    name: '工作群组',
    owner_id: 'u1',
    description: null,
    is_active: true,
    max_devices: null,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
  },
];

function setWindowQuery() {
  const params = new URLSearchParams({
    userId: 'u1',
    serverUrl: btoa('https://api.example.com'),
    accessToken: btoa('access-token'),
    refreshToken: btoa('refresh-token'),
  });
  window.history.replaceState({}, '', `/?${params}`);
}

async function renderAndOpenGroupsTab() {
  render(<HuanvaeGuardPage />);
  // 等设备加载（loadDevices）完成
  await waitFor(() => expect(mockServerApi.getDevices).toHaveBeenCalled());
  // 切到群组 Tab
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '群组' }));
  });
  await waitFor(() => expect(mockServerApi.listGroups).toHaveBeenCalled());
}

// ============== 测试用例 ==============

describe('HuanvaeGuardPage', () => {
  beforeEach(() => {
    cleanup();
    setWindowQuery();
    // 重置所有 mock
    Object.values(mockServerApi).forEach((m) => m.mockReset());
    // 默认返回值
    mockServerApi.getDevices.mockResolvedValue(TEST_DEVICES);
    mockServerApi.listGroups.mockResolvedValue(TEST_GROUPS);
    mockServerApi.listLinks.mockResolvedValue([]);
    mockServerApi.getGroupDetail.mockResolvedValue({
      group: TEST_GROUPS[0]!,
      devices: [],
    });
  });

  afterEach(() => {
    cleanup();
    // 还原 URL，避免污染后续测试
    window.history.replaceState({}, '', '/');
  });

  it('renders Chinese tab labels (设备 / 链接 / 群组)', async () => {
    render(<HuanvaeGuardPage />);
    await waitFor(() => expect(mockServerApi.getDevices).toHaveBeenCalled());

    expect(screen.getByRole('button', { name: '设备' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '链接' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '群组' })).toBeInTheDocument();
  });

  it('renders Chinese service status in header', async () => {
    render(<HuanvaeGuardPage />);
    await waitFor(() => expect(mockServerApi.getDevices).toHaveBeenCalled());

    // 常驻探活读到 getStatus 默认 {success:false} → serviceRunning=false → "服务未运行"
    expect(screen.getByText('服务未运行')).toBeInTheDocument();
  });

  it('shows top "通过邀请加入群组" form independently of any selected group', async () => {
    await renderAndOpenGroupsTab();

    // 顶部入口在没有任何 group 被展开时就应该可见
    expect(screen.getByText('通过邀请加入群组')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('群组 ID')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('邀请令牌')).toBeInTheDocument();
  });

  it('group card has no "加入" button (only 邀请/切换状态/删除)', async () => {
    await renderAndOpenGroupsTab();

    // 群组卡片上的按钮：邀请 / 切换状态 / 删除
    const groupCard = screen.getByText('工作群组').closest('.hg-group-item');
    expect(groupCard).not.toBeNull();
    const actions = within(groupCard as HTMLElement);

    expect(actions.queryByText('加入')).not.toBeInTheDocument();
    expect(actions.queryByText('Join')).not.toBeInTheDocument();
    expect(actions.getByText('邀请')).toBeInTheDocument();
    expect(actions.getByText('切换状态')).toBeInTheDocument();
    expect(actions.getByText('删除')).toBeInTheDocument();

    // 重构核心契约：UI 完全不再调用 serverApi.joinGroup（自助加入入口已删除）
    expect(mockServerApi.joinGroup).not.toHaveBeenCalled();
  });

  it('top form calls acceptGroupInvite with (serverUrl, token, groupId, inviteToken, deviceId)', async () => {
    mockServerApi.acceptGroupInvite.mockResolvedValue({
      group_id: 'grp-X',
      status: 'active',
      pending_peers: 0,
    });

    await renderAndOpenGroupsTab();

    const groupIdInput = screen.getByPlaceholderText('群组 ID') as HTMLInputElement;
    const tokenInput = screen.getByPlaceholderText('邀请令牌') as HTMLInputElement;
    fireEvent.change(groupIdInput, { target: { value: 'grp-X' } });
    fireEvent.change(tokenInput, { target: { value: 'invite-token-abc' } });

    // 顶部表单的设备下拉（页面上还有 Links Tab 的下拉，但当前在 Groups Tab，只有一个）
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBeGreaterThan(0);
    const deviceSelect = selects[0] as HTMLSelectElement;
    fireEvent.change(deviceSelect, { target: { value: 'dev-1' } });

    // 重置 listGroups 调用计数（renderAndOpenGroupsTab 内已调过一次）
    mockServerApi.listGroups.mockClear();

    // 点击"加入"
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '加入' }));
    });

    // 验证 API 调用参数
    expect(mockServerApi.acceptGroupInvite).toHaveBeenCalledTimes(1);
    expect(mockServerApi.acceptGroupInvite).toHaveBeenCalledWith(
      'https://api.example.com',
      'access-token',
      'grp-X',
      'invite-token-abc',
      'dev-1',
    );

    // 验证副作用：表单清空 + 列表重载
    await waitFor(() => {
      expect(mockServerApi.listGroups).toHaveBeenCalled();
    });
    expect(groupIdInput.value).toBe('');
    expect(tokenInput.value).toBe('');
    expect(deviceSelect.value).toBe('');
  });

  it('"加入" button is disabled until all three fields are filled', async () => {
    await renderAndOpenGroupsTab();

    const joinBtn = screen.getByRole('button', { name: '加入' }) as HTMLButtonElement;
    expect(joinBtn.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText('群组 ID'), { target: { value: 'g' } });
    expect(joinBtn.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText('邀请令牌'), { target: { value: 't' } });
    expect(joinBtn.disabled).toBe(true);

    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0]!, { target: { value: 'dev-1' } });
    expect(joinBtn.disabled).toBe(false);
  });

  it('clicking "+ 创建群组" opens PromptDialog (not window.prompt)', async () => {
    // 显式 mock window.prompt 检测它没被调用
    const winPromptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);

    await renderAndOpenGroupsTab();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '+ 创建群组' }));
    });

    // PromptDialog 应该出现，window.prompt 不应被调用
    expect(winPromptSpy).not.toHaveBeenCalled();
    expect(screen.getByText('创建群组')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('群组名称')).toBeInTheDocument();

    winPromptSpy.mockRestore();
  });

  it('full create group flow: name + description -> calls createGroup', async () => {
    mockServerApi.createGroup.mockResolvedValue({
      group_id: 'grp-new',
      name: '新群组',
    });

    await renderAndOpenGroupsTab();

    // 第一次 prompt — 群组名称
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '+ 创建群组' }));
    });
    fireEvent.change(screen.getByPlaceholderText('群组名称'), {
      target: { value: '新群组' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '确认' }));
    });

    // 第二次 prompt — 描述（required: false）
    expect(screen.getByText('群组描述')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('描述（可选）'), {
      target: { value: '团队协作' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '确认' }));
    });

    expect(mockServerApi.createGroup).toHaveBeenCalledWith(
      'https://api.example.com',
      'access-token',
      '新群组',
      '团队协作',
    );
  });

  it('cancelling create-group prompt aborts without calling API', async () => {
    await renderAndOpenGroupsTab();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '+ 创建群组' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '取消' }));
    });

    expect(mockServerApi.createGroup).not.toHaveBeenCalled();
  });

  it('clicking 删除 on a group shows Chinese confirm dialog and calls deleteGroup on confirm', async () => {
    mockServerApi.deleteGroup.mockResolvedValue(undefined);

    await renderAndOpenGroupsTab();

    const groupCard = screen.getByText('工作群组').closest('.hg-group-item');
    const cardScope = within(groupCard as HTMLElement);
    await act(async () => {
      fireEvent.click(cardScope.getByText('删除'));
    });

    // 中文确认对话框
    expect(screen.getByText('删除群组')).toBeInTheDocument();
    expect(
      screen.getByText('确定删除此群组？群组内的设备将被移除。'),
    ).toBeInTheDocument();

    // 确认
    await act(async () => {
      fireEvent.click(screen.getAllByText('删除').find(
        (el) => el.tagName === 'BUTTON' && el.classList.contains('toolbar-btn'),
      )!);
    });

    expect(mockServerApi.deleteGroup).toHaveBeenCalledWith(
      'https://api.example.com',
      'access-token',
      'grp-1',
    );
  });

  it('cancelling delete-group dialog does NOT call deleteGroup', async () => {
    await renderAndOpenGroupsTab();

    const groupCard = screen.getByText('工作群组').closest('.hg-group-item');
    const cardScope = within(groupCard as HTMLElement);
    await act(async () => {
      fireEvent.click(cardScope.getByText('删除'));
    });

    expect(screen.getByText('确定删除此群组？群组内的设备将被移除。')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '取消' }));
    });

    expect(mockServerApi.deleteGroup).not.toHaveBeenCalled();
  });

  it('ListEmpty messages are in Chinese on each tab', async () => {
    mockServerApi.getDevices.mockResolvedValue([]);
    mockServerApi.listGroups.mockResolvedValue([]);
    mockServerApi.listLinks.mockResolvedValue([]);

    render(<HuanvaeGuardPage />);
    await waitFor(() => expect(mockServerApi.getDevices).toHaveBeenCalled());

    expect(screen.getByText('暂无注册设备')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '链接' }));
    });
    await waitFor(() => expect(mockServerApi.listLinks).toHaveBeenCalled());
    expect(screen.getByText('暂无链接')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '群组' }));
    });
    await waitFor(() => expect(mockServerApi.listGroups).toHaveBeenCalled());
    expect(screen.getByText('暂无群组')).toBeInTheDocument();
  });

  it('addLog writes Chinese messages on initial load (devices + service status)', async () => {
    render(<HuanvaeGuardPage />);

    // 初始化时会 addLog 两条：
    //   - "已加载 N 个设备"（来自 loadDevices）
    //   - "本地服务未运行"（来自常驻单飞探活：getStatus 默认 mock 返回 {success:false}）
    await waitFor(() => {
      expect(screen.getByText(/已加载 \d+ 个设备/)).toBeInTheDocument();
    });
    expect(screen.getByText(/本地服务未运行/)).toBeInTheDocument();
  });

  it('群组邀请码 SecretDisplay portal 到 body 的 fixed 高层容器（回归：防 backdrop-filter/滚动遮挡）', async () => {
    mockServerApi.createGroupInvite.mockResolvedValue({
      invite_token: 'group-invite-token-xyz',
      expires_at: '2026-08-01T00:00:00Z',
    });

    await renderAndOpenGroupsTab();

    await act(async () => {
      fireEvent.click(screen.getByText('邀请'));
    });

    const tokenEl = await screen.findByText('group-invite-token-xyz');
    const overlay = tokenEl.closest('.oauth-create-overlay');
    expect(overlay).not.toBeNull();
    // 遮罩层必须被一个 fixed + z-index>1000 的包裹层承载，且该包裹层直接挂在 body（portal 化）
    const wrapper = overlay?.parentElement as HTMLElement;
    expect(wrapper.style.position).toBe('fixed');
    expect(Number(wrapper.style.zIndex)).toBeGreaterThan(1000);
    expect(wrapper.parentElement).toBe(document.body);
  });
});
