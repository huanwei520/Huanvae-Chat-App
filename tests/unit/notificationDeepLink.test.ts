/**
 * 通知会话深链单元测试
 *
 * 覆盖 deepLinkService 纯逻辑（载荷解析校验）与 notificationService 的
 * 深链发布路由（移动端带深链 → 原生桥；桥不可用/失败 → 回退插件）。
 *
 * 注意：utils/platform 的 isMobile() 按 UA 缓存，本文件顶部先把 UA 固定为
 * Android（文件内所有用例都按移动端跑；vitest 每个文件独立模块注册表，不外泄）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendNotification } from '@tauri-apps/plugin-notification';
import {
  parseDeepLinkJson,
  takePendingDeepLink,
  clearPendingDeepLink,
} from '../../src/services/deepLinkService';
import { notify, notifyNewMessage } from '../../src/services/notificationService';

// 本文件所有用例按移动端跑：先固定 Android UA，再触发任何 isMobile() 调用
vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
);

/** 构造挂在 window 上的原生桥 mock（每次用例独立实例） */
function installBridge(overrides: {
  postMessageNotification?: (...args: unknown[]) => unknown;
  takePendingDeepLink?: (...args: unknown[]) => unknown;
  clearPendingDeepLink?: (...args: unknown[]) => unknown;
} = {}) {
  const bridge = {
    postMessageNotification: vi.fn(overrides.postMessageNotification ?? (() => true)),
    takePendingDeepLink: vi.fn(overrides.takePendingDeepLink ?? (() => null)),
    clearPendingDeepLink: vi.fn(overrides.clearPendingDeepLink ?? (() => undefined)),
  };
  (window as unknown as { HuanvaeDeepLink: unknown }).HuanvaeDeepLink = bridge;
  return bridge;
}

function uninstallBridge(): void {
  delete (window as unknown as { HuanvaeDeepLink?: unknown }).HuanvaeDeepLink;
}

afterEach(() => {
  uninstallBridge();
  delete (window as unknown as { __huanvaeOnNotificationDeepLink?: unknown })
    .__huanvaeOnNotificationDeepLink;
});

describe('deepLinkService.parseDeepLinkJson（最小字段集校验）', () => {
  it('合法 friend 深链', () => {
    expect(parseDeepLinkJson('{"sourceType":"friend","sourceId":"f123"}')).toEqual({
      sourceType: 'friend',
      sourceId: 'f123',
    });
  });

  it('合法 group 深链', () => {
    expect(parseDeepLinkJson('{"sourceType":"group","sourceId":"g456"}')).toEqual({
      sourceType: 'group',
      sourceId: 'g456',
    });
  });

  it('null/空串 → null', () => {
    expect(parseDeepLinkJson(null)).toBeNull();
    expect(parseDeepLinkJson('')).toBeNull();
  });

  it('坏 JSON → null（不抛）', () => {
    expect(parseDeepLinkJson('{not-json')).toBeNull();
  });

  it('sourceType 非法 → null', () => {
    expect(parseDeepLinkJson('{"sourceType":"channel","sourceId":"x"}')).toBeNull();
    expect(parseDeepLinkJson('{"sourceId":"x"}')).toBeNull();
  });

  it('sourceId 缺失/非字符串/空串 → null', () => {
    expect(parseDeepLinkJson('{"sourceType":"friend"}')).toBeNull();
    expect(parseDeepLinkJson('{"sourceType":"friend","sourceId":123}')).toBeNull();
    expect(parseDeepLinkJson('{"sourceType":"friend","sourceId":""}')).toBeNull();
  });

  it('多余字段被剥掉（不进路由）', () => {
    const raw = '{"sourceType":"friend","sourceId":"f1","content":"secret"}';
    expect(parseDeepLinkJson(raw)).toEqual({ sourceType: 'friend', sourceId: 'f1' });
  });
});

describe('deepLinkService.takePendingDeepLink / clearPendingDeepLink', () => {
  it('有桥：返回解析后的深链', () => {
    installBridge({
      takePendingDeepLink: vi.fn().mockReturnValue('{"sourceType":"group","sourceId":"g1"}'),
    });
    expect(takePendingDeepLink()).toEqual({ sourceType: 'group', sourceId: 'g1' });
  });

  it('无桥：takePendingDeepLink 返回 null、clearPendingDeepLink 不抛', () => {
    expect(takePendingDeepLink()).toBeNull();
    expect(() => clearPendingDeepLink()).not.toThrow();
  });

  it('桥返回垃圾数据 → null', () => {
    installBridge({ takePendingDeepLink: vi.fn().mockReturnValue('garbage') });
    expect(takePendingDeepLink()).toBeNull();
  });

  it('桥方法抛异常 → null（不向上抛）', () => {
    installBridge({
      takePendingDeepLink: vi.fn().mockImplementation(() => {
        throw new Error('bridge gone');
      }),
    });
    expect(takePendingDeepLink()).toBeNull();
  });

  it('clearPendingDeepLink 调用桥方法（登出/切账号清理）', () => {
    const bridge = installBridge();
    clearPendingDeepLink();
    expect(bridge.clearPendingDeepLink).toHaveBeenCalledTimes(1);
  });
});

