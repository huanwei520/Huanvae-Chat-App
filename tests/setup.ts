/**
 * 测试全局设置
 *
 * 在所有测试运行前执行：
 * - 配置 Testing Library
 * - Mock Tauri API
 * - 设置全局变量
 */

import '@testing-library/jest-dom';
import { vi } from 'vitest';
import { configure } from '@testing-library/react';
import { MotionGlobalConfig } from 'framer-motion';

// Skip animation rendering but preserve component state logic
// (variants, exit callbacks, AnimatePresence mount/unmount timing)
MotionGlobalConfig.skipAnimations = true;

// ── waitFor / findBy* 的等待预算（asyncUtilTimeout）──
//
// RTL 默认 1000ms（`@testing-library/dom/dist/config.js:15`）。它是一条**固定墙钟死线**：
// `waitFor` 真定时器分支只挂一个 `setTimeout(handleTimeout, timeout)`
// （`@testing-library/dom/dist/wait-for.js:40`），到点即判负。
//
// 而它等待的那件事——AnimatePresence 退场卸载——耗时是**随 CPU 争用线性放大**的：
// 一次卸载要走 rAF 帧（motion 的 frameloop 由 `requestAnimationFrame` 驱动，
// `motion-dom/dist/es/frameloop/frame.mjs:4`；vitest 的 jsdom 默认
// `pretendToBeVisual: true` 所以 rAF 存在）→ React 提交 → DOM 变更 → MutationObserver。
// 「工作量随争用放大、死线不随争用放大」⇒ 全量高负载时尾部必然穿透死线。
//
// 本机实测（2026-08-11，8 vCPU + virtiofs 共享卷）同一处退场卸载耗时：
//   空载单文件跑：22.5 / 28.9 / 31.8 / 26.7 / 21.0 ms      （对 1000ms 有 ~35x 余量）
//   全量并发负载：67.5 / 72.0 / 78.9 / 87.6 / 103.2 / 105.6 / 246.2 / **1662.1** ms
// 最后那个 1662.1ms 已越过 1000ms 死线 —— 这就是 OAuthClientsPanel
// 「创建成功…」用例在全量下偶发翻红、单文件恒绿的**唯一**成因（非产品 bug：
// `OAuthClientsPanel.tsx` 的 `setShowCreate(false)` 确实调了，只是卸载没赶上死线）。
//
// 取 5000ms = 实测负载峰值(1662ms)的 ~3x 余量，且仍 < `vitest.config.ts` 的
// `testTimeout: 10000`（失败用例第一个 waitFor 超时即抛出，单个用例最多付一次
// 5s，不会顶穿 testTimeout 而丢掉有信息量的报错）。
//
// 🔴 这只放宽「异步卸载要等多久」的时间预算，**不弱化任何断言**：
//    - 绿路径零成本 —— waitFor 一旦回调通过就立即返回（50ms 轮询 + MutationObserver），
//      不会因为死线变长而变慢（实测全量 `tests` 段耗时改前后同量级）；
//    - 只有**真正该失败**的用例才多等，结论不变、只是报错来得晚一些。
configure({ asyncUtilTimeout: 5000 });

// ============================================
// Mock Tauri API
// ============================================

// Mock @tauri-apps/api
// Channel 必须是**可 new 的 class**：src/update/service.ts 用 `new Channel<T>()` 驱动
// Rust 侧分片下载器的进度回调。写成箭头 vi.fn() 会在 `new` 时行为不符合构造函数契约
// （同 ResizeObserver 那条教训）。工厂里漏了它，任何 import 链碰到 service.ts 的测试
// 都会报 `No "Channel" export is defined on the mock`。
// 🔴 class 定义在工厂内部：vi.mock 会被提升到文件顶部，引用外层变量必 ReferenceError。
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage: ((msg: unknown) => void) | null = null;
    id = 1;
  },
}));

// Mock @tauri-apps/plugin-updater
vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn().mockResolvedValue(null),
}));

// Mock @tauri-apps/plugin-process
vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: vi.fn(),
}));

// Mock @tauri-apps/plugin-notification
vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: vi.fn().mockResolvedValue(true),
  requestPermission: vi.fn().mockResolvedValue('granted'),
  sendNotification: vi.fn(),
}));

// Mock @tauri-apps/plugin-fs
vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  exists: vi.fn().mockResolvedValue(false),
  mkdir: vi.fn(),
  readDir: vi.fn().mockResolvedValue([]),
}));

// Mock @tauri-apps/plugin-http
vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

