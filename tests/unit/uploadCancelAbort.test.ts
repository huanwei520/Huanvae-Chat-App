/**
 * 「取消」必须真的中断在飞的上传（行为测试，不是静态扫描）
 *
 * ## 修的是什么
 *
 * AbortController 注册表原先是 `useComposerTrayOutbox` 的**实例内 `useRef`**，
 * 而取消按钮长在消息气泡里、走模块级的 `cancelSendingItem` —— 它够不着任何实例的 ref，
 * 于是 `abort()` **恒为 no-op**：用户点了取消、UI 立刻消失，
 * **那一项的 HTTP 上传照样跑完，并且可能落库成一条真实消息** ⇒ 点了取消，消息照样出现。
 *
 * 现在那张表提成了模块级 `uploadAbortRegistry`，两边指向同一份。本文件钉三件事：
 *
 * 1. 取消一个 `uploading` 中的项 ⇒ **那一项的 AbortController 真的被 abort**；
 * 2. 🔴 顺序：**abort 先于「从队列摘掉」**（契约的一部分，见 sendingMediaActions 注释）；
 * 3. 取消之后**即使那次 HTTP 请求已经跑完**（秒传 / 单分片小文件会在两个检查点之间完成），
 *    也**不落库、不标已发** —— 这是 `uploadOne` 落库前那道 `signal.aborted` 闸门。
 *
 * 第 4 条 it 是**正对照**：同一条路径不取消时会落库并标已发，
 * 证明第 3 条不是"因为这条路径本来就走不到落库"而恒真。
 *
 * ## 为什么必须驱动真 hook 而不是断言源码
 *
 * 这条缺陷的本质是「**两个模块看的不是同一张表**」——
 * 源码里两边都写着 `abort(...)`，静态扫描一样能通过；只有真的跑一遍
 * 「A 模块登记 → B 模块取消」才能证明它们指向同一份。
 *
 * ## 三态变异（每条都做过，原始输出见 /private/tmp/app-album-crop/H7-mutation-raw.txt）
 * - 删掉 `cancelSendingItem` 里的 `abortUpload(clientId);` ⇒ 本文件 1/2/3 三条红（4 绿）
 * - 把 abort 与 cancel 两行对调              ⇒ 只有第 2 条红
 * - 删掉 `uploadOne` 落库前的 `signal.aborted` 闸门 ⇒ 只有第 3 条红
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const CONVERSATION_KEY = 'friend:f-1';
const CLIENT_ID = 'client_h1_cancel';

const mocks = vi.hoisted(() => {
  const uploadFriendFile = vi.fn();
  const uploadGroupFile = vi.fn();
  return {
    uploadFriendFile,
    uploadGroupFile,
    persistUploadedMessage: vi.fn(),
    // 🔴 引用稳定：mock 出来的 hook 每次 render 返回新对象会让下游依赖数组抖动，
    // 测的就不是真实行为了（见 .claude/rules/frontend-test.md「mock context hook 的返回值必须引用稳定」）
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

// 只替换 useFileUpload 这一个导出：UPLOAD_CANCELLED 等常量必须是**真值**，
// 自己抄一份会在常量改动时静默漂移。
vi.mock('../../src/hooks/useFileUpload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/hooks/useFileUpload')>();
  return { ...actual, useFileUpload: () => mocks.uploader };
});

vi.mock('../../src/chat/shared/uploadPersist', () => ({
  persistUploadedMessage: mocks.persistUploadedMessage,
  resolveUploadedContent: (caption: string | undefined, _t: string, name: string) => caption || name,
}));

import { useComposerTrayOutbox } from '../../src/chat/shared/useComposerTrayOutbox';
import { cancelSendingItem } from '../../src/chat/shared/sendingMediaActions';
import { useSendingMediaStore, type SendingMediaSeed } from '../../src/stores/sendingMediaStore';

function seed(clientId = CLIENT_ID): SendingMediaSeed {
  return {
    clientId,
    file: new File(['bytes'], 'v.mp4', { type: 'video/mp4' }),
    conversationKey: CONVERSATION_KEY,
    conversationType: 'friend',
    targetId: 'f-1',
    shape: { kind: 'single', groupId: null, index: null, count: null },
    preview: { name: 'v.mp4', kind: 'video', size: 5, localPath: '/tmp/v.mp4', width: null, height: null },
    caption: undefined,
    sendTime: '2026-08-12T00:00:00.000Z',
  };
}

/** 手动控制上传何时完成，并捕获传进去的 AbortSignal */
function deferredUpload() {
  let resolveUpload!: (value: unknown) => void;
  const promise = new Promise<unknown>((r) => { resolveUpload = r; });
  const captured: { signal: AbortSignal | null } = { signal: null };
  mocks.uploadFriendFile.mockImplementation(
    (
      _file: File,
      _targetId: string,
      _group: unknown,
      _caption: string | undefined,
      opts: { signal: AbortSignal },
    ) => {
      captured.signal = opts.signal;
      return promise;
    },
  );
  return { captured, resolveUpload };
}

