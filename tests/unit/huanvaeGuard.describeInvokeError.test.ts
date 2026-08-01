/**
 * describeInvokeError 单元测试（src/huanvaeGuard/index.ts）
 *
 * 该函数是「invoke 失败原因不再被吞掉」这条链路的第一环：
 * openHuanvaeGuardWindow 里 hg_ensure_installed 失败时，用它把抛出物转成
 * 可展示文本，再经 URL query `installError` 透传给 HG 页显示成错误横幅。
 * 因此它必须覆盖 Tauri 抛出物的三种真实形态：
 *   1. Rust 侧 `Err(String)` —— 以**裸字符串**抛出（最主要的真实场景，中文原因原样透传）
 *   2. JS 侧异常 —— `Error` 实例（含子类），只取 message，不带 "Error: " 前缀
 *   3. 其余任意值 —— 落到 String(e)
 *
 * 注：本文件 import 的 src/huanvaeGuard/index.ts 会连带加载 HuanvaeGuardPage
 * （模块内 `export { default as HuanvaeGuardPage }`）及其 Tauri 依赖，
 * 故在此把 @tauri-apps/plugin-os 的四个导出全部本地 mock（tests/setup.ts 虽已全局 mock，
 * 但这里显式钉死 macos，避免依赖全局默认值）。
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-os', () => ({
  platform: () => 'macos',
  arch: () => 'aarch64',
  version: () => '15.0.0',
  hostname: () => 'test-host',
}));

import { describeInvokeError } from '../../src/huanvaeGuard/index';

describe('describeInvokeError', () => {
  // ── 分支 1：Tauri command 的 Err(String) 以裸字符串抛出 ──
  it('Rust 侧 Err(String) 的中文原因原样返回（不加任何包装）', () => {
    const rustReason =
      '安装 macOS VPN 服务需要本机管理员密码，本次授权被取消了。请重试并在弹出的系统提示中输入管理员密码后点「好」。';

    expect(describeInvokeError(rustReason)).toBe(rustReason);
  });

  it('空字符串原样返回（openHuanvaeGuardWindow 用 !== "" 判定是否带 installError，不能被转成 "undefined" 之类）', () => {
    expect(describeInvokeError('')).toBe('');
  });

  // ── 分支 2：Error 实例只取 message ──
  it('Error 实例只取 message，不带 "Error: " 前缀', () => {
    const e = new Error('window creation failed');

    expect(describeInvokeError(e)).toBe('window creation failed');
    expect(describeInvokeError(e)).not.toBe(String(e)); // String(e) === 'Error: window creation failed'
  });

  it('Error 子类同样走 message 分支（instanceof 覆盖子类）', () => {
    expect(describeInvokeError(new TypeError('invoke is not a function'))).toBe(
      'invoke is not a function',
    );
  });

  // ── 分支 3：其余任意值走 String() ──
  // 显式标成 [unknown, string][]，否则各 case 的字面量类型会推成联合类型、撞上 it.each 的数组重载
  const fallbackCases: [label: string, value: unknown, expected: string][] = [
    ['null', null, 'null'],
    ['undefined', undefined, 'undefined'],
    ['数字', -128, '-128'],
    ['普通对象', { code: 500 }, '[object Object]'],
    // 自定义 toString：String(e) 会取它；换成 JSON.stringify 之类实现就会挂
    ['自定义 toString 的对象', { toString: () => 'osascript exited with 1' }, 'osascript exited with 1'],
  ];

  it.each(fallbackCases)('非字符串非 Error 走 String()：%s', (_label, value, expected) => {
    expect(describeInvokeError(value)).toBe(expected);
  });
});
