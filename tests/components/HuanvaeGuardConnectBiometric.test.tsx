/**
 * HuanvaeGuardPage.handleConnect 打开 VPN 生物识别门禁契约（macOS Touch ID）
 *
 * 背景：macOS 上"打开 VPN"前若本机有 Touch ID 则优先生物识别（biometric_authenticate 命令）；
 * 通过或本机无 Touch ID（命令返回 'unavailable'，含 Windows/Linux）→ 继续 startTunnel；
 * 取消/失败 → invoke 抛错 → catch 内中止，不打开。
 *
 * 测试形式：源码静态扫描。原因：handleConnect 嵌在 HuanvaeGuardPage 重渲染组件中，触发它需
 * plugin-os / api/event / serverApi / localApi 全栈 mock + 走"选设备→点连接"UI，成本高；
 * 结构性断言足以锁"门禁在 startTunnel 之前、失败即中止"这条契约（运行时 Touch ID 需真机验证）。
 *
 * 与 tests/App/AppKeychainLogin.test.tsx 一致：vitest 下用 __dirname（import.meta.url 非 file:// 会抛错）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(
  resolve(__dirname, '../../src/huanvaeGuard/HuanvaeGuardPage.tsx'),
  'utf-8',
);

describe('HuanvaeGuardPage 打开 VPN 生物识别门禁', () => {
  it('handleConnect 内、且在 startTunnel 之前调用 biometric_authenticate（门禁在前）', () => {
    const idxConnect = SRC.indexOf('const handleConnect');
    const idxBio = SRC.indexOf("invoke('biometric_authenticate'");
    const idxStart = SRC.indexOf('localApi.startTunnel');
    expect(idxConnect).toBeGreaterThan(-1);
    expect(idxBio).toBeGreaterThan(idxConnect); // 在 handleConnect 声明之后
    expect(idxBio).toBeLessThan(idxStart); // 且在建立隧道之前（先验证后打开）
  });

  it('生物识别失败/取消即中止：catch 块内（专属错误文案后）有 return（不落到 startTunnel）', () => {
    // 锚定到 biometric 门禁专属错误文案的 catch 块；用 [^}] 限制不跨出 catch 块边界，
    // 确保断言的是「该 catch 块内部」存在 return（删掉本 catch 的 return → 块内无 return → FAIL，
    // 不会被下游 if(!config.private_key){...return} 等无关 return 误满足）。
    expect(SRC).toMatch(
      /catch\s*\{[^}]*setError\('需要 Touch ID 验证才能打开 VPN'\)[^}]*return;[^}]*\}/,
    );
  });
});
