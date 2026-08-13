/**
 * 文件消息正文解析：本地必须与后端 `resolve_content` 同口径
 *
 * 真值源：`Huanvae-Chat-Rust/src/storage/handlers/upload.rs`
 * - :465-469 派生正文 = `[图片] {filename}` / `[视频] {filename}` / `[文件] {filename}`
 * - :115-127 `resolve_content`：caption 去空白后非空 ⇒ 取代派生正文，否则用派生正文
 *
 * 🔴 这条曾经是错的（本地写成裸 `file.name`），后果是**同一条消息「自己看到的正文」
 * 与「对方看到的正文」形状不同**，并且把下游「这串文字像不像文件名」的判定一起带偏。
 */

import { describe, it, expect } from 'vitest';
import { resolveUploadedContent } from '../../src/chat/shared/uploadPersist';

describe('resolveUploadedContent', () => {
  it('无配文 ⇒ 派生正文带 [标签] 前缀（三种类型各一条）', () => {
    expect(resolveUploadedContent(undefined, 'image', 'a.jpg')).toBe('[图片] a.jpg');
    expect(resolveUploadedContent(undefined, 'video', 'b.mp4')).toBe('[视频] b.mp4');
    expect(resolveUploadedContent(undefined, 'file', 'c.pdf')).toBe('[文件] c.pdf');
  });

  it('🔴 反向：绝不产出裸文件名（那正是被修掉的写法）', () => {
    expect(resolveUploadedContent(undefined, 'image', 'a.jpg')).not.toBe('a.jpg');
  });

  it('有配文 ⇒ 取代派生正文（单图配文这一格靠它成立）', () => {
    expect(resolveUploadedContent('看这个', 'image', 'a.jpg')).toBe('看这个');
  });

  it('配文前后空白被去掉；纯空白视同没有配文', () => {
    expect(resolveUploadedContent('  看这个  ', 'image', 'a.jpg')).toBe('看这个');
    expect(resolveUploadedContent('   ', 'image', 'a.jpg')).toBe('[图片] a.jpg');
    expect(resolveUploadedContent('', 'video', 'b.mp4')).toBe('[视频] b.mp4');
  });

  it('配文恰好长得像文件名时仍按配文处理（不做"像不像文件名"的猜测）', () => {
    // 之前渲染侧为兜住上游缺陷加过一条「裸文件名不算配文」的规则，代价就是这种真配文被漏显。
    // 上游修正后这里必须原样返回，那条兜底规则才能被删掉。
    expect(resolveUploadedContent('notes.txt', 'file', 'report.pdf')).toBe('notes.txt');
  });
});
