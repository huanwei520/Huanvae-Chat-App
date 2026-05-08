import { Page } from '@playwright/test';

/**
 * Inject Tauri API mocks into the browser context.
 * Must be called via page.addInitScript() BEFORE navigation.
 *
 * This allows the web layer to run in a plain browser without the Tauri runtime,
 * covering ~95% of UI logic. Tauri-native features (file system, notifications, etc.)
 * are tested separately via Vitest with jsdom mocks.
 *
 * 覆盖范围（Step B 扩充）：
 * - 应用启动相关（窗口/配置/更新）
 * - plugin-store（移动端会话持久化检查）
 * - plugin-sql（本地数据库操作 — 全部 no-op）
 * - plugin-os（platform/version 探测）
 * - plugin-fs（基础读写）
 * - 设备信息 / 会话锁等业务命令
 *
 * 凡未列出的 invoke 命令均返回 null，并在调试模式下打印；这样组件渲染不会因调用未知命令而抛异常。
 */
export function tauriMockScript(): string {
  return `
    // Mock Tauri internals so @tauri-apps/* imports don't throw
    window.__TAURI_INTERNALS__ = {
      invoke: async (cmd, args) => {
        // 应用启动 / 全局配置
        const startupMocks = {
          'get_app_config': { theme: 'light', language: 'zh-CN' },
          'get_user_info': null,
          'check_update': null,
          'plugin:window-state|restore_state': undefined,
          'plugin:window-state|save_window_state': undefined,
          'plugin:os|platform': 'windows',
          'plugin:os|version': '10.0.22621',
          'plugin:os|arch': 'x86_64',
        };
        if (cmd in startupMocks) return startupMocks[cmd];

        // plugin-store（会话持久化、账号列表存储）— 全部空数据
        if (cmd.startsWith('plugin:store|')) {
          const op = cmd.split('|')[1];
          if (op === 'load') return null;
          if (op === 'get') return null;
          if (op === 'has') return false;
          if (op === 'keys') return [];
          if (op === 'entries') return [];
          if (op === 'values') return [];
          if (op === 'length') return 0;
          // set/save/delete/clear/reset 等写操作 → no-op
          return undefined;
        }

        // plugin-sql（本地 SQLite 操作）
        if (cmd.startsWith('plugin:sql|')) {
          const op = cmd.split('|')[1];
          if (op === 'load') return 'mock-db';
          if (op === 'select') return [];
          if (op === 'execute') return { rowsAffected: 0, lastInsertId: 0 };
          if (op === 'close') return true;
          return null;
        }

        // plugin-fs（文件读写）
        if (cmd.startsWith('plugin:fs|')) {
          const op = cmd.split('|')[1];
          if (op === 'exists') return false;
          if (op === 'read_dir') return [];
          if (op === 'read_file' || op === 'read_text_file') return '';
          // mkdir/write 等写操作 → no-op
          return undefined;
        }

        // plugin-dialog（文件选择 — 测试不主动触发）
        if (cmd.startsWith('plugin:dialog|')) {
          return null;
        }

        // plugin-notification
        if (cmd.startsWith('plugin:notification|')) {
          const op = cmd.split('|')[1];
          if (op === 'is_permission_granted') return true;
          if (op === 'request_permission') return 'granted';
          return null;
        }

        // plugin-http（HTTP 请求 — 模拟服务器不可达，避免登录请求挂起）
        if (cmd.startsWith('plugin:http|')) {
          // 返回 502，让前端走错误分支不阻塞 UI
          return {
            status: 502,
            statusText: 'Bad Gateway',
            url: args?.url ?? '',
            headers: {},
            body: [],
          };
        }

        // plugin-process / plugin-updater
        if (cmd.startsWith('plugin:process|')) return undefined;
        if (cmd.startsWith('plugin:updater|')) return null;

        // 业务命令（设备信息 / 头像 / 会话锁 / 文件缓存）
        const businessMocks = {
          'get_device_info': {
            deviceInfo: 'TEST-DEVICE - Windows 10.0.22621 (x86_64)',
            macAddress: '00:11:22:33:44:55',
          },
          'get_mac_address': '00:11:22:33:44:55',
          'check_session_conflict': { canProceed: true, message: null },
          'create_session_lock': null,
          'remove_session_lock': null,
          'is_file_cached': false,
          'get_cached_file_path': null,
          'get_local_video_url': null,
          'show_in_folder': undefined,
          'copy_file_to_cache': '',
          'download_and_save_file': '',
        };
        if (cmd in businessMocks) return businessMocks[cmd];

        // 未列出的命令 → 静默 null，便于排查
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
