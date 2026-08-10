/**
 * 契约：拉系统安装器的调用**永远不许被 await**
 *
 * 为什么需要一条静态契约测试来守它 ——
 *
 * `tauri-plugin-android-package-install` 2.0.2 的 Kotlin `install` 命令
 * （`android/src/main/java/PackageInstallPlugin.kt`）在**所有路径**上都不调
 * `invoke.resolve()` / `invoke.reject()`：
 *
 * ```kotlin
 * @Command
 * fun install(invoke: Invoke) {
 *   …
 *   try { activity.startActivity(installIntent) }
 *   catch (e: ActivityNotFoundException) { Toast… }
 *   catch (e: SecurityException) { Toast… }
 * }   // ← 没有 resolve，也没有 reject
 * ```
 *
 * 所以成功路径上底层 invoke 的 Promise **永远不会 settle**。一旦谁写了
 * `await installApk(...)`，那一行之后的代码就永久执行不到 —— 这正是「切回来只剩一个
 * 卡死的满进度条」的直接机制（旧实现 `await install()` 后面的 `dismiss()` 从未执行，
 * 也从未进 `catch`）。
 *
 * ⚠️ 这个回归**行为测试抓不到**：单测里的 mock 返回 undefined，`await undefined`
 * 立即 resolve，误加的 await 照样全绿。真机上才会挂 —— 上一次就是靠 Android 14
 * 模拟器 logcat（`调用系统安装器` 2 次 / `✓ 已启动` 0 次 / `✗ 失败` 0 次）才定位到。
 * 因此只能用源码级静态契约守。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 剥掉注释，只留代码
 *
 * 🔴 必须剥：这两个文件的注释里就**如实写着** `await install()` 永不返回 之类的说明文字，
 * 直接在全文上断言「不含 await install(」会被自己的文档命中 ⇒ 恒 FAIL（第一版就踩了）。
 * 反过来，若为了绕开而把断言写松，就会漏掉真正的违规代码。所以只能在剥掉注释的代码上判。
 *
 * 行注释只在**字符串外**才算注释，避免把 `'http://…'` 里的 `//` 当成注释起点。
 */
function stripComments(src: string): string {
  let out = '';
  let inBlock = false;

  for (const line of src.split(/\r?\n/)) {
    let kept = '';
    let i = 0;

    while (i < line.length) {
      if (inBlock) {
        const end = line.indexOf('*/', i);
        if (end === -1) {
          i = line.length;
        } else {
          inBlock = false;
          i = end + 2;
        }
        continue;
      }

      const ch = line[i];
      const next = line[i + 1];

      if (ch === '/' && next === '*') {
        inBlock = true;
        i += 2;
        continue;
      }
      if (ch === '/' && next === '/') {
        break; // 行注释：本行剩余全丢
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        // 原样拷走整个字符串字面量（含转义），里面的 // 不算注释
        const quote = ch;
        kept += ch;
        i += 1;
        while (i < line.length) {
          if (line[i] === '\\') {
            kept += line.slice(i, i + 2);
            i += 2;
            continue;
          }
          kept += line[i];
          i += 1;
          if (line[i - 1] === quote) {
            break;
          }
        }
        continue;
      }

      kept += ch;
      i += 1;
    }

    out += `${kept}\n`;
  }

  return out;
}

const SERVICE_PATH = resolve(__dirname, '../../src/update/service.android.ts');
const STORE_PATH = resolve(__dirname, '../../src/update/store.ts');

const SERVICE_SRC = stripComments(readFileSync(SERVICE_PATH, 'utf-8'));
const STORE_SRC = stripComments(readFileSync(STORE_PATH, 'utf-8'));

/** `await installApk(` / `await  installApk (` 等写法（注释里的自然语言不会命中） */
const AWAITED_INSTALL = /await\s+installApk\s*\(/;

describe('installApk 契约：不可 await（插件成功路径永不 settle）', () => {
  it('installApk 必须是同步 void 函数，不能声明成 async', () => {
    // 同步函数 ⇒ 返回 undefined ⇒ 就算有人误写 await 也只是空转，不会永久挂起；
    // 而 async 版本会把「永不 settle 的 invoke」原样传染给调用方。
    expect(SERVICE_SRC).toMatch(/^export function installApk\(/m);
    expect(SERVICE_SRC).not.toMatch(/export\s+async\s+function\s+installApk\s*\(/);
  });

  it('installApk 内部也不许 await 底层 install()（要 void + .catch 收口）', () => {
    expect(SERVICE_SRC).not.toMatch(/await\s+install\s*\(/);
    expect(SERVICE_SRC).toMatch(/void\s+install\s*\(\s*apkPath\s*\)\s*\.catch\(/);
  });

  it('store 的任何调用点都不许 await installApk(...)', () => {
    expect(STORE_SRC).not.toMatch(AWAITED_INSTALL);
  });

  it('stripComments 本身没把代码吃掉（正对照：真代码里的锚点还在）', () => {
    // 🔴 剥注释的实现要是把整段代码误删了，上面所有 not.toMatch 都会「因为空文件而通过」。
    //    先证明剥完之后代码还在，那些否定断言才有意义。
    expect(SERVICE_SRC).toContain('export function installApk(');
    expect(STORE_SRC).toContain('installReadyApk:');
    // 注释里的说明文字确实被剥掉了（否则否定断言会被自己的文档命中）
    expect(SERVICE_SRC).not.toContain('永不返回');
  });

  it('上面那条断言不是恒真的（变异验证：注入 await 后必须翻红）', () => {
    // 🔴 不做这一步，一个写歪的正则会永远 PASS，等于没有守卫。
    //    这里把「误加 await」的写法注入源码副本，断言正则**真的**能抓到它。
    const mutated = STORE_SRC.replace(
      'installApk(localPath, (message) => {',
      'await installApk(localPath, (message) => {',
    );
    expect(mutated).not.toBe(STORE_SRC); // 锚点还在，替换确实发生了
    expect(mutated).toMatch(AWAITED_INSTALL);
  });
});
