/**
 * CSS 文件编码完整性回归测试
 *
 * 背景：
 * Windows 工具链（PowerShell `Set-Content`、某些编辑器/IDE 的 Edit 实现）
 * 在写大型 UTF-8 文件时容易出现两类编码事故：
 * 1. **加 BOM**：原本 UTF-8 无 BOM，写回时加上 EF BB BF。tailwindcss 通过 @import 拼接
 *    多个 CSS 文件时，BOM 会出现在拼接流中部，触发解析异常。
 * 2. **GBK→UTF-8 mojibake**：把 UTF-8 字节当成 GBK 解释、再以 UTF-8 编码写回 →
 *    所有中文字符变成乱码（如 `释放` → `閲婃斁`）。乱码后字符数会变化，可能让
 *    CSS 中的 `'...'` 字符串丢失闭合引号 → tailwindcss 报 Unterminated string。
 *
 * 这两类问题在 vitest / typecheck / lint 都不可见（它们都不实际跑 PostCSS / tailwind 编译）。
 * 唯一能在 CI 阶段发现的是 `pnpm build`。本测试是更轻量、独立的守门：
 * - 静态检查所有 CSS 文件 1) 无 BOM 2) 无已知 mojibake 字符
 * - 不依赖完整 build，运行成本 < 1s
 *
 * 反例（2026-05-08）：
 * - 多次 Edit `src/styles/pages/main.css`（5000+ 行、大量含中文注释）后，文件被加上 BOM
 *   且全文中文变成 GBK→UTF-8 mojibake。`content: '释放以发送文件';` 乱码后字符数变化，
 *   单引号闭合丢失 → 浏览器看到 tailwindcss 报 `Unterminated string`，dev server 红屏。
 * - 当时 vitest 837/837 全绿、typecheck/lint 也无报错；只有真正跑 vite build 才暴露。
 */

/* eslint-disable no-undef */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const PROJECT_ROOT = process.cwd();
const STYLES_ROOT = resolve(PROJECT_ROOT, 'src/styles');
/* eslint-enable no-undef */

/**
 * 已知 GBK→UTF-8 mojibake 标记字符
 *
 * 这些字符在正确编码的中文文本中极少出现，几乎只在 mojibake 中出现。
 * 命中任意一个 → 强烈怀疑文件被双重编码破坏。
 *
 * 来源：常见中文（如 释、说、设、用、过、件、是、的、属、性、能、效、果）
 * 经 UTF-8→GBK→UTF-8 二次编码后产生的高频"幽灵字"。
 */
const MOJIBAKE_MARKERS = [
  '閲', // 释 → 閲...
  '銆', // 。 / 、 → 銆...
  '閿', // 错 → 閿...
  '鎺', // 接 → 鎺...
  '璁', // 设 → 璁...
  '鐢', // 用 → 鐢...
  '鏋', // 果 → 鏋...
  '杩', // 过 → 杩...
  '浠', // 件 / 仅 → 浠...
  '鏄', // 是 → 鏄...
  '鐨', // 的 → 鐨...
  '灞', // 属 → 灞...
  '€', // mojibake 中常见尾巴字符
];

/** 递归收集目录下所有 .css 文件 */
function collectCssFiles(dir: string, acc: string[] = []): string[] {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectCssFiles(full, acc);
    } else if (entry.endsWith('.css')) {
      acc.push(full);
    }
  }
  return acc;
}

const CSS_FILES = collectCssFiles(STYLES_ROOT).map((p) => relative(PROJECT_ROOT, p));

describe('CSS 文件编码完整性', () => {
  it('扫描到至少一个 CSS 文件（保护测试本身不被静默跳过）', () => {
    expect(CSS_FILES.length).toBeGreaterThan(0);
  });

  it.each(CSS_FILES)('%s 无 UTF-8 BOM', (file) => {
    const buf = readFileSync(resolve(PROJECT_ROOT, file));
    const hasBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
    expect(
      hasBom,
      `${file} 含 UTF-8 BOM（EF BB BF）。BOM 在 @import 拼接后出现在流中部会破坏 tailwindcss 解析。\n` +
        '修复：用支持 UTF-8 无 BOM 的工具重写文件，或 \`Set-Content -Encoding utf8NoBOM\`。',
    ).toBe(false);
  });

  it.each(CSS_FILES)('%s 无 GBK→UTF-8 mojibake 字符', (file) => {
    const text = readFileSync(resolve(PROJECT_ROOT, file), 'utf-8');
    for (const marker of MOJIBAKE_MARKERS) {
      const hit = text.indexOf(marker);
      if (hit >= 0) {
        // 输出周围 30 字符上下文便于定位
        const ctx = text.slice(Math.max(0, hit - 15), hit + 15);
        expect.fail(
          `${file} 含 mojibake 字符 \`${marker}\` (位置 ${hit})，上下文：\`${ctx}\`。\n` +
            '原因可能是 Edit 工具或 PowerShell 在 Windows 上把 UTF-8 字节当 GBK 重新编码。\n' +
            '修复：从 git 还原（git checkout HEAD -- <file>）后用 ASCII 注释重做修改。',
        );
      }
    }
  });
});
