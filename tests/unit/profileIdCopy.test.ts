/**
 * 自己资料 @id 可点复制（静态扫描）
 *
 * AvatarUploader 里 @userId 从静态文本改为可点复制按钮（写入剪贴板）。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(resolve(__dirname, '../../src/components/profile/AvatarUploader.tsx'), 'utf-8');

describe('AvatarUploader @id 复制', () => {
  it('@userId 是可点按钮，点击写剪贴板', () => {
    // 块内有界：button 元素上带 clipboard.writeText(session.userId)
    expect(SRC).toMatch(/navigator\.clipboard\?\.writeText\(session\.userId\)/);
    expect(SRC).toMatch(/className="profile-id"/);
    expect(SRC).toMatch(/@\{session\.userId\}/);
  });
});
