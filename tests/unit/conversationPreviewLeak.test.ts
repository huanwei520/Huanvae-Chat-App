/**
 * 会话预览不得泄露 meeting_invite 的 password（+ 两条刷新路径口径一致）
 *
 * 病灶（本轮修复前）：
 * - `src/services/syncService.ts` 的 `getMessagePreviewText` 有 `default: return content`
 *   ⇒ **离线同步回来**的 `meeting_invite` 直接把 `message_content` 原文写进会话预览，
 *   而那段 JSON 里带 `password`（真值源：`src/meeting/components/ShareMeetingModal.tsx`
 *   的发送体 `JSON.stringify({ room_id, password, room_name, ... })`）
 *   ⇒ **会议密码印在会话列表上**。
 * - `src/db/index.ts` 的 `refreshConversationPreview` 另有一张四行表 + `?? '[文件]'`
 *   ⇒ 撤回/删除后刷新预览时 `meeting_invite` / `card` 显示成「[文件]」。
 *
 * 🔴 断言方式是**反向断言**（`not.toContain(PASSWORD)`），不是只断言等于「[会议邀请]」：
 * 正向断言只能证明「当前这一版文案对了」，一旦有人改回回落 content 原文、或换成
 * 「[会议邀请] xxx」这种带原文尾巴的写法，正向断言会红得莫名、反向断言直指要害。
 *
 * 三段各自打的是不同的东西，缺一不可：
 *  ① 纯函数层：映射表 + 「未知类型绝不回落 content」这条不变量本身
 *  ② syncService 真路径：`syncMessages` → `db.updateConversationLastMessage(预览)`
 *  ③ db 真路径：`refreshConversationPreview` → `invoke('db_update_conversation_last_message')`
 * ②③ 都是**走真函数**拿到真实传参，不是静态扫描源码。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- ② 用的 mock（必须在 import SyncService 之前声明，vi.hoisted 见 frontend-test.md）----
const mockDb = vi.hoisted(() => ({
  saveMessages: vi.fn().mockResolvedValue(undefined),
  updateConversationLastMessage: vi.fn().mockResolvedValue(undefined),
  updateConversationLastSeq: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/db', () => mockDb);
vi.mock('../../src/utils/avatar', () => ({
  resolveServerAvatarUrl: (s: string | null | undefined) => s ?? null,
}));

import {
  conversationPreviewText,
  MESSAGE_PREVIEW_TEXT,
  UNKNOWN_MESSAGE_PREVIEW_TEXT,
} from '../../src/chat/shared/messagePreviewText';
import { SyncService } from '../../src/services/syncService';
import type { LocalConversation } from '../../src/db';

/** 一个一眼认得出的密码值 —— 它出现在任何预览里都是泄露 */
const PASSWORD = 'p4ssw0rd-LEAK-9x7';

/** 与 ShareMeetingModal 逐键同形的真实 meeting_invite 载荷 */
const MEETING_CONTENT = JSON.stringify({
  room_id: 'room-123',
  password: PASSWORD,
  room_name: '周会',
  creator_name: '张三',
  creator_avatar: null,
});

// ============================================================
// ① 纯函数层
// ============================================================

describe('conversationPreviewText：未知类型绝不回落 content 原文', () => {
  it('meeting_invite → 固定文案，且预览里不含 password 原值（反向断言）', () => {
    const preview = conversationPreviewText('meeting_invite', MEETING_CONTENT);
    expect(preview).not.toContain(PASSWORD);
    expect(preview).not.toContain('password');
    expect(preview).toBe('[会议邀请]');
  });

  it('card → 固定文案，不吐裸 JSON', () => {
    const preview = conversationPreviewText('card', '{"kind":"contact","user_id":"u1"}');
    expect(preview).not.toContain('user_id');
    expect(preview).toBe('[卡片]');
  });

  it('未登记的新类型（哪怕正文是带 password 的 JSON）也不回落原文', () => {
    // 这条是本模块存在的理由：将来谁加了一个 message_type 却忘了登记，
    // 代价只能是显示成「[消息]」，不能是把载荷倒到屏幕上。
    const preview = conversationPreviewText('some_future_json_type', MEETING_CONTENT);
    expect(preview).not.toContain(PASSWORD);
    expect(preview).toBe(UNKNOWN_MESSAGE_PREVIEW_TEXT);
  });

  it('白名单类型（text / system）正文本身就是给人看的 → 原样透传', () => {
    expect(conversationPreviewText('text', '你好')).toBe('你好');
    expect(conversationPreviewText('system', '张三加入了群聊')).toBe('张三加入了群聊');
  });

  it('白名单类型但正文为空 / 类型缺失 → 兜底文案，不产出空串', () => {
    expect(conversationPreviewText('text', '')).toBe(UNKNOWN_MESSAGE_PREVIEW_TEXT);
    expect(conversationPreviewText(null, 'whatever')).toBe(UNKNOWN_MESSAGE_PREVIEW_TEXT);
    expect(conversationPreviewText(undefined, null)).toBe(UNKNOWN_MESSAGE_PREVIEW_TEXT);
  });

  it('映射表覆盖了全部非文本 message_type（与 types/chat.ts 的 MessageType 对齐）', () => {
    // types/chat.ts: MessageType = text | image | video | file | meeting_invite | card | group_card
    // GroupMessageType 多一个 system（走白名单，不进表）
    expect(Object.keys(MESSAGE_PREVIEW_TEXT).sort()).toEqual(
      ['card', 'file', 'group_card', 'image', 'meeting_invite', 'video'],
    );
  });
});

