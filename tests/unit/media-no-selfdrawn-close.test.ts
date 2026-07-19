/**
 * 契约测试：独立媒体预览窗（label 'media'）禁止自绘关闭按钮 / DOM window.close()。
 *
 * 背景：媒体窗创建时 decorations: true（src/media/api.ts openMediaWindow），已有原生标题栏
 * 关闭按钮。DOM `window.close()` 在 Tauri webview 里关不掉 OS 窗口，只会把文档清空留纯白页。
 * 因此 MediaPreviewPage 内不得出现自绘关闭按钮（.media-close-btn）或任何 window.close() 调用，
 * 窗口关闭一律走原生标题栏。
 *
 * 静态扫描守门（与 secure-display-routing / animation-conflict 同套路）：
 * vitest 静态扫描读源码用 __dirname，见 .claude/rules/frontend-test.md。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MEDIA_PREVIEW = readFileSync(
  resolve(__dirname, '../../src/media/MediaPreviewPage.tsx'),
  'utf-8',
);

describe('MediaPreviewPage 无自绘关闭按钮（只用原生标题栏关闭）', () => {
  it('源码不含 media-close-btn（自绘关闭按钮 className）', () => {
    expect(MEDIA_PREVIEW).not.toContain('media-close-btn');
  });

  it('源码不含 window.close()（Tauri webview 里关不掉 OS 窗口，只留白页）', () => {
    expect(MEDIA_PREVIEW).not.toContain('window.close()');
  });
});
