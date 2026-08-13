/**
 * 附件按钮的「多选 ⇒ 相册」决策点（相册发送侧入口的第一环）
 *
 * 这里钉死的是 FileAttachButton 那个 if 的**两侧**，因为它同时承担两件相反的事：
 *   1. 给了 onFilesSelect + 选的是图片/视频 ⇒ 才允许多选（相册只收媒体）
 *   2. 其余一切情况 ⇒ 维持单选，走 onFileSelect —— 这就是「单发不回归」的判据本身
 *
 * 为什么在这一层测而不是静态扫描：`allowMultiple` 是个**条件表达式**（三个因子相与），
 * 静态扫描只能证明"这行字还在"，证不了各因子组合下的取值。而 openDialog 的 `multiple`
 * 实参恰好是这个表达式的唯一可观测出口 —— 断言它 = 直接断言该表达式。
 *
 * 本文件局部覆盖 plugin-fs 的 mock（setup.ts 那份没有 `stat`，FileAttachButton 需要它）；
 * 覆盖只在本文件生效，不影响其它测试。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { stat, readFile } from '@tauri-apps/plugin-fs';
import { FileAttachButton, type PickedFile } from '../../src/chat/shared/FileAttachButton';

// setup.ts 的 plugin-fs mock 不含 stat；本文件整体替换（含 FileAttachButton 用到的两个）
vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  exists: vi.fn().mockResolvedValue(false),
  mkdir: vi.fn(),
  readDir: vi.fn().mockResolvedValue([]),
  stat: vi.fn(),
}));

const mockOpenDialog = vi.mocked(openDialog);
const mockStat = vi.mocked(stat);
const mockReadFile = vi.mocked(readFile);

beforeEach(() => {
  vi.clearAllMocks();
  mockStat.mockResolvedValue({ mtime: new Date('2026-08-12T00:00:00Z') } as never);
  mockReadFile.mockResolvedValue(new Uint8Array([1, 2, 3]));
});

/** 打开菜单并点某一项（'图片' / '视频' / '文件'） */
async function pickMenu(label: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '发送文件' }));
  await user.click(await screen.findByText(label));
}

describe('单发不回归：没有 onFilesSelect 时，文件选择器恒为单选', () => {
  it('不传 onFilesSelect ⇒ 图片也只允许单选（multiple: false）', async () => {
    mockOpenDialog.mockResolvedValue('/tmp/a.jpg' as never);
    const onFileSelect = vi.fn();

    render(<FileAttachButton onFileSelect={onFileSelect} />);
    await pickMenu('图片');

    await waitFor(() => expect(mockOpenDialog).toHaveBeenCalledTimes(1));
    expect(mockOpenDialog.mock.calls[0][0]).toMatchObject({ multiple: false });
    await waitFor(() => expect(onFileSelect).toHaveBeenCalledTimes(1));
    // 单选路径必须把本地路径一并交出去（本地缓存映射依赖它）
    expect(onFileSelect.mock.calls[0][1]).toBe('image');
    expect(onFileSelect.mock.calls[0][2]).toBe('/tmp/a.jpg');
  });

  // ⚠️ 下面两条自 M-5（预发送待发区）起**口径已变**，不是回归：
  // 待发区支持混合类型与任意个数，且「选 1 个」也必须先进待发区
  // （用户可能先加 1 张、再加 1 张，中间还要打字，不该有绕过待发区的路径）。
  // 原来的两条断言写的是旧相册面板的分叉（文件只能单选 / 1 张直接发），已随该面板一同作废。
  it('给了 onFilesSelect + 选「文件」⇒ 同样允许多选，并整批交给待发区', async () => {
    mockOpenDialog.mockResolvedValue(['/tmp/a.pdf', '/tmp/b.pdf'] as never);
    const onFileSelect = vi.fn();
    const onFilesSelect = vi.fn();

    render(<FileAttachButton onFileSelect={onFileSelect} onFilesSelect={onFilesSelect} />);
    await pickMenu('文件');

    await waitFor(() => expect(mockOpenDialog).toHaveBeenCalledTimes(1));
    expect(mockOpenDialog.mock.calls[0][0]).toMatchObject({ multiple: true });
    await waitFor(() => expect(onFilesSelect).toHaveBeenCalledTimes(1));
    expect(onFilesSelect.mock.calls[0][1]).toBe('file');
    expect(onFilesSelect.mock.calls[0][0].map((p: { localPath: string }) => p.localPath))
      .toEqual(['/tmp/a.pdf', '/tmp/b.pdf']);
    expect(onFileSelect).not.toHaveBeenCalled();
  });

  it('给了 onFilesSelect 且只选中 1 个 ⇒ 也走 onFilesSelect（进待发区），不绕过', async () => {
    mockOpenDialog.mockResolvedValue(['/tmp/only.jpg'] as never);
    const onFileSelect = vi.fn();
    const onFilesSelect = vi.fn();

    render(<FileAttachButton onFileSelect={onFileSelect} onFilesSelect={onFilesSelect} />);
    await pickMenu('图片');

    await waitFor(() => expect(onFilesSelect).toHaveBeenCalledTimes(1));
    expect(onFilesSelect.mock.calls[0][0]).toHaveLength(1);
    expect(onFilesSelect.mock.calls[0][0][0].localPath).toBe('/tmp/only.jpg');
    expect(onFileSelect).not.toHaveBeenCalled();
  });
});

