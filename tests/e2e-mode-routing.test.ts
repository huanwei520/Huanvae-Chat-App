/**
 * 契约测试：real-e2e(L2.5-web)注入开关 e2eMode 的 import 面与五个注入点分支锁定。
 *
 * 背景：`src/services/e2eMode.ts` 是 e2e 专用注入开关——`VITE_E2E_BASE_URL` 仅由
 * playwright.real-e2e.config.ts 的 webServer env 注入；生产/常规构建该变量未定义 →
 * isE2E() 恒 false，全部 e2e 分支为死代码被 vite 摇树，生产路径零改变。
 *
 * 这是一条**结构不变量**：生产摇树的安全性依赖"e2e 消费面收敛到 isE2E() 这一个开关"。
 * 若 import 面失控（第六个文件悄悄 import e2eMode，或有人绕过开关直接读
 * import.meta.env.VITE_E2E_BASE_URL），测试分支就可能悄悄进入生产逻辑、或在开关之外
 * 直连本地集群——且 vitest jsdom + mock invoke 全绿也测不出来。本测试把该不变量变成
 * 机器可强制：静态扫描 src/ 全量 import 面 + 逐一锁定五个注入点分支形态，越界即 FAIL
 * （与 secure-display-routing / animation-conflict 同套路；vitest 静态扫描读源码用
 * __dirname，断言块内有界，见 .claude/rules/frontend-test.md）。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

function read(rel: string): string {
  return readFileSync(resolve(__dirname, '..', rel), 'utf-8');
}

/** 递归收集 src/ 下全部 .ts/.tsx 源文件（跳过 .d.ts），返回 POSIX 风格相对路径 */
function walkSrc(): string[] {
  const root = resolve(__dirname, '..');
  const out: string[] = [];
  const visit = (relDir: string): void => {
    for (const entry of readdirSync(join(root, relDir), { withFileTypes: true })) {
      const rel = `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        visit(rel);
      } else if (
        (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
        !entry.name.endsWith('.d.ts')
      ) {
        out.push(rel);
      }
    }
  };
  visit('src');
  return out;
}

const SRC_FILES = walkSrc();
// 每文件只读一次（walk 全量 src/ 的两条断言共用；虚拟盘 IO 慢，避免重复读）
const SRC_CONTENTS = new Map(SRC_FILES.map((rel) => [rel, read(rel)] as const));

const INJECTION_POINTS = [
  'src/App.tsx',
  'src/services/discovery.ts',
  'src/services/rustWebSocket.ts',
  'src/services/secureFetch.ts',
  'src/services/secureProxy.ts',
];

const SECURE_FETCH = read('src/services/secureFetch.ts');
const RUST_WS = read('src/services/rustWebSocket.ts');
const DISCOVERY = read('src/services/discovery.ts');
const SECURE_PROXY = read('src/services/secureProxy.ts');
const APP = read('src/App.tsx');
const E2E_MODE = read('src/services/e2eMode.ts');

describe('e2eMode import 面锁定（消费面收敛，生产摇树的前提）', () => {
  it('import e2eMode 的文件恰好 = 五个注入点（第六个 import 或五者之一移除 → FAIL）', () => {
    const importers = SRC_FILES.filter((rel) =>
      /from\s+['"][^'"]*e2eMode['"]/.test(SRC_CONTENTS.get(rel) as string),
    ).sort();
    expect(importers).toEqual(INJECTION_POINTS);
  });

  it('VITE_E2E_BASE_URL 只在 e2eMode.ts 读取（防绕过 isE2E() 开关直接读 env）', () => {
    const readers = SRC_FILES.filter((rel) =>
      (SRC_CONTENTS.get(rel) as string).includes('VITE_E2E_BASE_URL'),
    ).sort();
    expect(readers).toEqual(['src/services/e2eMode.ts']);
  });

  it('isE2E 真值源 = VITE_E2E_BASE_URL 是否注入', () => {
    expect(E2E_MODE).toMatch(/return !!import\.meta\.env\.VITE_E2E_BASE_URL/);
  });
});

describe('注入点分支形态（块内有界，删分支/改顺序即 FAIL）', () => {
  it('secureFetch：e2e 分支返回 nativeFetch，且在 invoke(secure_http) 之前拦截', () => {
    const branch = /if \(isE2E\(\)\) \{\s*return nativeFetch\(finalReq\);\s*\}/;
    expect(SECURE_FETCH).toMatch(branch);
    const branchIdx = SECURE_FETCH.search(branch);
    const invokeIdx = SECURE_FETCH.indexOf("invoke<SecureHttpResp>('secure_http'");
    expect(invokeIdx).toBeGreaterThan(-1);
    expect(branchIdx).toBeLessThan(invokeIdx);
  });

  it('rustWebSocket：构造器内 e2e 分支走原生 WebSocket，位于 ws_connect invoke 之前', () => {
    // 三点排序：constructor( < isE2E 分支 < new WebSocket(url) < invoke('ws_connect')
    const ctorIdx = RUST_WS.indexOf('constructor(');
    const branchIdx = RUST_WS.search(/if \(isE2E\(\)\) \{/);
    const nativeIdx = RUST_WS.indexOf('new WebSocket(url)');
    const connectIdx = RUST_WS.indexOf("invoke<number>('ws_connect'");
    expect(ctorIdx).toBeGreaterThan(-1);
    expect(branchIdx).toBeGreaterThan(ctorIdx);
    expect(nativeIdx).toBeGreaterThan(branchIdx);
    expect(connectIdx).toBeGreaterThan(nativeIdx);
  });

  it('discovery：resolveForSecureHttp 函数体开头即 e2e 早退（返回 null，无直连 IP 注入）', () => {
    expect(DISCOVERY).toMatch(
      /export function resolveForSecureHttp\(\)[^{]*\{\s*if \(isE2E\(\)\) \{[^}]*return null;\s*\}/,
    );
  });

  it('App：登录 + 注册两处 serverUrl 走 isE2E() ? e2eBaseUrl()（恰好 2 处）', () => {
    const hits = APP.match(/isE2E\(\)\s*\?\s*e2eBaseUrl\(\)/g) ?? [];
    expect(hits.length).toBe(2);
  });

  it('secureProxy：三个反代出口（proxyResourceUrl / resolveDisplayUrl / proxyRequestUrl）'
    + '各有 e2e 分支返回 e2eResourceUrl（恰好 3 处）', () => {
    const hits = SECURE_PROXY.match(/if \(isE2E\(\)\) \{[^}]*return e2eResourceUrl\(/g) ?? [];
    expect(hits.length).toBe(3);
  });
});
