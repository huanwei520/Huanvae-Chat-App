/**
 * 移动端安全区契约：index.html 的 viewport 必须含 viewport-fit=cover
 *
 * 背景：App 在 Android（targetSdk 36，edge-to-edge）/ iOS 上画到状态栏与导航栏底下，
 * 移动端十余处 CSS（header.css / tab-bar.css / drawer / *-page.css …）用
 * `env(safe-area-inset-top/bottom)` 避让系统栏。但 **缺 viewport-fit=cover 时
 * WebView 里 env(safe-area-inset-*) 一律取 fallback 0** → 顶部贴状态栏、底部 TabBar
 * 被三键导航栏遮住（2026-06 工业平板 T17X 实测）。本测试防回归到删除 viewport-fit。
 *
 * 与 tests/App/AppKeychainLogin.test.tsx 一致：vitest 下用 __dirname。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const INDEX_HTML = readFileSync(resolve(__dirname, '../index.html'), 'utf-8');

describe('移动端安全区 viewport 契约', () => {
  it('index.html 的 viewport meta 含 viewport-fit=cover（否则 env(safe-area-inset-*) 全为 0）', () => {
    const m = INDEX_HTML.match(/<meta\s+name=["']viewport["'][^>]*\bcontent=["']([^"']+)["']/i);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/viewport-fit\s*=\s*cover/);
  });

  it('安全区 CSS 仍在使用 env(safe-area-inset-*)（确保 viewport-fit 有消费方，非空配置）', () => {
    const header = readFileSync(resolve(__dirname, '../src/styles/mobile/header.css'), 'utf-8');
    const tabBar = readFileSync(resolve(__dirname, '../src/styles/mobile/tab-bar.css'), 'utf-8');
    expect(header).toMatch(/env\(\s*safe-area-inset-top/);
    expect(tabBar).toMatch(/env\(\s*safe-area-inset-bottom/);
  });
});
