/**
 * 会议域 API 封装单元测试（src/meeting/api.ts）
 *
 * 用假 ApiClient（get/post 为 vi.fn）验证 7 个导出函数：
 *   - getIceServers / createRoom / joinRoom：path/query/body 精确匹配 + 返回解包数据；
 *   - getSignalingUrl：http(s) → ws(s) 协议替换；
 *   - saveMeetingData / loadMeetingData / clearMeetingData：localStorage 键与序列化契约
 *     （tests/setup.ts 已把 localStorage mock 成 vi.fn 对象，读用 mockReturnValueOnce、写断言参数）；
 *   - 异常：api 抛错时原样向上抛（薄封装不 try/catch 不兜底）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApiClient } from '../../src/api/client';
import * as meeting from '../../src/meeting/api';

function makeApi() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
  } as unknown as ApiClient & {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
  };
}

const MEETING_KEY = 'huanvae_meeting_data';

const sampleData: meeting.MeetingWindowData = {
  role: 'creator',
  roomId: 'room-1',
  password: '123456',
  roomName: 'demo room',
  displayName: 'Alice',
  token: 'ws-token',
  serverUrl: 'https://api.example.com',
};

describe('会议 API 封装 (meeting/api)', () => {
  let api: ReturnType<typeof makeApi>;

  beforeEach(() => {
    api = makeApi();
  });

  // ---- getIceServers ----

  it('getIceServers 无 region：无 query', async () => {
    api.get.mockResolvedValue({ ice_servers: [], expires_at: 'x' });
    const out = await meeting.getIceServers(api);
    expect(api.get).toHaveBeenCalledWith('/api/webrtc/ice_servers');
    expect(out).toEqual({ ice_servers: [], expires_at: 'x' });
  });

  it('getIceServers 带 region：拼 ?region=', async () => {
    api.get.mockResolvedValue({ ice_servers: [], expires_at: 'x' });
    await meeting.getIceServers(api, 'cn-east');
    expect(api.get).toHaveBeenCalledWith('/api/webrtc/ice_servers?region=cn-east');
  });

  it('getIceServers region 含中文/空格：encodeURIComponent 编码', async () => {
    api.get.mockResolvedValue({ ice_servers: [], expires_at: 'x' });
    await meeting.getIceServers(api, '华东 1');
    expect(api.get).toHaveBeenCalledWith(
      '/api/webrtc/ice_servers?region=%E5%8D%8E%E4%B8%9C%201',
    );
  });

  // ---- createRoom ----

  it('createRoom 无参：POST 空对象 body', async () => {
    api.post.mockResolvedValue({ room_id: 'r1' });
    const out = await meeting.createRoom(api);
    expect(api.post).toHaveBeenCalledWith('/api/webrtc/rooms', {});
    expect(out).toEqual({ room_id: 'r1' });
  });

  it('createRoom 带选项：options 原样透传', async () => {
    api.post.mockResolvedValue({ room_id: 'r2' });
    await meeting.createRoom(api, {
      name: 'demo',
      display_name: 'Alice',
      password: '654321',
      max_participants: 5,
    });
    expect(api.post).toHaveBeenCalledWith('/api/webrtc/rooms', {
      name: 'demo',
      display_name: 'Alice',
      password: '654321',
      max_participants: 5,
    });
  });

  // ---- joinRoom ----

  it('joinRoom 不带 avatarUrl：body 恰为 {password, display_name}，无 avatar_url 键', async () => {
    api.post.mockResolvedValue({ participant_id: 'p1' });
    const out = await meeting.joinRoom(api, 'room-1', '123456', 'Alice');
    expect(api.post).toHaveBeenCalledWith('/api/webrtc/rooms/room-1/join', {
      password: '123456',
      display_name: 'Alice',
    });
    const body = api.post.mock.calls[0][1] as Record<string, unknown>;
    expect('avatar_url' in body).toBe(false);
    expect(out).toEqual({ participant_id: 'p1' });
  });

  it('joinRoom 带 avatarUrl：body 含 avatar_url', async () => {
    api.post.mockResolvedValue({ participant_id: 'p2' });
    await meeting.joinRoom(api, 'room-1', '123456', 'Alice', 'https://cdn/a.png');
    expect(api.post).toHaveBeenCalledWith('/api/webrtc/rooms/room-1/join', {
      password: '123456',
      display_name: 'Alice',
      avatar_url: 'https://cdn/a.png',
    });
  });

  // ---- getSignalingUrl ----

  it('getSignalingUrl https → wss', () => {
    expect(meeting.getSignalingUrl('room-1', 'tok', 'https://api.example.com')).toBe(
      'wss://api.example.com/ws/webrtc/rooms/room-1?token=tok',
    );
  });

  it('getSignalingUrl http → ws（保留端口）', () => {
    expect(meeting.getSignalingUrl('r9', 't9', 'http://10.0.0.1:8080')).toBe(
      'ws://10.0.0.1:8080/ws/webrtc/rooms/r9?token=t9',
    );
  });

  // ---- localStorage 三件套 ----

  it('saveMeetingData：setItem(键, JSON.stringify(data))', () => {
    meeting.saveMeetingData(sampleData);
    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      MEETING_KEY,
      JSON.stringify(sampleData),
    );
  });

  it('loadMeetingData：getItem 返回 JSON 字符串时解析为对象', () => {
    vi.mocked(window.localStorage.getItem).mockReturnValueOnce(JSON.stringify(sampleData));
    const out = meeting.loadMeetingData();
    expect(window.localStorage.getItem).toHaveBeenCalledWith(MEETING_KEY);
    expect(out).toEqual(sampleData);
  });

  it('loadMeetingData：无数据（undefined / null）返回 null', () => {
    // setup.ts 的 getItem 是 vi.fn()，默认返回 undefined（falsy 分支）
    expect(meeting.loadMeetingData()).toBeNull();
    vi.mocked(window.localStorage.getItem).mockReturnValueOnce(null);
    expect(meeting.loadMeetingData()).toBeNull();
  });

  it('loadMeetingData：非法 JSON 返回 null', () => {
    vi.mocked(window.localStorage.getItem).mockReturnValueOnce('{oops');
    expect(meeting.loadMeetingData()).toBeNull();
  });

  it('clearMeetingData：removeItem(键)', () => {
    meeting.clearMeetingData();
    expect(window.localStorage.removeItem).toHaveBeenCalledWith(MEETING_KEY);
  });

  // ---- 异常路径：原样向上抛 ----

  it('getIceServers 异常：api.get 抛错时向上抛', async () => {
    api.get.mockRejectedValue(new Error('ice-fail'));
    await expect(meeting.getIceServers(api)).rejects.toThrow('ice-fail');
  });

  it('joinRoom 异常：api.post 抛错时向上抛', async () => {
    api.post.mockRejectedValue(new Error('join-fail'));
    await expect(meeting.joinRoom(api, 'r', 'p', 'n')).rejects.toThrow('join-fail');
  });
});
