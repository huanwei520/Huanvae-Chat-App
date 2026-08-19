import { Page } from '@playwright/test';

/**
 * 把 Tauri API 桩注入浏览器上下文。必须在导航**之前**经 page.addInitScript() 调用。
 *
 * 让 web 层在没有 Tauri runtime 的普通浏览器里跑起来。Tauri 原生能力（文件系统、通知等）
 * 由 vitest + jsdom mock 单独覆盖。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 2026-08-19 重写的原因（写清楚，否则下一个人还会照着过期的判断改）
 *
 * 旧版本把 `plugin:http|*` 统一桩成 **502**，并在 settings.spec.ts 的注释里写
 * 「登录走不通是因为 tauri-mock 返回 502」。**这个判断已经过期**：
 *
 *   - 数据面早已从 `@tauri-apps/plugin-http` 迁到 `invoke('secure_http')`
 *     （src/services/secureFetch.ts —— `invoke<SecureHttpResp>('secure_http', …)`）；
 *   - 旧 mock 对 `secure_http` **没有任何分支** ⇒ 落到「未列出的命令 → 返回 null」；
 *   - 于是 secureFetch 拿到 `null` 去读 `.status` ⇒ 抛 `Cannot read properties of null`，
 *     发现面（discovery）在 DEV 构建下 fail-loud ⇒ 整条数据面在 e2e 里**从第一跳就断了**。
 *
 * 也就是说：e2e 从来没有能力跑到「登录」以后的任何东西，而**这与 502 无关**。
 * `plugin:http` 在 src/ 里只剩 3 处引用（huanvaeGuard/localApi.ts 回环、nfc/executor.ts
 * 任意外链、secureFetch.ts 的一句注释），登录路径一处都不经过它。
 *
 * ⇒ 本文件现在提供一个**极小但真实**的假后端（`secure_http` 路由表），让 e2e 能驱动
 *   真实的登录链路：发现面 → 探活 → POST /api/auth/login → GET /api/profile。
 *   `plugin:http` 的 502 桩保留（那 3 处非登录路径走到它时应当**可见地**失败）。
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 覆盖范围：
 * - 应用启动相关（窗口/配置/更新）
 * - `secure_http` 数据面假后端（见 SCENARIO）
 * - plugin-store / plugin-sql / plugin-os / plugin-fs / plugin-dialog / plugin-notification
 * - `transformCallback`（`@tauri-apps/api/event` 的 listen() 依赖它；旧版**没有**，
 *   导致每次页面加载都抛两次 `transformCallback is not a function`）
 * - 业务命令桩（账号存储 / 会话锁 / 设备信息 / 反代 / 文件缓存）
 *
 * 凡未列出的 invoke 命令均返回 null，并在 console.debug 打印，便于排查。
 *
 * **调用记录**：所有 invoke 都被记进 `window.__E2E_INVOKES__`，`secure_http` 另记进
 * `window.__E2E_HTTP__`（`{method,url,body}`）。测试可据此断言「请求真的离开了 App」——
 * 这比「屏幕上出现了某段文字」更贴近被测对象本身。
 */

/** 假后端行为场景。默认 `default` = 一切成功。 */
export type TauriMockScenario =
  /** 登录 / 取资料 全部返回 200 */
  | 'default'
  /** POST /api/auth/login 返回 401 + `{error:"账号或密码错误"}` */
  | 'bad-credentials'
  /** 发现面 ca.huanvae.cn 返回 503（数据面从第一跳就断） */
  | 'discovery-down';

export interface TauriMockOptions {
  scenario?: TauriMockScenario;
}

/** 假后端使用的保留地址：TEST-NET-3（RFC 5737）+ `.test` 保留 TLD，绝不会打到真实主机。 */
export const MOCK_BACKEND_IP = '203.0.113.10';
export const MOCK_BACKEND_DOMAIN = 'e2e-backend.huanvae.test';

