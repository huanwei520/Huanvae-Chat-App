/**
 * #7 控制目标能力门控（owner 2026-09-14 二次评审②）
 *
 * ## 病历（owner 原话要点）
 * 「控制目标未按平台能力过滤——Android tile 出现申请控制胶囊、Android 端弹出接受授权框，
 * 而控制 daemon 仅桌面端存在，Android 不可被控（目标筛选缺失）」
 *
 * 具体表现：安卓用户在自己 tile 上看到「申请控制」胶囊（点了必然失败），
 * 而且**对方真的能对安卓发起申请、安卓也真的弹出接受授权框并回 M2**——用户被引导完成
 * 一次永远不可能生效的授权。
 *
 * ## 判据（唯一真值源 = isControllablePlatform）
 * 只有 Windows / macOS / Linux 有 `hv-control-daemon`（服务化打包与安装器携带清单只有
 * 这三支）⇒ 只有它们可被控。Android / iOS / unknown / 字段缺席一律 false。
 *
 * 三个收口点必须用同一个判据（本文件逐一锁）：
 *   1. 桌面 tile 的胶囊 + 右键菜单（MeetingPage）
 *   2. 移动端 tile 的按钮（MobileMeetingPage → MobileControlPill）
 *   3. 接受授权弹层（MeetingBridge —— 弹层唯一宿主）
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isControllablePlatform, detectPlatform, _resetPlatformCache } from '../../src/utils/platform';

const repoRoot = resolve(__dirname, '../..');
function read(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('#7 目标能力门控 · 判据本身', () => {
  it('桌面三端可被控', () => {
    expect(isControllablePlatform('windows')).toBe(true);
    expect(isControllablePlatform('macos')).toBe(true);
    expect(isControllablePlatform('linux')).toBe(true);
  });

  it('移动端不可被控（daemon 不存在）', () => {
    expect(isControllablePlatform('android')).toBe(false);
    expect(isControllablePlatform('ios')).toBe(false);
  });

  it('unknown / 字段缺席一律不可被控（保守：不给必然失败的入口）', () => {
    expect(isControllablePlatform('unknown')).toBe(false);
    expect(isControllablePlatform(undefined)).toBe(false);
    expect(isControllablePlatform(null)).toBe(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    _resetPlatformCache();
  });
});

describe('#7 目标能力门控 · 本机是否可被控（授权弹层判据）', () => {
  beforeEach(() => _resetPlatformCache());

  /** 替换 navigator.userAgent 后重新判定（detectPlatform 带缓存 → 先 _resetPlatformCache） */
  function detectWithUA(ua: string): string {
    vi.stubGlobal('navigator', { userAgent: ua, maxTouchPoints: 0 });
    _resetPlatformCache();
    return detectPlatform();
  }

  it('安卓 WebView UA → android → 不可被控（本机不挂授权弹层）', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152 Mobile Safari/537.36';
    expect(detectWithUA(ua)).toBe('android');
    expect(isControllablePlatform(detectPlatform())).toBe(false);
  });

  it('Windows 桌面 UA → windows → 可被控', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152 Safari/537.36 Edg/152';
    expect(detectWithUA(ua)).toBe('windows');
    expect(isControllablePlatform(detectPlatform())).toBe(true);
  });

  it('macOS 桌面 UA → macos → 可被控', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
    expect(detectWithUA(ua)).toBe('macos');
    expect(isControllablePlatform(detectPlatform())).toBe(true);
  });
});

describe('#7 目标能力门控 · 三个收口点都用了同一判据', () => {
  const desktopPage = read('src/meeting/MeetingPage.tsx');
  const mobilePage = read('src/pages/mobile/MobileMeetingPage.tsx');
  const bridge = read('src/remote-control/meetingBridge.tsx');
  const platformUtil = read('src/utils/platform.ts');

  it('桌面 tile 胶囊：渲染条件含 isControllablePlatform(participant?.platform)', () => {
    expect(desktopPage).toMatch(
      /onClickControl\s*&&\s*isRemoteControlEnabled\(\)\s*\n?\s*&&\s*isControllablePlatform\(participant\?\.platform\)/,
    );
  });

  it('桌面右键菜单与胶囊同口径（data-rc-controllable 委托，不含裸「总是给」分支）', () => {
    expect(desktopPage).toMatch(/data-rc-controllable/);
    expect(desktopPage).toMatch(/controllable:\s*tile\?\.dataset\.rcControllable === 'true'/);
    expect(desktopPage).toMatch(/gridMenu\.controllable \?/);
  });

  it('移动端 tile 按钮：渲染条件含 isControllablePlatform(participant?.platform)', () => {
    expect(mobilePage).toMatch(
      /isRemoteControlEnabled\(\)\s*&&\s*onControlPill\s*\n?\s*&&\s*isControllablePlatform\(participant\?\.platform\)/,
    );
  });

  it('授权弹层：只在可控端成面（MeetingBridge 内唯一判据）', () => {
    expect(bridge).toMatch(/const controllableEnd = isControllablePlatform\(detectPlatform\(\)\)/);
    expect(bridge).toMatch(/\{controllableEnd && <ControlAuthPopup/);
    // 反向：不得存在无门控的裸弹层渲染
    expect(bridge).not.toMatch(/^\s*<ControlAuthPopup/m);
  });

  it('移动端仍挂载 MeetingBridge（弹层宿主不得按平台排除，见 mobileRemoteControlWiring）', () => {
    expect(mobilePage).toContain('MeetingBridge');
  });

  it('判据只有一处实现（禁止各调用点自己写平台白名单）', () => {
    expect(platformUtil).toMatch(/export function isControllablePlatform/);
    // 调用点不得各自列出三端字面量
    for (const [name, src] of [['MeetingPage', desktopPage], ['MobileMeetingPage', mobilePage], ['meetingBridge', bridge]]) {
      expect(src, `${name} 不应自己写平台白名单`).not.toMatch(/'macos'|"macos"/);
    }
  });
});