describe('notify 深链发布路由（移动端）', () => {
  beforeEach(() => {
    vi.mocked(sendNotification).mockClear();
  });

  it('带深链 + 桥可用：走原生桥，不走插件 sendNotification', async () => {
    const bridge = installBridge();

    await notify({
      title: '小明',
      body: '你好',
      channelId: 'huanvae_messages',
      deepLink: { sourceType: 'friend', sourceId: 'f9' },
    });

    expect(bridge.postMessageNotification).toHaveBeenCalledTimes(1);
    expect(bridge.postMessageNotification).toHaveBeenCalledWith(
      '小明',
      '你好',
      'huanvae_messages',
      '{"sourceType":"friend","sourceId":"f9"}',
    );
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('桥发布失败（返回 false）：回退插件 sendNotification', async () => {
    installBridge({ postMessageNotification: vi.fn().mockReturnValue(false) });

    await notify({
      title: '小明',
      body: '你好',
      channelId: 'huanvae_messages',
      deepLink: { sourceType: 'friend', sourceId: 'f9' },
    });

    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification).toHaveBeenCalledWith({
      title: '小明',
      body: '你好',
      channelId: 'huanvae_messages',
    });
  });

  it('桥不可用：回退插件 sendNotification', async () => {
    await notify({
      title: '小明',
      body: '你好',
      channelId: 'huanvae_messages',
      deepLink: { sourceType: 'friend', sourceId: 'f9' },
    });

    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it('不带深链：不碰桥，直接走插件（系统类通知行为不变）', async () => {
    const bridge = installBridge();

    await notify({ title: 'Huanvae Chat', body: '入群申请', channelId: 'huanvae_system' });

    expect(bridge.postMessageNotification).not.toHaveBeenCalled();
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });
});

describe('notifyNewMessage 深链载荷（C1：最小字段集）', () => {
  beforeEach(() => {
    vi.mocked(sendNotification).mockClear();
  });

  it('好友消息：桥收到的深链 = { sourceType:"friend", sourceId:<好友ID> }', async () => {
    const bridge = installBridge();

    await notifyNewMessage({
      sourceType: 'friend',
      sourceId: 'friend-abc',
      senderName: '小明',
      messageType: 'text',
      content: '饭了吗',
      activeChat: null,
    });

    expect(bridge.postMessageNotification).toHaveBeenCalledTimes(1);
    const [, , channel, deepLinkJson] = bridge.postMessageNotification.mock.calls[0] as [
      string,
      string,
      string,
      string,
    ];
    expect(channel).toBe('huanvae_messages');
    expect(parseDeepLinkJson(deepLinkJson)).toEqual({
      sourceType: 'friend',
      sourceId: 'friend-abc',
    });
    // 消息内容绝不进深链载荷
    expect(deepLinkJson).not.toContain('饭了吗');
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('群消息：桥收到的深链 = { sourceType:"group", sourceId:<群ID> }', async () => {
    const bridge = installBridge();

    await notifyNewMessage({
      sourceType: 'group',
      sourceId: 'group-xyz',
      senderName: '小刚',
      groupName: '摸鱼群',
      messageType: 'text',
      content: '开饭',
      activeChat: null,
    });

    expect(bridge.postMessageNotification).toHaveBeenCalledTimes(1);
    const deepLinkJson = bridge.postMessageNotification.mock.calls[0][3] as string;
    expect(parseDeepLinkJson(deepLinkJson)).toEqual({
      sourceType: 'group',
      sourceId: 'group-xyz',
    });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('当前活跃会话的消息：不发通知也不碰桥（既有行为）', async () => {
    const bridge = installBridge();

    await notifyNewMessage({
      sourceType: 'friend',
      sourceId: 'friend-abc',
      senderName: '小明',
      messageType: 'text',
      content: 'hi',
      activeChat: { type: 'friend', id: 'friend-abc' },
    });

    expect(bridge.postMessageNotification).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
