/**
 * 会议创建者的 ICE 配置获取（src/meeting/creatorIce.ts）+「创建者路径真的把它存进去了」的静态契约
 *
 * 🔴 回归目标（外部审计 idx=75）：`createRoom` 的响应里没有 `ice_servers`（只有 `joinRoom` 有），
 * 而 `getIceServers` 在改前**全仓只有它自己的定义行、从来没人调用** ⇒ 创建者保存的
 * `MeetingWindowData.iceServers` 恒为 undefined ⇒ 会议窗口只能退到硬编码公共 STUN：
 * 既用不上自家 TURN 中继（对称 NAT / 双 NAT 下建不了连），又把 ICE 探测流量送给第三方。
 *
 * 分两层守：
 *   1. 行为层：本模块拿到什么、失败时给什么（下面 describe 1）；
 *   2. 接线层：桌面与移动两条创建者路径**真的**调了它、并把结果写进 saveMeetingData
 *      （describe 2，静态扫描 —— 两处调用点都在带 Tauri/Context 依赖的组件里，
 *      渲染成本远高于它能守住的那一件事）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ApiClient } from '../../src/api/client';
import { fetchCreatorIceServers } from '../../src/meeting/creatorIce';

function makeApi(): ApiClient & { get: ReturnType<typeof vi.fn> } {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
  } as unknown as ApiClient & { get: ReturnType<typeof vi.fn> };
}

describe('fetchCreatorIceServers', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('打的是 /api/webrtc/ice_servers，并原样返回后端下发的列表', async () => {
    const api = makeApi();
    const servers = [{ urls: ['turn:relay.example:3478'], username: 'u', credential: 'c' }];
    api.get.mockResolvedValue({ ice_servers: servers, expires_at: '2026-08-21T00:00:00Z' });

    await expect(fetchCreatorIceServers(api)).resolves.toEqual(servers);
    expect(api.get).toHaveBeenCalledWith('/api/webrtc/ice_servers');
  });

  it('后端返回空列表 ⇒ undefined（调用方按「没拿到」处理，不要存一个空数组进去）', async () => {
    const api = makeApi();
    api.get.mockResolvedValue({ ice_servers: [], expires_at: '' });

    await expect(fetchCreatorIceServers(api)).resolves.toBeUndefined();
  });

  it('端点失败 ⇒ undefined 且不抛（这一步只影响连通质量，不该把「开不了会」升级出来）', async () => {
    const api = makeApi();
    api.get.mockRejectedValue(new Error('503'));

    await expect(fetchCreatorIceServers(api)).resolves.toBeUndefined();
  });
});

/** 读源码做静态契约：两处创建者路径都必须调 fetchCreatorIceServers 并把结果写进 meetingData */
function src(relative: string): string {
  return readFileSync(resolve(__dirname, '../../src', relative), 'utf-8');
}

describe('创建者路径必须真的接上（静态契约）', () => {
  const CASES: Array<{ label: string; file: string }> = [
    { label: '桌面 MeetingEntryModal', file: 'meeting/components/MeetingEntryModal.tsx' },
    { label: '移动 MobileMeetingEntryPage', file: 'pages/mobile/MobileMeetingEntryPage.tsx' },
  ];

  it.each(CASES)('$label 的 handleJoinCreatedRoom 取 ICE 并存进 saveMeetingData', ({ file }) => {
    const source = src(file);

    // 1) 真的 import 并调用了它（改前 getIceServers 全仓零调用点，正是这一条要防的）
    expect(source).toMatch(/import\s*\{[^}]*\bfetchCreatorIceServers\b[^}]*\}\s*from/);
    expect(source).toMatch(/const\s+iceServers\s*=\s*await\s+fetchCreatorIceServers\(api\)/);

    // 2) 结果真的进了 saveMeetingData 的对象字面量 —— 「拿到了但没传」是本仓反复踩过的形态
    const call = source.match(/saveMeetingData\(\{[\s\S]*?\}\);/g) ?? [];
    const creatorCall = call.find((c) => c.includes("role: 'creator'"));
    expect(creatorCall).toBeDefined();
    expect(creatorCall).toMatch(/\biceServers,/);
  });
});
