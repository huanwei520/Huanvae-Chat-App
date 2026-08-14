/**
 * 「用媒体回复」的引用回复透传（行为测试，不是静态扫描）
 *
 * ## 修的是什么
 *
 * 用媒体（图片 ± 文字）去回复别人时，媒体消息本身发出去了，但 `reply_to`
 * **结构上从未离开客户端**：`ChatInputArea.handleSend` 的 tray 分支 return 掉了，
 * 永远走不到纯文本路径里那个唯一读 `replyDraft` 的入口。后端因此没有理由报错
 * （它压根没收到这个字段）⇒ 静默丢失，用户看到的是「我在回复，回复发不出去」。
 *
 * ## 为什么这几条必须真跑一遍，不能只扫源码
 *
 * 源码扫描能证明「body 字面量里有 reply_to」（那条在 composerTrayContract.test.ts），
 * 但证明不了**运行时这个值真的从草稿一路走到了上传参数与本地落库**——
 * 链上有四段独立赋值（输入区 → 计划 → 上传参数 → 落库），任何一段漏写，
 * 症状都是同一个「静默没有引用块」。所以这里驱动真 hook 跑完整条链。
 *
 * 同理，**会话类型的门**是一个运行时三元（好友传、群不传），静态扫描只能看到它写着，
 * 看不到它真的在关。第 3 / 4 条 it 正负异形地钉这一点：
 * 同一份代码、只改 `chatTarget.type`，一边拿到 uuid、一边拿到 undefined。
 *
 * ## 群侧为什么刻意不传（不是漏了）
 *
 * 后端 `storage/handlers/upload.rs` 的群分支硬编码 `reply_to: None`（秒传与 confirm 两处同型），
 * backend-docs 的参数表也明写「仅好友会话生效」。传过去必被丢弃 ⇒
 * 传了等于制造「看起来传了其实没生效」的假象，且本机会写出一个对端根本不存在的引用关系。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { Friend, Group } from '../../src/types/chat';

const REPLY_UUID = '019ffa2f-0000-7000-8000-000000000001';

const mocks = vi.hoisted(() => {
  const uploadFriendFile = vi.fn();
  const uploadGroupFile = vi.fn();
  return {
    uploadFriendFile,
    uploadGroupFile,
    persistUploadedMessage: vi.fn(),
    // 🔴 引用稳定（见 .claude/rules/frontend-test.md「mock context hook 的返回值必须引用稳定」）
    uploader: { uploadFriendFile, uploadGroupFile },
    sessionCtx: {
      session: {
        userId: 'me',
        profile: { user_nickname: 'Me', user_avatar_url: null },
      },
    },
  };
});

vi.mock('../../src/contexts/SessionContext', () => ({
  useSession: () => mocks.sessionCtx,
}));

// 只替换 useFileUpload 这一个导出，其余（UPLOAD_CANCELLED 等常量）保持真值
vi.mock('../../src/hooks/useFileUpload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/hooks/useFileUpload')>();
  return { ...actual, useFileUpload: () => mocks.uploader };
});

vi.mock('../../src/chat/shared/uploadPersist', () => ({
  persistUploadedMessage: mocks.persistUploadedMessage,
  resolveUploadedContent: (caption: string | undefined, _t: string, name: string) => caption || name,
}));

import { useComposerTrayOutbox } from '../../src/chat/shared/useComposerTrayOutbox';
import { planComposerTraySend } from '../../src/chat/shared/composerTrayPlan';
import { useSendingMediaStore } from '../../src/stores/sendingMediaStore';
import { useChatStore } from '../../src/stores/chatStore';
import type { TrayItem } from '../../src/stores/composerTrayStore';

const FRIEND: Friend = {
  friend_id: 'f-1',
  friend_nickname: 'F',
  friend_avatar_url: null,
  add_time: '',
  approve_reason: null,
  friend_remark: null,
  is_blacklisted: false,
  is_special_care: false,
};

const GROUP: Group = {
  group_id: 'g-1',
  group_name: '测试群',
  group_avatar_url: '',
  role: 'member',
  unread_count: null,
  last_message_content: null,
  last_message_time: null,
};

const CONVERSATION_KEY = 'conv-under-test';

function trayItem(id: string, name = 'a.png'): TrayItem {
  return {
    id,
    file: new File(['bytes'], name, { type: 'image/png' }),
    localPath: `/tmp/${name}`,
    kind: 'image',
    previewUrl: null,
    width: 100,
    height: 80,
  };
}

const UPLOAD_OK = {
  success: true,
  fileUuid: 'file-uuid',
  fileHash: 'hash',
  messageUuid: 'server-uuid',
};

/** 取某次上传调用的 opts（第 5 个实参） */
function optsOf(call: unknown[] | undefined): Record<string, unknown> {
  return (call?.[4] ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  useSendingMediaStore.setState({ entries: {}, orderByConversation: {} });
  mocks.uploadFriendFile.mockReset();
  mocks.uploadGroupFile.mockReset();
  mocks.uploadFriendFile.mockResolvedValue(UPLOAD_OK);
  mocks.uploadGroupFile.mockResolvedValue(UPLOAD_OK);
  mocks.persistUploadedMessage.mockReset();
  mocks.persistUploadedMessage.mockResolvedValue('server-uuid');
});

afterEach(() => {
  useSendingMediaStore.setState({ entries: {}, orderByConversation: {} });
  useChatStore.setState({ chatTarget: null });
});