describe('相册入口：给了 onFilesSelect 且选的是媒体 ⇒ 允许多选并整批交出', () => {
  it('图片允许多选（multiple: true）', async () => {
    mockOpenDialog.mockResolvedValue(['/tmp/a.jpg', '/tmp/b.jpg'] as never);

    render(<FileAttachButton onFileSelect={vi.fn()} onFilesSelect={vi.fn()} />);
    await pickMenu('图片');

    await waitFor(() => expect(mockOpenDialog).toHaveBeenCalledTimes(1));
    expect(mockOpenDialog.mock.calls[0][0]).toMatchObject({ multiple: true });
  });

  it('视频同样允许多选（相册可混发图片/视频）', async () => {
    mockOpenDialog.mockResolvedValue(['/tmp/a.mp4', '/tmp/b.mp4'] as never);

    render(<FileAttachButton onFileSelect={vi.fn()} onFilesSelect={vi.fn()} />);
    await pickMenu('视频');

    await waitFor(() => expect(mockOpenDialog).toHaveBeenCalledTimes(1));
    expect(mockOpenDialog.mock.calls[0][0]).toMatchObject({ multiple: true });
  });

  it('选中 3 张 ⇒ 整批交给 onFilesSelect，且**顺序即用户选择顺序**（它就是组内位次）', async () => {
    mockOpenDialog.mockResolvedValue(['/tmp/1.jpg', '/tmp/2.png', '/tmp/3.gif'] as never);
    const onFileSelect = vi.fn();
    const onFilesSelect = vi.fn();

    render(<FileAttachButton onFileSelect={onFileSelect} onFilesSelect={onFilesSelect} />);
    await pickMenu('图片');

    await waitFor(() => expect(onFilesSelect).toHaveBeenCalledTimes(1));
    const [picked, type] = onFilesSelect.mock.calls[0] as [PickedFile[], string];
    expect(type).toBe('image');
    // 顺序整体比对：位次由这个数组下标直接决定，乱序 = 相册顺序错乱
    expect(picked.map((p) => p.localPath)).toEqual(['/tmp/1.jpg', '/tmp/2.png', '/tmp/3.gif']);
    expect(picked.map((p) => p.file.name)).toEqual(['1.jpg', '2.png', '3.gif']);
    // 走了相册就不该再触发单发（否则会多发一条散图）
    expect(onFileSelect).not.toHaveBeenCalled();
  });
});