const UPLOAD_OK = {
  success: true,
  fileUuid: 'file-uuid',
  fileHash: 'hash',
  messageUuid: 'server-uuid',
};

/** 起一个正在上传的项，返回它的 signal（等到上传器真的被调用为止） */
async function startUploading() {
  const { captured, resolveUpload } = deferredUpload();
  const hook = renderHook(() => useComposerTrayOutbox(CONVERSATION_KEY));
  act(() => {
    useSendingMediaStore.getState().enqueue([seed()]);
  });
  await waitFor(() => {
    expect(captured.signal).not.toBeNull();
  });
  return { hook, signal: captured.signal as AbortSignal, resolveUpload };
}

beforeEach(() => {
  useSendingMediaStore.setState({ entries: {}, orderByConversation: {} });
  mocks.uploadFriendFile.mockReset();
  mocks.uploadGroupFile.mockReset();
  mocks.persistUploadedMessage.mockReset();
  mocks.persistUploadedMessage.mockResolvedValue('server-uuid');
});

afterEach(() => {
  useSendingMediaStore.setState({ entries: {}, orderByConversation: {} });
});

describe('取消要真正中断在飞的上传', () => {
  it('取消 uploading 中的项：那一项的 AbortController 真的被 abort（模块级表让气泡侧够得着）', async () => {
    const { signal } = await startUploading();
    expect(signal.aborted).toBe(false);

    act(() => {
      cancelSendingItem(CLIENT_ID);
    });

    expect(signal.aborted).toBe(true);
  });

  it('🔴 顺序：abort 发生在「从队列摘掉」之前', async () => {
    const { signal } = await startUploading();

    const order: string[] = [];
    signal.addEventListener('abort', () => order.push('abort'));
    const unsubscribe = useSendingMediaStore.subscribe((state, prev) => {
      if (prev.entries[CLIENT_ID] && !state.entries[CLIENT_ID]) { order.push('cancel'); }
    });

    act(() => {
      cancelSendingItem(CLIENT_ID);
    });
    unsubscribe();

    expect(order).toEqual(['abort', 'cancel']);
  });

  it('取消后即使那次 HTTP 已经跑完，也不落库、不标已发', async () => {
    const { signal, resolveUpload } = await startUploading();

    act(() => {
      cancelSendingItem(CLIENT_ID);
    });
    expect(signal.aborted).toBe(true);

    // 模拟"请求已经到达服务端并成功返回"——abort 追不回它，闸门必须在本机这一侧生效
    await act(async () => {
      resolveUpload(UPLOAD_OK);
      await Promise.resolve();
    });

    expect(mocks.persistUploadedMessage).not.toHaveBeenCalled();
    // 条目也不许被"复活"成 done
    expect(useSendingMediaStore.getState().entries[CLIENT_ID]).toBeUndefined();
  });

  it('正对照：不取消时同一条路径会落库并标已发（证明上一条不是恒真）', async () => {
    const { resolveUpload } = await startUploading();

    await act(async () => {
      resolveUpload(UPLOAD_OK);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mocks.persistUploadedMessage).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      const entry = useSendingMediaStore.getState().entries[CLIENT_ID];
      expect(entry?.status).toBe('done');
      expect(entry?.realUuid).toBe('server-uuid');
    });
  });
});
