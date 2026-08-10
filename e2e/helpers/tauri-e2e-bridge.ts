import { Page } from '@playwright/test';

/**
 * real-e2e(L2.5-web) 专用 Tauri 桥 —— 与 tauri-mock.ts（纯 mock，数据面统一 502）职责不同：
 *
 * 数据面（HTTP/WS）**不经过本文件**：src 侧在 `VITE_E2E_BASE_URL` 存在时（e2eMode 分支）
 * HTTP 走浏览器原生 fetch、WS 走原生 WebSocket，直打本地集群 nginx（18801/18802 钉双后端实例）。
 * 本文件只桩 Tauri **本地面**：
 * - sqlite 内存化（db_* 全套，语义对齐 src-tauri/src/db/ 各模块）
 * - 会话锁 / 设备信息(MAC) / 账号存储 / secure proxy / 子窗口等业务命令桩
 * - plugin:store/os/fs/dialog/notification/process/updater 桩（plugin:http 保留 502 桩——
 *   e2e 模式不应有代码走它，走到即在 UI 层可见失败）
 * - transformCallback（@tauri-apps/api/event 的 listen() 需要，事件注册不炸但永不触发）
 *
 * 数据面命令（secure_http / secure_http_stream / ws_*）到达 invoke 即 fail-loud 抛错，
 * 防止 src 的 e2eMode 注入分支失效被静默掩盖。
 */
