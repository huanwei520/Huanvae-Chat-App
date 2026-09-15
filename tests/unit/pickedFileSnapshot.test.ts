/**
 * pickedFile / 选图快照契约
 *
 * 背景（真机根因，2026-09-14）：安卓 WebView 下 `<input type=file>` 返回文件背衬 Blob，
 * 若在下游读取前 `input.value = ''`，底层字节即失效 —— 表现为头像裁剪确认后
 * 「图片加载失败」/ `<img>` naturalWidth=0 / `fetch(blobURL)` TypeError。
 *
 * 本测试锁两条不变量：
 *  1. snapshotPickedFile 产出的 File 与源文件**字节一致**、元数据保留，且是**新对象**（内存背衬）；
 *  2. 两个调用点（个人头像 / 群头像）都必须**先快照、后清空 input**（源码顺序契约）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { snapshotPickedFile } from '../../src/utils/pickedFile';

/** 读字节（jsdom 的 File 没有 arrayBuffer，统一走 FileReader） */
function readVia(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => { res(fr.result as ArrayBuffer); };
    fr.onerror = () => { rej(fr.error ?? new Error('read failed')); };
    fr.readAsArrayBuffer(blob);
  });
}

describe('snapshotPickedFile', () => {
  it('复制字节并保留 name/type/lastModified，且返回新对象（内存背衬）', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const src = new File([bytes], 'a.png', { type: 'image/png', lastModified: 1234567 });

    const out = await snapshotPickedFile(src);

    expect(out).not.toBe(src);
    expect(out.name).toBe('a.png');
    expect(out.type).toBe('image/png');
    expect(out.lastModified).toBe(1234567);
    expect(out.size).toBe(bytes.length);
    expect(new Uint8Array(await readVia(out))).toEqual(bytes);
  });

  it('name/type 缺失时给出安全兜底，不产生空名或空类型', async () => {
    const src = new File([new Uint8Array([1, 2])], '', {});
    const out = await snapshotPickedFile(src);
    expect(out.name).not.toBe('');
    expect(out.type).not.toBe('');
  });

  it('读取失败时原样返回源 File（把报错留给下游既有分支）', async () => {
    const broken = { name: 'x', type: 'image/png', lastModified: 1, arrayBuffer: () => Promise.reject(new Error('boom')) } as unknown as File;
    expect(await snapshotPickedFile(broken)).toBe(broken);
  });
});

describe('调用点顺序契约：先快照，后清空 input', () => {
  const cases: Array<[string, string]> = [
    ['个人头像', 'src/components/profile/AvatarUploader.tsx'],
    ['群头像', 'src/chat/group/useChatMenu.ts'],
  ];

  it.each(cases)('%s：snapshotPickedFile 出现在 value = "" 之前', (_label, rel) => {
    const src = readFileSync(resolve(process.cwd(), rel), 'utf8');
    const snap = src.indexOf('snapshotPickedFile(');
    const clear = src.indexOf("fileInputRef.current.value = ''");
    expect(snap).toBeGreaterThan(-1);
    expect(clear).toBeGreaterThan(-1);
    expect(snap).toBeLessThan(clear);
  });

  it.each(cases)('%s：不再把 input 里的 File 直接交给下游', (_label, rel) => {
    const src = readFileSync(resolve(process.cwd(), rel), 'utf8');
    expect(src).not.toMatch(/onFileSelect\(file\)/);
    expect(src).not.toMatch(/requestCrop\(e\.target\.files\[0\]\)/);
  });
});