// Mock @tauri-apps/plugin-os
// 默认返回 'windows'（桌面端测试默认走桌面分支）；测试中需要 Android 路径时
// 用 `vi.mocked(platform).mockReturnValue('android')` 局部覆盖
vi.mock('@tauri-apps/plugin-os', () => ({
  platform: vi.fn(() => 'windows'),
  arch: vi.fn(() => 'x86_64'),
  version: vi.fn(() => '10.0.26200'),
  hostname: vi.fn(() => 'test-host'),
}));

// Mock @tauri-apps/plugin-nfc
// scan() 默认 mockResolvedValue 一张空 records 卡（具体测试用例可 mockReturnValueOnce 覆盖）
vi.mock('@tauri-apps/plugin-nfc', () => ({
  scan: vi.fn().mockResolvedValue({
    id: [0x04, 0x12, 0x34, 0x56],
    kind: ['android.nfc.tech.Ndef'],
    records: [],
  }),
  isAvailable: vi.fn().mockResolvedValue(true),
  uriRecord: vi.fn((uri: string) => ({
    tnf: 1,
    kind: [0x55],
    id: [],
    payload: [0, ...Array.from(new TextEncoder().encode(uri))],
  })),
  write: vi.fn().mockResolvedValue(undefined),
}));

// Mock @tauri-apps/api/webviewWindow
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: vi.fn().mockImplementation(() => ({
    once: vi.fn(),
    listen: vi.fn(),
    emit: vi.fn(),
  })),
  getCurrentWebviewWindow: vi.fn().mockReturnValue({
    listen: vi.fn(),
    emit: vi.fn(),
  }),
}));

// Mock @tauri-apps/api/path
vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn().mockResolvedValue('/mock/app/data'),
  join: vi.fn().mockImplementation((...args: string[]) => args.join('/')),
}));

// Mock @tauri-apps/plugin-dialog
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
  save: vi.fn(),
  message: vi.fn(),
  ask: vi.fn(),
  confirm: vi.fn(),
}));

// Mock @tauri-apps/plugin-clipboard-manager
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: vi.fn(),
  readText: vi.fn().mockResolvedValue(''),
}));

// Mock @tauri-apps/api/window
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn().mockReturnValue({
    currentMonitor: vi.fn().mockResolvedValue({
      name: 'Test Monitor',
      size: { width: 1920, height: 1080 },
      position: { x: 0, y: 0 },
      scaleFactor: 1.0,
    }),
    scaleFactor: vi.fn().mockResolvedValue(1.0),
    innerSize: vi.fn().mockResolvedValue({ width: 1024, height: 768 }),
    outerSize: vi.fn().mockResolvedValue({ width: 1024, height: 768 }),
    setSize: vi.fn().mockResolvedValue(undefined),
    center: vi.fn().mockResolvedValue(undefined),
    onResized: vi.fn(),
    onScaleChanged: vi.fn(),
  }),
}));

// Mock @tauri-apps/api/dpi
vi.mock('@tauri-apps/api/dpi', () => ({
  LogicalSize: vi.fn().mockImplementation((width: number, height: number) => ({
    type: 'Logical',
    width,
    height,
  })),
  PhysicalSize: vi.fn().mockImplementation((width: number, height: number) => ({
    type: 'Physical',
    width,
    height,
  })),
}));

// ============================================
// Mock Browser APIs
// ============================================

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock ResizeObserver（class 形式：dnd-kit 等库会 new ResizeObserver(...)，箭头实现不可 new）
class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

// Mock IntersectionObserver（class 形式：被测代码会 new IntersectionObserver(...)，箭头实现不可 new，
// 与上面 ResizeObserverMock 同款，见 .claude/rules/frontend-test.md「全局 DOM Observer mock 必须写成可构造 class」）。
// 语义不变：三个方法仍是不做任何事的 vi.fn()，不会自动回报可见性 —— 需要控制可见性的用例
// 自行 vi.stubGlobal 覆盖（如 tests/hooks/useStickToBottom.test.tsx）。
class IntersectionObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
globalThis.IntersectionObserver = IntersectionObserverMock as unknown as typeof IntersectionObserver;

// ============================================
// 全局测试配置
// ============================================

// 清理所有 mock
beforeEach(() => {
  vi.clearAllMocks();
});

// 控制台警告过滤（避免测试输出过于杂乱）
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  // 过滤掉已知的无害警告
  const message = args[0];
  if (
    typeof message === 'string' &&
    (message.includes('ReactDOM.render') ||
      message.includes('act(...)'))
  ) {
    return;
  }
  originalWarn.apply(console, args);
};