export function tauriE2EBridgeScript(): string {
  return `
    (() => {
      // ---- 数据面命令禁入（fail-loud）----
      const DATA_PLANE_FORBIDDEN = new Set([
        'secure_http',
        'secure_http_stream',
        'ws_connect',
        'ws_send_text',
        'ws_send_binary',
        'ws_close',
      ]);

      // ---- db_* 内存状态（语义对齐 src-tauri/src/db/）----
      const conversations = new Map();      // id -> conversation row
      const messages = new Map();           // message_uuid -> message row
      let friends = [];
      let groups = [];
      const groupReadPositions = new Map(); // groupId -> Map(user_id -> row)
      const peerReadSeq = new Map();        // conversationId -> seq
      const fileMappings = new Map();       // file_hash -> mapping
      const fileUuidHash = new Map();       // file_uuid -> file_hash
      const nfcTrusted = new Set();         // uid + '|' + payloadHash

      // 每次页面注入随机生成 MAC —— 两个 browser context 各自是独立设备
      const randHex = () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0').toUpperCase();
      const macAddress = 'AA:BB:CC:' + randHex() + ':' + randHex() + ':' + randHex();

      const compareSendTimeDesc = (a, b) => {
        if (a.send_time === b.send_time) return 0;
        return a.send_time < b.send_time ? 1 : -1;
      };
      // 消息 newest-first 排序（对齐 src-tauri/src/db/messages.rs:31-59）：
      // seq===0 的最前（按 send_time DESC），其余按 seq DESC
      const sortNewestFirst = (list) => list.slice().sort((a, b) => {
        const aZero = a.seq === 0;
        const bZero = b.seq === 0;
        if (aZero && bZero) return compareSendTimeDesc(a, b);
        if (aZero) return -1;
        if (bZero) return 1;
        return b.seq - a.seq;
      });
      const conversationMessages = (conversationId) =>
        [...messages.values()].filter((m) => m.conversation_id === conversationId && !m.is_deleted);

      const dbHandlers = {
        set_current_user: () => null,
        clear_current_user: () => null,
        db_init: () => null,

        // ---- 会话 ----
        db_get_conversations: () => [...conversations.values()],
        db_get_conversation: (args) => conversations.get(args.id) ?? null,
        db_save_conversation: (args) => {
          const conv = args.conversation;
          const existing = conversations.get(conv.id);
          // 对齐 Rust ON CONFLICT：已有行的 last_read_seq / is_pinned 不被覆盖
          conversations.set(conv.id, {
            ...conv,
            last_read_seq: existing ? existing.last_read_seq : (conv.last_read_seq ?? 0),
            is_pinned: existing ? existing.is_pinned : (conv.is_pinned ?? false),
          });
          return null;
        },
        db_set_conversation_pinned: (args) => {
          const row = conversations.get(args.id);
          if (row) {
            row.is_pinned = args.pinned;
            return null;
          }
          conversations.set(args.id, {
            id: args.id,
            type: args.convType,
            name: args.name,
            avatar_url: null,
            last_message: null,
            last_message_time: null,
            last_seq: 0,
            unread_count: 0,
            last_read_seq: 0,
            is_muted: false,
            is_pinned: args.pinned,
            updated_at: new Date().toISOString(),
            synced_at: null,
          });
          return null;
        },
        db_advance_conversation_read: (args) => {
          const row = conversations.get(args.id);
          if (row) {
            row.last_read_seq = Math.max(row.last_read_seq, args.seq ?? row.last_seq);
          }
          return null;
        },
        db_get_conversation_peer_read_seq: (args) => peerReadSeq.get(args.id) ?? 0,
        db_set_conversation_peer_read_seq: (args) => {
          peerReadSeq.set(args.id, Math.max(peerReadSeq.get(args.id) ?? 0, args.seq));
          return null;
        },
        db_update_conversation_last_seq: (args) => {
          const row = conversations.get(args.id);
          if (row) {
            row.last_seq = args.lastSeq;
          }
          return null;
        },
        db_update_conversation_last_message: (args) => {
          const row = conversations.get(args.id);
          if (row) {
            row.last_message = args.lastMessage;
            row.last_message_time = args.lastMessageTime;
            row.updated_at = new Date().toISOString();
          }
          return null;
        },
        db_get_conversation_previews: () => [...conversations.values()].map((c) => {
          const latest = sortNewestFirst(conversationMessages(c.id))[0] ?? null;
          return {
            id: c.id,
            type: c.type,
            name: c.name,
            avatar_url: c.avatar_url,
            last_seq: c.last_seq,
            unread_count: c.unread_count,
            is_muted: c.is_muted,
            is_pinned: c.is_pinned,
            updated_at: c.updated_at,
            msg_content: latest ? latest.content : null,
            msg_content_type: latest ? latest.content_type : null,
            msg_send_time: latest ? latest.send_time : null,
          };
        }),

        // ---- 消息 ----
        db_get_messages: (args) => {
          let list = conversationMessages(args.conversationId);
          if (args.beforeSeq != null) {
            list = list.filter((m) => m.seq < args.beforeSeq || m.seq === 0);
          }
          return sortNewestFirst(list).slice(0, args.limit ?? 50);
        },
        db_save_message: (args) => {
          messages.set(args.message.message_uuid, { ...args.message });
          return null;
        },
        db_save_messages: (args) => {
          for (const m of args.messages) {
            messages.set(m.message_uuid, { ...m });
          }
          return null;
        },
        db_save_messages_skip_existing: (args) => {
          for (const m of args.messages) {
            if (!messages.has(m.message_uuid)) {
              messages.set(m.message_uuid, { ...m });
            }
          }
          return null;
        },
        db_mark_message_deleted: (args) => {
          const m = messages.get(args.messageUuid);
          if (m) {
            m.is_deleted = true;
          }
          return null;
        },
        db_mark_message_recalled: (args) => {
          const m = messages.get(args.messageUuid);
          if (m) {
            // 对齐 Rust messages.rs:251：撤回同时改写 content
            m.is_recalled = true;
            m.content = '[消息已撤回]';
          }
          return null;
        },
        db_search_messages: (args) => [...messages.values()]
          .filter((m) => !m.is_deleted && !m.is_recalled && String(m.content ?? '').includes(args.query))
          .sort(compareSendTimeDesc)
          .slice(0, args.limit ?? 50)
          .map((m) => {
            const conv = conversations.get(m.conversation_id);
            return {
              message: m,
              conversation_name: conv ? conv.name : '',
              conversation_avatar: null,
              context_before: null,
              context_after: null,
            };
          }),

        // ---- 文件映射 ----
        db_save_file_mapping: (args) => {
          fileMappings.set(args.mapping.file_hash, args.mapping);
          return null;
        },
        db_save_file_uuid_hash: (args) => {
          fileUuidHash.set(args.fileUuid, args.fileHash);
          return null;
        },

        // ---- 好友 / 群组 ----
        db_get_friends: () => friends,
        db_save_friends: (args) => {
          friends = [...args.friends];
          return null;
        },
        db_get_groups: () => groups,
        db_save_groups: (args) => {
          groups = [...args.groups];
          return null;
        },
        db_update_group: (args) => {
          const idx = groups.findIndex((g) => g.group_id === args.group.group_id);
          if (idx >= 0) {
            groups[idx] = { ...args.group };
          }
          return null;
        },
        db_delete_group: (args) => {
          groups = groups.filter((g) => g.group_id !== args.groupId);
          return null;
        },

        // ---- 群已读位置 ----
        db_get_group_read_positions: (args) => {
          const map = groupReadPositions.get(args.groupId);
          return map ? [...map.values()] : [];
        },
        db_upsert_group_read_positions: (args) => {
          let map = groupReadPositions.get(args.groupId);
          if (!map) {
            map = new Map();
            groupReadPositions.set(args.groupId, map);
          }
          for (const row of args.rows) {
            const old = map.get(row.user_id);
            if (!old) {
              map.set(row.user_id, { ...row });
            } else {
              map.set(row.user_id, {
                ...old,
                // last_read_seq 单调 MAX；其余字段 COALESCE（新值非 null 用新值）
                last_read_seq: Math.max(old.last_read_seq, row.last_read_seq),
                display_name: row.display_name ?? old.display_name,
                avatar_url: row.avatar_url ?? old.avatar_url,
                last_read_at: row.last_read_at ?? old.last_read_at,
              });
            }
          }
          return null;
        },
        db_replace_group_read_positions: (args) => {
          const map = new Map();
          for (const row of args.rows) {
            map.set(row.user_id, { ...row });
          }
          groupReadPositions.set(args.groupId, map);
          return null;
        },

        // ---- 清理 ----
        db_clear_messages: () => {
          messages.clear();
          return null;
        },
        db_clear_all_data: () => {
          conversations.clear();
          messages.clear();
          friends = [];
          groups = [];
          groupReadPositions.clear();
          peerReadSeq.clear();
          fileMappings.clear();
          fileUuidHash.clear();
          nfcTrusted.clear();
          return null;
        },

        // ---- NFC 信任表 ----
        db_nfc_add_trusted: (args) => {
          nfcTrusted.add(args.uid + '|' + args.payloadHash);
          return null;
        },
        db_nfc_remove_trusted: (args) => {
          nfcTrusted.delete(args.uid + '|' + args.payloadHash);
          return null;
        },
        db_nfc_is_trusted: (args) => nfcTrusted.has(args.uid + '|' + args.payloadHash),
        db_nfc_list_trusted: () => [],
      };

      let callbackId = 0;

      window.__TAURI_INTERNALS__ = {
        invoke: async (cmd, args) => {
          // 数据面命令禁入：e2e 模式下 HTTP/WS 必须走 src 的 e2eMode 原生分支
          if (DATA_PLANE_FORBIDDEN.has(cmd)) {
            throw new Error('[tauri-e2e-bridge] data-plane command must not reach invoke in e2e mode: ' + cmd);
          }

          // 本地 sqlite 内存实现
          if (cmd in dbHandlers) return dbHandlers[cmd](args);

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

          // plugin-event（listen/unlisten/emit）—— 注册不炸，事件永不触发
          if (cmd.startsWith('plugin:event|')) {
            return null;
          }

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

          // plugin-http —— e2e 模式不应有代码走它（数据面走原生 fetch），保留 502 桩让误走者可见失败
          if (cmd.startsWith('plugin:http|')) {
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

          // 业务命令桩（会话锁 / 设备信息 / 账号存储 / secure proxy / 文件缓存）
          const businessMocks = {
            'check_session_lock': { exists: false, process_alive: false, pid: null },
            'create_session_lock': null,
            'remove_session_lock': null,
            'get_mac_address_cmd': macAddress,
            'save_account': null,
            'delete_account': null,
            'update_account_nickname': null,
            'touch_account_login': null,
            'update_account_avatar': null,
            'get_saved_accounts': [],
            'get_account_password': null,
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
          console.debug('[tauri-e2e-bridge] unhandled invoke:', cmd, args);
          return null;
        },
        // @tauri-apps/api/event 的 listen() 依赖 transformCallback 注册回调
        transformCallback: (callback, once) => {
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
        },
        convertFileSrc: (path) => 'https://mock-asset/' + path,
        metadata: {
          currentWebview: { windowLabel: 'main' },
          currentWindow: { label: 'main' },
        },
      };
    })();
  `;
}

/**
 * Setup the real-e2e Tauri bridge on a page before navigation.
 */
export async function setupTauriE2EBridge(page: Page): Promise<void> {
  await page.addInitScript(tauriE2EBridgeScript());
}
