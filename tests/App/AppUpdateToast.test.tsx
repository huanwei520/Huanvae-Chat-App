/**
 * App.tsx 更新弹窗渲染契约测试
 *
 * 验证：
 * 1. App.tsx 顶层调用 useStartupUpdateCheck()（启动时检测）
 * 2. App.tsx 4 个分支（loading / account-selector / login-register / isLoggedIn）
 *    都包含 <UpdateToast /> 渲染调用
 * 3. UpdateToast 用 createPortal 渲染，多分支互斥 → 同一时刻只一个实例（验证结构层）
 *
 * 测试形式：源码静态扫描
 * 原因：App.tsx 顶层包裹大量 hook（useAccounts/useSession/useUpdateStore 等），完整 render
 * 需要 mock 整个依赖图。结构性测试足以防止 future 改动意外移除 UpdateToast 分支。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const APP_TSX_PATH = resolve(__dirname, '../../src/App.tsx');
const APP_SOURCE = readFileSync(APP_TSX_PATH, 'utf-8');

describe('App.tsx 启动更新检查 + 弹窗渲染契约', () => {
  it('顶层调用 useStartupUpdateCheck()', () => {
    expect(APP_SOURCE).toMatch(/useStartupUpdateCheck\(\)/);
  });

  it('从 ./update 导入 UpdateToast 和 useStartupUpdateCheck', () => {
    // 宽松匹配：单一 import 内同时含 UpdateToast 和 useStartupUpdateCheck，from './update'
    // 允许后面有其他 named imports（如 useUpdateToastProps）
    expect(APP_SOURCE).toMatch(
      /import\s*\{[^}]*\bUpdateToast\b[^}]*\buseStartupUpdateCheck\b[^}]*\}\s*from\s*['"]\.\/update['"]/,
    );
  });

  it('已登录分支渲染 UpdateToast', () => {
    const isLoggedInBlock = APP_SOURCE.match(
      /if\s*\(\s*isLoggedIn\s*&&\s*session\s*\)\s*\{[\s\S]*?return\s*\([\s\S]*?<UpdateToast[\s\S]*?\);/,
    );
    expect(isLoggedInBlock).not.toBeNull();
  });

  it('loading 分支渲染 UpdateToast', () => {
    const loadingBlock = APP_SOURCE.match(
      /if\s*\(\s*currentPage\s*===\s*['"]loading['"]\s*\|\|\s*accountsLoading\s*\)\s*\{[\s\S]*?return\s*\([\s\S]*?<UpdateToast[\s\S]*?\);/,
    );
    expect(loadingBlock).not.toBeNull();
  });

  it('account-selector 分支渲染 UpdateToast', () => {
    const selectorBlock = APP_SOURCE.match(
      /if\s*\(\s*currentPage\s*===\s*['"]account-selector['"]\s*\)\s*\{[\s\S]*?return\s*\([\s\S]*?<UpdateToast[\s\S]*?\);/,
    );
    expect(selectorBlock).not.toBeNull();
  });

  it('login/register 兜底分支渲染 UpdateToast', () => {
    // login/register 是组件最后的 return（不在 if 守卫内），位于 account-selector 分支闭合后
    // 验证：account-selector 分支结束到文件末尾之间存在 <UpdateToast
    const selectorMatch = APP_SOURCE.match(
      /if\s*\(\s*currentPage\s*===\s*['"]account-selector['"]\s*\)\s*\{[\s\S]*?\n\s*\}\s*\n/,
    );
    expect(selectorMatch).not.toBeNull();
    const afterSelector = APP_SOURCE.slice(selectorMatch!.index! + selectorMatch![0].length);
    expect(afterSelector).toMatch(/<UpdateToast\s/);
  });

  it('UpdateToast 在源码中至少出现 4 次（4 个分支独立渲染）', () => {
    const matches = APP_SOURCE.match(/<UpdateToast\s/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(4);
  });

  it('useStartupUpdateCheck 在所有分支前（顶层）调用，不在 return JSX 内', () => {
    // 提取从函数开始到第一个 return 之间的代码
    const funcStart = APP_SOURCE.indexOf('function App()');
    const firstReturn = APP_SOURCE.indexOf('return', funcStart);
    const topLevelCode = APP_SOURCE.slice(funcStart, firstReturn);
    expect(topLevelCode).toMatch(/useStartupUpdateCheck\(\)/);
  });
});
