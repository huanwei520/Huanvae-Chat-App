/**
 * 契约测试：Rust 后台下载（triggerBackgroundDownload / downloadAndSaveFile）的首参必须是
 * **原始 presigned URL**，绝不能是 useFileCache/useVideoCache 返回的反代显示 `src`。
 *
 * 背景：no-SNI/私有 CA 架构下，**显示**用反代 loopback URL（resolveDisplayUrl → secureProxy），
 * 但 **Rust 下载**走另一条路：downloadAndSaveFile 内部 `directIpUrl()` 把 URL 的 host 改写成源站 IP
 * 再用 pinned client 直连。若把反代 loopback URL（http://127.0.0.1:PORT/...）传给下载，directIpUrl
 * 会把它改写成 `https://<源站IP>:<port>/<反代内部路径>?...` —— 源站 nginx 不认这个路径 → **HTTP 400**。
 *
 * 这是一条**架构不变量**：历史上聊天侧 11 个下载点错把显示 `src` 喂给下载（2026-06-08 用户实测 zip
 * 文档下载 400 暴露）。修复是统一改成 `presignedUrl ?? src`（原始优先）。本测试把该不变量变成机器可强制：
 * 静态扫描所有下载调用点，发现裸 `src`/`result.src`/`previewSrc` 作首参即 FAIL，防回归。
 * vitest jsdom + mock invoke 测不到真实 directIpUrl + TLS，故用源码静态扫描守门（与
 * secure-display-routing / animation-conflict 同套路；读源码用 __dirname，见 .claude/rules/frontend-test.md）。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(rel: string): string {
  return readFileSync(resolve(__dirname, '..', rel), 'utf-8');
}

/** 所有含下载调用点的源文件。 */
const DOWNLOAD_SITES = [
  'src/chat/shared/DocumentDownloadAction.tsx',
  'src/chat/shared/FileMessageContent.tsx',
  'src/components/files/FilesModal.tsx',
  'src/components/files/FileMenuController.tsx',
  'src/hooks/useFileCache.ts',
  'src/pages/mobile/MobileFilesPage.tsx',
  'src/media/MediaPreviewPage.tsx',
] as const;

/**
 * 负向不变量：下载函数的首参不得是裸的"显示 src"标识符。
 * \s* 跨换行，覆盖单行与多行两种调用写法。命中任一即说明有调用点回退到反代 src。
 */
const BARE_SRC_FIRST_ARG =
  /(?:triggerBackgroundDownload|downloadAndSaveFile)\(\s*(?:src|result\.src|previewSrc|currentResult\.src)\s*,/;

describe('Rust 下载首参必须是原始 presigned URL（禁止反代显示 src）', () => {
  it.each(DOWNLOAD_SITES)('%s 不得把裸 src/result.src/previewSrc 当下载首参', (file) => {
    const code = read(file);
    expect(code).not.toMatch(BARE_SRC_FIRST_ARG);
  });
});

describe('各下载调用点采用原始 URL 收口写法（正向覆盖，删则配套负向触发）', () => {
  it('DocumentDownloadAction：解构 presignedUrl + 传 presignedUrl ?? src', () => {
    const code = read('src/chat/shared/DocumentDownloadAction.tsx');
    expect(code).toMatch(/const \{[^}]*\bpresignedUrl\b[^}]*\} = useFileCache\(/);
    expect(code).toMatch(/triggerBackgroundDownload\(presignedUrl \?\? src,/);
  });

  it('FileMessageContent：图片/视频/文档 5 个下载点均用 presignedUrl ?? src', () => {
    const code = read('src/chat/shared/FileMessageContent.tsx');
    // 单行 + 多行两种形态合计应 >= 5（image×1 + video×3 + document×1）
    const hits = code.match(/triggerBackgroundDownload\(\s*presignedUrl \?\? src,/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(5);
    // 文档分支的 useFileCache 必须解构出 presignedUrl
    expect(code).toMatch(/const \{[^}]*\bpresignedUrl\b[^}]*\} = useFileCache\(/);
  });

  it('FilesModal：文档卡片解构 presignedUrl + 传 presignedUrl ?? src', () => {
    const code = read('src/components/files/FilesModal.tsx');
    expect(code).toMatch(/const \{[^}]*\bpresignedUrl\b[^}]*\} = useFileCache\(/);
    expect(code).toMatch(/triggerBackgroundDownload\(\s*presignedUrl \?\? src,/);
  });

  it('useFileCache：cacheFile 与 openInFolder 重下载均用 presignedUrl ?? src', () => {
    const code = read('src/hooks/useFileCache.ts');
    const hits = code.match(/triggerBackgroundDownload\(\s*currentResult\.presignedUrl \?\? currentResult\.src,/g) ?? [];
    expect(hits.length).toBe(2);
  });

  it('MobileFilesPage：视频触发用 result.presignedUrl ?? result.src，预览菜单用 previewDownloadUrl', () => {
    const code = read('src/pages/mobile/MobileFilesPage.tsx');
    expect(code).toMatch(/triggerBackgroundDownload\(\s*result\.presignedUrl \?\? result\.src,/);
    expect(code).toMatch(/const \[previewDownloadUrl, setPreviewDownloadUrl\] = useState\(/);
    expect(code).toMatch(/triggerBackgroundDownload\(\s*previewDownloadUrl,/);
  });

  it('MediaPreviewPage：独立预览窗下载用 presignedUrl（原始）', () => {
    const code = read('src/media/MediaPreviewPage.tsx');
    // downloadAndSaveFile / triggerBackgroundDownload 首参均为 presignedUrl（非反代 src）
    expect(code).toMatch(/(?:downloadAndSaveFile|triggerBackgroundDownload)\(\s*(?:fileSource\.)?presignedUrl[,)]/);
  });

  it('FileMenuController：lazy 从 getPresignedUrl 拿原始 url 下载', () => {
    const code = read('src/components/files/FileMenuController.tsx');
    expect(code).toMatch(/triggerBackgroundDownload\(\s*result\.url,/);
  });
});