export function tauriMockScript(options: TauriMockOptions = {}): string {
  const scenario = options.scenario ?? 'default';
  return `
    (() => {
      const SCENARIO = ${JSON.stringify(scenario)};
      const BACKEND_IP = ${JSON.stringify(MOCK_BACKEND_IP)};
      const BACKEND_DOMAIN = ${JSON.stringify(MOCK_BACKEND_DOMAIN)};

      // ── 调用记录（供测试断言「请求真的发出去了」）──
      const invokeLog = [];
      const httpLog = [];
      window.__E2E_INVOKES__ = invokeLog;
      window.__E2E_HTTP__ = httpLog;

      const jsonResp = (status, obj) => ({
        status: status,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(obj),
      });
      const textResp = (status, text) => ({
        status: status,
        headers: { 'content-type': 'text/plain' },
        body: text,
      });

      // ── 假后端路由表（对齐 src 侧真实端点）──
      // GET  https://ca.huanvae.cn/endpoints  发现配置（src/services/discovery.ts CA_ENDPOINT）
      // GET  https://<ip>:<port>/health        探活（discovery.ts PROBE_PATH）
      // POST <serverUrl>/api/auth/login        src/api/auth.ts login()
      // GET  <serverUrl>/api/profile           src/api/auth.ts getProfile()
      const routeSecureHttp = (req) => {
        let u;
        try {
          u = new URL(req.url);
        } catch (e) {
          return jsonResp(400, { error: 'e2e-mock: bad url ' + req.url });
        }
        const path = u.pathname;

        if (u.hostname === 'ca.huanvae.cn' && path === '/endpoints') {
          if (SCENARIO === 'discovery-down') {
            return jsonResp(503, { error: 'e2e-mock: discovery down' });
          }
          return jsonResp(200, {
            ips: [BACKEND_IP],
            port: 443,
            domains: [BACKEND_DOMAIN],
            ca_pem: '',
            ttl: 600,
          });
        }

        if (path === '/health') {
          return textResp(200, 'OK');
        }

        if (path === '/api/auth/login') {
          if (SCENARIO === 'bad-credentials') {
            return jsonResp(401, { error: '账号或密码错误' });
          }
          return jsonResp(200, {
            data: {
              access_token: 'e2e-access-token',
              refresh_token: 'e2e-refresh-token',
            },
          });
        }

        // ── 登录成功后落地首页会打的几个端点（ApiClient 解包 data.data）──
        if (path === '/api/friends') {
          return jsonResp(200, { success: true, code: 200, data: [] });
        }
        if (path === '/api/groups/my') {
          return jsonResp(200, { success: true, code: 200, data: [] });
        }
        if (path === '/api/friends/blacklist' || path === '/api/friends/presence') {
          return jsonResp(200, { success: true, code: 200, data: [] });
        }
        if (path === '/api/messages/sync') {
          return jsonResp(200, { success: true, code: 200, data: { conversations: [] } });
        }

        if (path === '/api/profile') {
          return jsonResp(200, {
            data: {
              user_id: 'e2euser',
              user_nickname: 'E2E 用户',
              user_email: null,
              user_signature: null,
              user_avatar_url: null,
              admin: 'false',
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-01T00:00:00Z',
            },
          });
        }

        // 未建模的端点：显式 404（不是 null）——让"走到没建模的地方"在 UI 上可见地失败，
        // 而不是变成又一次 "Cannot read properties of null"。
        return jsonResp(404, {
          error: 'e2e-mock: no route for ' + req.method + ' ' + path,
        });
      };

      // 🔴 @tauri-apps/plugin-os v2 的 platform()/version()/arch() 等是**同步**读全局
      //    window.__TAURI_OS_PLUGIN_INTERNALS__，**不走 invoke**。旧 mock 只桩了
      //    'plugin:os|platform' 这类 invoke 分支 —— 那是死代码，一次都不会被命中，
      //    真实表现是 getDeviceInfo() 抛 "Cannot read properties of undefined (reading 'platform')"。
      window.__TAURI_OS_PLUGIN_INTERNALS__ = {
        eol: '\\n',
        os_type: 'windows',
        platform: 'windows',
        family: 'windows',
        version: '10.0.22621',
        arch: 'x86_64',
        exe_extension: '.exe',
      };

      // @tauri-apps/api/event 的 unlisten() 同步读这个全局；缺它 ⇒ 组件卸载时抛
      // "Cannot read properties of undefined (reading 'unregisterListener')"。
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener: () => {},
      };

      window.__TAURI_INTERNALS__ = {
        invoke: async (cmd, args) => {
          invokeLog.push({ cmd: cmd, args: args });

          // ── 数据面：secure_http 假后端 ──
          if (cmd === 'secure_http') {
            const req = (args && args.req) || {};
            httpLog.push({ method: req.method, url: req.url, body: req.body });
            return routeSecureHttp(req);
          }
          // 流式（AI SSE）——e2e 不驱动它，返回空
          if (cmd === 'secure_http_stream') return null;

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
            'plugin:os|hostname': 'e2e-host',
          };
          if (cmd in startupMocks) return startupMocks[cmd];

          // plugin-event（listen/unlisten/emit）—— 注册不炸，事件永不触发
          if (cmd.startsWith('plugin:event|')) return null;

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
          if (cmd.startsWith('plugin:dialog|')) return null;

          // plugin-notification
          if (cmd.startsWith('plugin:notification|')) {
            const op = cmd.split('|')[1];
            if (op === 'is_permission_granted') return true;
            if (op === 'request_permission') return 'granted';
            return null;
          }

          // plugin-http —— 登录路径**不经过**它（数据面走 secure_http）。
          // 保留 502：huanvaeGuard 回环 / nfc 外链若在 e2e 里被走到，应当可见地失败。
          if (cmd.startsWith('plugin:http|')) {
            return {
              status: 502,
              statusText: 'Bad Gateway',
              url: (args && args.url) || '',
              headers: {},
              body: [],
            };
          }

          // plugin-process / plugin-updater
          if (cmd.startsWith('plugin:process|')) return undefined;
          if (cmd.startsWith('plugin:updater|')) return null;

          // ── 本地 SQLite（Rust 命令 db_*，见 src/db/index.ts）──
          // 🔴 返回值形状必须对：这些命令**没有**桩时旧 mock 返回 null，而调用方直接
          //    rows.map(...) / for (const x of rows) ⇒ 落地首页立刻抛
          //    "Cannot read properties of null (reading 'map')" / "rows is not iterable"。
          //    列表类一律 []，写入类一律 null。
          if (cmd === 'db_init' || cmd === 'set_current_user' || cmd === 'clear_current_user') {
            return null;
          }
          if (cmd.startsWith('db_')) {
            // 读列表 → 空数组；单条读 → null；写 → null
            const listReads = [
              'db_get_conversations',
              'db_get_conversation_previews',
              'db_get_messages',
              'db_get_friends',
              'db_get_groups',
              'db_get_group_read_positions',
              'db_search_messages',
              'db_nfc_list_trusted',
            ];
            if (listReads.indexOf(cmd) >= 0) return [];
            if (cmd === 'db_get_conversation_peer_read_seq') return 0;
            if (cmd === 'db_nfc_is_trusted') return false;
            return null;
          }

          // WebSocket（Rust 侧 ws_* 命令）—— 连接"建立"但永不推事件
          if (cmd === 'ws_connect') return 1;
          if (cmd.startsWith('ws_')) return null;

          // 业务命令（账号存储 / 会话锁 / 设备信息 / 反代 / 文件缓存）
          const businessMocks = {
            'get_device_info': {
              deviceInfo: 'TEST-DEVICE - Windows 10.0.22621 (x86_64)',
              macAddress: '00:11:22:33:44:55',
            },
            'get_mac_address': '00:11:22:33:44:55',
            'get_mac_address_cmd': '00:11:22:33:44:55',
            'check_session_conflict': { canProceed: true, message: null },
            'check_session_lock': { exists: false, process_alive: false, pid: null },
            'create_session_lock': null,
            'remove_session_lock': null,
            'get_saved_accounts': [],
            'get_account_password': null,
            'save_account': null,
            'delete_account': null,
            'update_account_nickname': null,
            'update_account_avatar': null,
            'touch_account_login': null,
            'ensure_secure_proxy': 0,
            'set_proxy_target': null,
            'close_child_windows': null,
            'get_app_version': '0.0.0-e2e',
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

        // @tauri-apps/api/event 的 listen() 依赖 transformCallback 注册回调。
        // 旧版本没有它 ⇒ 每次页面加载抛两次 "transformCallback is not a function"。
        transformCallback: (() => {
          let callbackId = 0;
          return (callback, once) => {
            const id = ++callbackId;
            Object.defineProperty(window, '_' + id, {
              value: (result) => {
                if (once) {
                  delete window['_' + id];
                }
                return callback && callback(result);
              },
              writable: false,
              configurable: true,
            });
            return id;
          };
        })(),

        convertFileSrc: (path) => 'https://mock-asset/' + path,
        metadata: {
          currentWebview: { windowLabel: 'main' },
          currentWindow: { label: 'main' },
        },
      };

      // Mock Tauri event system
      window.__TAURI_INTERNALS__.listeners = new Map();
      window.__TAURI_INTERNALS__.invoke_key = 0;
    })();
  `;
}

/**
 * Setup Tauri mocks on a page before navigation.
 */
export async function setupTauriMocks(page: Page, options: TauriMockOptions = {}): Promise<void> {
  await page.addInitScript(tauriMockScript(options));
}
