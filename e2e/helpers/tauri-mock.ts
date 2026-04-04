import { Page } from '@playwright/test';

/**
 * Inject Tauri API mocks into the browser context.
 * Must be called via page.addInitScript() BEFORE navigation.
 *
 * This allows the web layer to run in a plain browser without the Tauri runtime,
 * covering ~95% of UI logic. Tauri-native features (file system, notifications, etc.)
 * are tested separately via Vitest with jsdom mocks.
 */
export function tauriMockScript(): string {
  return `
    // Mock Tauri internals so @tauri-apps/* imports don't throw
    window.__TAURI_INTERNALS__ = {
      invoke: async (cmd, args) => {
        const mocks = {
          'get_app_config': { theme: 'light', language: 'zh-CN' },
          'get_user_info': null,
          'check_update': null,
          'plugin:window-state|restore_state': undefined,
          'plugin:window-state|save_window_state': undefined,
        };
        if (cmd in mocks) return mocks[cmd];
        // Unknown commands return null silently
        console.debug('[tauri-mock] unhandled invoke:', cmd, args);
        return null;
      },
      convertFileSrc: (path) => 'https://mock-asset/' + path,
      metadata: {
        currentWebview: { windowLabel: 'main' },
        currentWindow: { label: 'main' },
      },
    };

    // Mock Tauri event system
    window.__TAURI_INTERNALS__.listeners = new Map();
    window.__TAURI_INTERNALS__.invoke_key = 0;
  `;
}

/**
 * Setup Tauri mocks on a page before navigation.
 */
export async function setupTauriMocks(page: Page): Promise<void> {
  await page.addInitScript(tauriMockScript());
}
