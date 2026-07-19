/**
 * 契约守门：子窗口生命周期必须跟随主会话
 *
 * 两条路径都要让所有非 main 子窗口（lan-transfer / stocks-research / miniapp-* 动态 /
 * meeting / theme-editor / lowcode-editor / huanvae-guard / media）关闭：
 * - 登出：SessionContext.clearSession 开头 invoke('close_child_windows')（Rust 侧集中关窗，
 *   绕开前端 ACL 与动态 label 枚举问题）。
 * - 主窗口关闭：lib.rs on_window_event 的 main CloseRequested 分支在 prevent_close/hide
 *   （隐藏到托盘）之前先 close_all_child_windows。
 *
 * 手法：vitest/jsdom 无真窗口，窗口关闭链路只能【静态锁】（readFileSync + 块内有界正则，
 * 见 .claude/rules/frontend-test.md「静态扫描断言要块内有界」）。
 * 变异验证（node）：删掉 invoke 调用 / close_all_child_windows 调用 / handler 注册项，
 * 对应断言正则从 true 翻 false。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string): string => readFileSync(resolve(__dirname, '../..', p), 'utf-8');
const SESSION_CONTEXT = read('src/contexts/SessionContext.tsx');
const LIB_RS = read('src-tauri/src/lib.rs');

describe('登出联动关闭子窗口（SessionContext.clearSession）', () => {
  it('clearSession 函数块内（首个 } 之前）invoke close_child_windows', () => {
    // 块内有界：[^}] 不跨出 clearSession 开头到首个 } 的区间，invoke 调用必须位于函数体开头段
    expect(SESSION_CONTEXT).toMatch(
      /const clearSession = useCallback\(async \(\) => \{[^}]*invoke\('close_child_windows'\)/,
    );
  });
});

describe('主窗口关闭联动关闭子窗口（lib.rs）', () => {
  it('CloseRequested 主窗口分支块内先 close_all_child_windows 再 prevent_close', () => {
    // 块内有界：锚定 main 分支条件后的 {，[^}] 不跨出该块；同时锁定"先关子窗、后进托盘"顺序
    expect(LIB_RS).toMatch(
      /&& window\.label\(\) == "main"\s*\{[^}]*close_all_child_windows\(window\.app_handle\(\)\);[^}]*api\.prevent_close\(\);/,
    );
  });

  it('generate_handler 列表注册了 close_child_windows 命令', () => {
    // 有界：close_child_windows 注册在列表内首个 ] 之前（cfg 属性行的 ] 在其后），[^\]] 不跨出
    expect(LIB_RS).toMatch(/tauri::generate_handler!\[[^\]]*\bclose_child_windows\b/);
  });
});
