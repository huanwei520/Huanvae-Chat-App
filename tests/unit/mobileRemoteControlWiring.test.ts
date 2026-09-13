/**
 * 移动端远控授权链接线契约（静态扫描）
 *
 * 守的是「只有真机才看得见、渲染断言测不出」的两条不变量（2026-09-13 弹窗缺失
 * 诊断的固化门禁；根因链见 commit fabfb094）：
 *
 *  A. 移动端会议页必须挂载 MeetingBridge（授权弹层 + 「正在被控制」横幅）。
 *     1.1.45 及之前 MobileMeetingPage 从未挂载 —— N1 送达 JS、事件已发、
 *     弹层组件不存在，安卓/iOS 上弹窗结构性缺失（桌面 MeetingPage 正常）。
 *
 *  B. App.tsx 的 MainBridge（RC_AUTH_DECISION → M2 上行 / RC_REQUEST_CONTROL →
 *     M1 上行）必须全平台挂载，禁止 !isMobile() 一类平台排除。
 *     此前移动端被排除：弹层「接受」后事件无人监听，M2 永不上行，授权链断在主窗桥。
 *
 * 与 videoPosterWiring 同款口径：断言在【剥掉注释的代码】上做（注释里正当引用
 * 关键词不应判过/判挂）。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const repoRoot = resolve(__dirname, '../..');
const mobileMeetingPage = stripComments(
  readFileSync(resolve(repoRoot, 'src/pages/mobile/MobileMeetingPage.tsx'), 'utf8'),
);
const appTsx = stripComments(readFileSync(resolve(repoRoot, 'src/App.tsx'), 'utf8'));

describe('移动端远控授权链接线（静态扫描）', () => {
  it('A. MobileMeetingPage 挂载 MeetingBridge，且经 isRemoteControlEnabled 门控', () => {
    expect(mobileMeetingPage).toContain('MeetingBridge');
    expect(mobileMeetingPage).toMatch(/isRemoteControlEnabled\(\)\s*&&\s*\(?\s*<MeetingBridge/);
  });

  it('B1. App.tsx 挂载 RemoteControlMainBridge 且无平台排除', () => {
    expect(appTsx).toContain('<RemoteControlMainBridge />');
    // 平台排除回归：!isMobile() 不得再出现在 MainBridge 挂载行的同一语句里
    const lines = appTsx.split('\n');
    const mount = lines.findIndex((l) => l.includes('<RemoteControlMainBridge />'));
    expect(mount).toBeGreaterThanOrEqual(0);
    expect(lines[mount]).not.toMatch(/isMobile\(\)\s*&&/);
    expect(lines[mount - 1] ?? '').not.toMatch(/\{!isMobile\(\)\s*&&\s*$/);
  });

  it('B2. MainBridge 自身保持平台无关（不 import 平台判定、不渲染 UI）', () => {
    const bridge = stripComments(
      readFileSync(resolve(repoRoot, 'src/remote-control/mainBridge.tsx'), 'utf8'),
    );
    expect(bridge).not.toMatch(/from\s+'[^']*platform'/);
    expect(bridge).toMatch(/return\s+null/);
  });
});
