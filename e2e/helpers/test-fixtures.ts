import { test as base, expect } from '@playwright/test';
import { setupTauriMocks, type TauriMockScenario } from './tauri-mock';

/**
 * 带 Tauri API 桩自动注入的测试 fixture。
 * 所有 E2E 测试都应从本文件 import { test, expect }，而不是直接从 @playwright/test。
 *
 * `tauriScenario` 是 Playwright 的 **option fixture**：spec 里用
 * `test.use({ tauriScenario: 'bad-credentials' })` 切换假后端行为，
 * 不写就是 `'default'`（一切成功）。见 tauri-mock.ts 的 TauriMockScenario。
 */
export const test = base.extend<{ tauriScenario: TauriMockScenario }>({
  tauriScenario: ['default', { option: true }],

  page: async ({ page, tauriScenario }, use) => {
    await setupTauriMocks(page, { scenario: tauriScenario });
    await use(page);
  },
});

export { expect };