// ============================================================
// ② syncService 离线同步真路径
// ============================================================

function makeApi(resp: unknown) {
  return {
    post: vi.fn().mockResolvedValue(resp),
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    getBaseUrl: () => 'http://localhost:8080',
    getAccessToken: () => 'token',
  };
}

const baseConv = (id: string, lastSeq: number): LocalConversation => ({
  id,
  type: 'friend',
  name: 'test',
  avatar_url: null,
  last_message: null,
  last_message_time: null,
  last_seq: lastSeq,
  unread_count: 0,
  last_read_seq: 0,
  is_muted: false,
  is_pinned: false,
  updated_at: '2026-01-01T00:00:00Z',
  synced_at: null,
});

describe('syncService 离线同步：写进会话预览的那一行不含 password', () => {
  beforeEach(() => {
    mockDb.saveMessages.mockClear();
    mockDb.updateConversationLastMessage.mockClear();
    mockDb.updateConversationLastSeq.mockClear();
  });

  it('同步回一条 meeting_invite → updateConversationLastMessage 收到「[会议邀请]」而非载荷', async () => {
    const api = makeApi({
      conversations: [
        {
          conversation_id: 'conv-A',
          conversation_type: 'friend',
          messages: [{
            message_uuid: 'uuid-9',
            sender_id: 'sender-1',
            message_content: MEETING_CONTENT,
            message_type: 'meeting_invite',
            seq: 9,
            send_time: '2026-01-01T00:00:09Z',
          }],
          latest_seq: 9,
          has_more: false,
        },
      ],
    });
    const svc = new SyncService(api as never);

    await svc.syncMessages([baseConv('conv-A', 0)]);

    expect(mockDb.updateConversationLastMessage).toHaveBeenCalledTimes(1);
    const [, preview] = mockDb.updateConversationLastMessage.mock.calls[0] as [string, string, string];
    expect(preview).not.toContain(PASSWORD);
    expect(preview).toBe('[会议邀请]');
  });
});

// ============================================================
// ③ db 撤回/删除后刷新预览真路径
// ============================================================
// 注意：本段不能 mock '../../src/db'（②已 mock 掉了同一个模块），所以放在独立文件里跑
// 会更干净 —— 但那样就拆成两份、两处口径又可能各自漂。这里改为**直接对被 mock 前的真实模块**
// 用 vi.importActual 拿一份未被替换的实现，仍是走真函数。
describe('db.refreshConversationPreview：撤回/删除后刷新的那一行与同步路径同口径', () => {
  it('最新一条是 meeting_invite → 写回「[会议邀请]」（原为「[文件]」），且不含 password', async () => {
    const core = await vi.importActual<typeof import('@tauri-apps/api/core')>('@tauri-apps/api/core');
    void core; // 只为坐实 core 模块可解析；下面用的是 setup.ts 里的全局 invoke mock

    const realDb = await vi.importActual<typeof import('../../src/db')>('../../src/db');
    const { invoke } = await import('@tauri-apps/api/core');
    const mockInvoke = vi.mocked(invoke);

    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'db_get_messages') {
        return [{
          message_uuid: 'uuid-9',
          conversation_id: 'conv-A',
          conversation_type: 'friend',
          sender_id: 's1',
          sender_name: 'x',
          sender_avatar: null,
          content: MEETING_CONTENT,
          content_type: 'meeting_invite',
          file_uuid: null,
          file_url: null,
          file_size: null,
          image_width: null,
          image_height: null,
          seq: 9,
          reply_to: null,
          is_recalled: false,
          is_deleted: false,
          send_time: '2026-01-01T00:00:09Z',
        }];
      }
      return undefined;
    });

    const result = await realDb.refreshConversationPreview('conv-A');

    expect(result?.lastMessage).not.toContain(PASSWORD);
    expect(result?.lastMessage).toBe('[会议邀请]');

    const updateCall = mockInvoke.mock.calls.find(
      ([cmd]) => cmd === 'db_update_conversation_last_message',
    );
    expect(updateCall).toBeDefined();
    const payload = updateCall?.[1] as { lastMessage: string };
    expect(payload.lastMessage).not.toContain(PASSWORD);
    expect(payload.lastMessage).toBe('[会议邀请]');
  });
});