/** 在指定会话类型下发一批媒体，等到上传器被调用 */
async function sendWith(
  target: { type: 'friend'; data: Friend } | { type: 'group'; data: Group },
  items: readonly TrayItem[],
  text: string,
  replyTo: string | undefined,
) {
  act(() => {
    useChatStore.setState({ chatTarget: target });
  });
  const hook = renderHook(() => useComposerTrayOutbox(CONVERSATION_KEY));
  act(() => {
    hook.result.current.send(items, text, replyTo);
  });
  const uploader = target.type === 'friend' ? mocks.uploadFriendFile : mocks.uploadGroupFile;
  await waitFor(() => {
    expect(uploader).toHaveBeenCalledTimes(items.length);
  });
  return hook;
}

describe('好友会话：引用回复一路走到上传参数与本地落库', () => {
  it('图片 + 文字回复：uploadFriendFile 拿到 replyTo，且 caption 也在（报障的那个形态）', async () => {
    await sendWith({ type: 'friend', data: FRIEND }, [trayItem('t1')], '这是配文', REPLY_UUID);

    const call = mocks.uploadFriendFile.mock.calls[0];
    expect(call[3]).toBe('这是配文');
    expect(optsOf(call).replyTo).toBe(REPLY_UUID);
  });

  it('纯图片回复（不打字）同样带上 replyTo —— 缺陷范围是「任何用媒体回复」', async () => {
    await sendWith({ type: 'friend', data: FRIEND }, [trayItem('t1')], '', REPLY_UUID);

    const call = mocks.uploadFriendFile.mock.calls[0];
    expect(call[3]).toBeUndefined();
    expect(optsOf(call).replyTo).toBe(REPLY_UUID);
  });

  it('本地落库也带 replyTo（不带 ⇒ 对端看得到引用块、自己看不到）', async () => {
    await sendWith({ type: 'friend', data: FRIEND }, [trayItem('t1')], '', REPLY_UUID);

    await waitFor(() => {
      expect(mocks.persistUploadedMessage).toHaveBeenCalledTimes(1);
    });
    expect(mocks.persistUploadedMessage.mock.calls[0][0]).toMatchObject({ replyTo: REPLY_UUID });
  });

  it('正对照：不带引用发送时 replyTo 恒 undefined（证明上面几条不是恒真）', async () => {
    await sendWith({ type: 'friend', data: FRIEND }, [trayItem('t1')], '只发图', undefined);

    expect(optsOf(mocks.uploadFriendFile.mock.calls[0]).replyTo).toBeUndefined();
    await waitFor(() => {
      expect(mocks.persistUploadedMessage).toHaveBeenCalledTimes(1);
    });
    expect(mocks.persistUploadedMessage.mock.calls[0][0].replyTo).toBeUndefined();
  });

  it('整批只有第一项带 replyTo（与 caption 同一判定；每项都带会让对端看到 N 个引用块）', async () => {
    const items = [trayItem('t1', 'a.png'), trayItem('t2', 'b.png'), trayItem('t3', 'c.png')];
    await sendWith({ type: 'friend', data: FRIEND }, items, '合影', REPLY_UUID);

    const withReply = mocks.uploadFriendFile.mock.calls.filter((c) => optsOf(c).replyTo === REPLY_UUID);
    expect(withReply).toHaveLength(1);
    // 且就是第一项（顺序 = 用户在待发区看到的顺序）
    expect(mocks.uploadFriendFile.mock.calls[0][0].name).toBe('a.png');
    expect(optsOf(mocks.uploadFriendFile.mock.calls[0]).replyTo).toBe(REPLY_UUID);
  });
});

describe('🔴 群会话：同一份代码、只改 chatTarget.type，引用回复被门挡住', () => {
  it('uploadGroupFile 的 opts 里没有 replyTo（后端群分支硬编码丢弃，传了是假象）', async () => {
    await sendWith({ type: 'group', data: GROUP }, [trayItem('t1')], '这是配文', REPLY_UUID);

    const call = mocks.uploadGroupFile.mock.calls[0];
    // caption 照常走（群侧 caption 是生效的），只有 reply_to 被挡
    expect(call[3]).toBe('这是配文');
    expect(optsOf(call).replyTo).toBeUndefined();
  });

  it('群侧本地也不落 reply_to（否则本机会写出一个对端不存在的引用关系）', async () => {
    await sendWith({ type: 'group', data: GROUP }, [trayItem('t1')], '', REPLY_UUID);

    await waitFor(() => {
      expect(mocks.persistUploadedMessage).toHaveBeenCalledTimes(1);
    });
    expect(mocks.persistUploadedMessage.mock.calls[0][0].replyTo).toBeUndefined();
  });
});

describe('planComposerTraySend：replyTo 的落点与 caption 逐字同一格', () => {
  const img = (id: string) => ({ id, kind: 'image' as const });

  it('相册：只有 index 0 那一项带 replyTo 与 caption', () => {
    const plan = planComposerTraySend([img('a'), img('b'), img('c')], '合影', ['G1'], REPLY_UUID);
    expect(plan.items.map((p) => p.replyTo)).toEqual([REPLY_UUID, undefined, undefined]);
    expect(plan.items.map((p) => p.caption)).toEqual(['合影', undefined, undefined]);
  });

  it('混族切成两个形态时，replyTo 仍只挂第一个形态的第一项', () => {
    // image/image/file ⇒ [相册(a,b)] + [单条(c)]；replyTo 不许在第二个形态上再出现一次
    const plan = planComposerTraySend(
      [img('a'), img('b'), { id: 'c', kind: 'file' as const }],
      '',
      ['G1'],
      REPLY_UUID,
    );
    expect(plan.items.map((p) => p.replyTo)).toEqual([REPLY_UUID, undefined, undefined]);
  });

  it('不传 replyTo 时全部为 undefined（正对照：上面两条不是恒真）', () => {
    const plan = planComposerTraySend([img('a'), img('b')], '合影', ['G1']);
    expect(plan.items.map((p) => p.replyTo)).toEqual([undefined, undefined]);
  });
});
