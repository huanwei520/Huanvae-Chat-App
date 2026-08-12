/**
 * 相册合成面板的行为契约
 *
 * 面板是相册发送侧唯一的人机界面，它决定了**最终提交哪些文件、以什么顺序、带什么配文** ——
 * 这三样再往下就直接进 planAlbumUpload 变成 media_group 三件套，错了后端要么 400 要么
 * 发出一组顺序错乱的图。planAlbumUpload 自己的位次/配文归属已有单测（tests/unit/albumSend.test.ts），
 * 本文件只管**面板交出去的东西对不对**，不重复那一层。
 *
 * jsdom 无 URL.createObjectURL（面板用它做缩略图），本文件自备桩并在末尾断言 revoke 被调用 ——
 * 不释放会把整份图片留在内存里，连开几次相册就是几十上百 MB。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AlbumComposer } from '../../src/chat/shared/AlbumComposer';
import { ALBUM_MAX_ITEMS } from '../../src/chat/shared/albumSend';
import type { PickedFile } from '../../src/chat/shared/FileAttachButton';

const createObjectURL = vi.fn((_blob: Blob) => `blob:stub/${Math.random()}`);
const revokeObjectURL = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom 不实现这两个；面板的缩略图与卸载释放都依赖它们
  Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, writable: true, configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, writable: true, configurable: true });
});

// 面板 portal 到 document.body；清理交给 RTL 的自动 cleanup（自己清 body 会把
// portal 节点从 React 手里抽走，下一个用例的 unmount 会报 "node to be removed is not a child"）

function pick(name: string): PickedFile {
  return {
    file: new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' }),
    localPath: `/tmp/${name}`,
  };
}

function pickMany(n: number): PickedFile[] {
  return Array.from({ length: n }, (_, i) => pick(`p${i}.jpg`));
}

describe('AlbumComposer — 交出去的文件集合', () => {
  it('渲染每一张的缩略图，并把全部入选项按原顺序交给 onSend', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const picked = [pick('a.jpg'), pick('b.jpg'), pick('c.jpg')];

    render(<AlbumComposer picked={picked} onSend={onSend} onCancel={vi.fn()} />);

    // 每张一格（alt 用文件名）
    expect(screen.getAllByRole('img').map((el) => el.getAttribute('alt'))).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    expect(screen.getByText('发送 3 张')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(onSend).toHaveBeenCalledTimes(1);
    const [files, caption] = onSend.mock.calls[0] as [PickedFile[], string];
    // 顺序整体比对：这个数组的下标直接变成 media_group_index
    expect(files.map((f) => f.localPath)).toEqual(['/tmp/a.jpg', '/tmp/b.jpg', '/tmp/c.jpg']);
    expect(caption).toBe('');
  });

  it('剔除某一张后，它不再出现在 onSend 的入选集合里（且计数同步）', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const picked = [pick('a.jpg'), pick('b.jpg'), pick('c.jpg')];

    render(<AlbumComposer picked={picked} onSend={onSend} onCancel={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: '移除 b.jpg' }));
    expect(screen.getByText('发送 2 张')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '发送' }));

    const [files] = onSend.mock.calls[0] as [PickedFile[], string];
    expect(files.map((f) => f.localPath)).toEqual(['/tmp/a.jpg', '/tmp/c.jpg']);
  });

  it('剔除后可再加回来（按钮语义翻转），加回的项重新入选', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();

    render(<AlbumComposer picked={[pick('a.jpg'), pick('b.jpg')]} onSend={onSend} onCancel={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: '移除 b.jpg' }));
    await user.click(screen.getByRole('button', { name: '重新加入 b.jpg' }));
    await user.click(screen.getByRole('button', { name: '发送' }));

    const [files] = onSend.mock.calls[0] as [PickedFile[], string];
    expect(files.map((f) => f.localPath)).toEqual(['/tmp/a.jpg', '/tmp/b.jpg']);
  });

  it('全部剔除后发送键禁用（空组不能提交，后端下限是 2）', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();

    render(<AlbumComposer picked={[pick('a.jpg')]} onSend={onSend} onCancel={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: '移除 a.jpg' }));

    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '发送' }));
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe('AlbumComposer — 配文', () => {
  it('配文原样交给 onSend（裁剪与「只挂 index=0」由 planAlbumUpload 负责，面板不越权）', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();

    render(<AlbumComposer picked={[pick('a.jpg'), pick('b.jpg')]} onSend={onSend} onCancel={vi.fn()} />);

    await user.type(screen.getByPlaceholderText('添加描述（可选）'), '海边那天');
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0][1]).toBe('海边那天');
  });
});

describe('AlbumComposer — 超出上限不静默截断', () => {
  it(`选 ${ALBUM_MAX_ITEMS + 3} 张：只入选 ${ALBUM_MAX_ITEMS} 张，且明说被丢下几张`, async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();

    render(<AlbumComposer picked={pickMany(ALBUM_MAX_ITEMS + 3)} onSend={onSend} onCancel={vi.fn()} />);

    expect(screen.getAllByRole('img')).toHaveLength(ALBUM_MAX_ITEMS);
    // 「悄悄少发 3 张」是最坏的一种成功 —— 必须出现在界面上
    expect(screen.getByRole('status')).toHaveTextContent(
      `一次最多 ${ALBUM_MAX_ITEMS} 张，超出的 3 张未加入`,
    );

    await user.click(screen.getByRole('button', { name: '发送' }));
    const [files] = onSend.mock.calls[0] as [PickedFile[], string];
    expect(files).toHaveLength(ALBUM_MAX_ITEMS);
    expect(files[files.length - 1].localPath).toBe(`/tmp/p${ALBUM_MAX_ITEMS - 1}.jpg`);
  });

  it(`恰好 ${ALBUM_MAX_ITEMS} 张时不出现「未加入」提示（不能吓唬用户）`, () => {
    render(<AlbumComposer picked={pickMany(ALBUM_MAX_ITEMS)} onSend={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getAllByRole('img')).toHaveLength(ALBUM_MAX_ITEMS);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('AlbumComposer — 发送中与取消', () => {
  it('sending=true 时禁用发送/取消/配文，且不能重复提交', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();

    render(<AlbumComposer picked={[pick('a.jpg'), pick('b.jpg')]} onSend={onSend} onCancel={vi.fn()} sending />);

    expect(screen.getByRole('button', { name: '发送中…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    expect(screen.getByPlaceholderText('添加描述（可选）')).toBeDisabled();

    await user.click(screen.getByRole('button', { name: '发送中…' }));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('取消键调用 onCancel 且不发送', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const onCancel = vi.fn();

    render(<AlbumComposer picked={[pick('a.jpg'), pick('b.jpg')]} onSend={onSend} onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: '取消' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe('AlbumComposer — 缩略图内存', () => {
  it('卸载时释放全部 object URL（不释放会持有整份图片内存）', () => {
    const { unmount } = render(
      <AlbumComposer picked={[pick('a.jpg'), pick('b.jpg')]} onSend={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    const issued = createObjectURL.mock.results.map((r) => r.value as string);

    unmount();

    expect(revokeObjectURL.mock.calls.map((c) => c[0])).toEqual(issued);
  });
});
