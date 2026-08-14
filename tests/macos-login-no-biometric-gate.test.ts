/**
 * 不变量：macOS「已保存账号直接登录」这条路径上不得存在生物识别（Touch ID）门禁。
 *
 * ## 为什么需要这条守卫（2026-08-13 真机定性得来）
 * v1.1.23 及更早，`macos_credential_store::get_password()` 在解密前会先过一道
 * `macos_biometric::authenticate()`。在**没有 Touch ID 硬件**的机器上它返回 `Unavailable`，
 * 于是选已保存账号登录**必然失败**、只能回退手动输密码 —— 真机实测：点「登陆」约 2 秒后红字
 * 「Touch ID 未通过，请手动输入密码登录」。v1.1.24（`ee58f2d`）把这道门禁摘掉，登录改为直接解密。
 *
 * ## 这条守卫补的是哪个缺口
 * `tests/App/AppKeychainLogin.test.tsx` 已经守住了**前端**（App.tsx 不许再出现 biometric 分支），
 * 但门禁的真身在 **Rust 侧**。如果有人把 `macos_biometric::authenticate()` 重新加回
 * `get_password()`，前端那条守卫**不会翻红**（前端只会走到「读取保存的密码失败，请手动登录」
 * 这条既有分支），无 Touch ID 机器上的登录就此静默回归。所以真值源必须自己被守住。
 *
 * ## 为什么必须在【剥掉注释的代码】上判
 * `macos_credential_store.rs` 的注释里**正当地**写着「打开 VPN 前的生物识别是另一条独立路径
 * （`biometric_authenticate` 命令 → `macos_biometric`）」—— 那是准确且有价值的文档。
 * 裸 grep 会把它算成违规，逼后来者**删掉正确的注释**才能过闸门（对齐
 * `.claude/rules/frontend-test.md`「不变量口径写『禁裸写死』…且要在【剥掉注释的代码】上判」）。
 * 用例 2 把「原文有、剥后没有」两件事都断言掉，所以剥注释器一旦失效，这条守卫会**翻红而不是空转**。
 *
 * ## 本守卫防不住什么（静态契约测试要写清自己的边界）
 * - `stripComments` 是行首判定，**不剥行尾注释**（`let x = 1; // …`）。有人把 `macos_biometric`
 *   只写在行尾注释里会被误判违规；反过来不会漏放行（代码部分仍在行内、照样命中）。
 * - 它守的是「不许调用生物识别」，**不守**「登录一定能成功」——后者要真机。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// 与 tests/App/*.test.tsx 一致用 __dirname（vitest 下 import.meta.url 非标准 file:// scheme）。
const SRC_TAURI = resolve(__dirname, '../src-tauri/src');
const CRED_STORE_PATH = resolve(SRC_TAURI, 'macos_credential_store.rs');
const LIB_PATH = resolve(SRC_TAURI, 'lib.rs');
const BIOMETRIC_PATH = resolve(SRC_TAURI, 'macos_biometric.rs');

// 与 tests/huanvaeguard-port-resolution.test.ts 同款：行首判定剥掉 `//` `///` `//!` 与块注释。
// 🔴 这条注释故意用行注释写：块注释里出现块注释结束符会把注释**提前截断**，
//    后面的正文变成裸代码 → esbuild 报一个指向别处的语法错（本文件初版就踩了这一脚）。
function stripComments(src: string): string {
  const kept: string[] = [];
  let inBlock = false;
  for (const line of src.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (inBlock) {
      if (trimmed.includes('*/')) inBlock = false;
      continue;
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlock = true;
      continue;
    }
    if (trimmed.startsWith('*') || trimmed.startsWith('//')) continue;
    kept.push(line);
  }
  return kept.join('\n');
}

const CRED_STORE_RAW = readFileSync(CRED_STORE_PATH, 'utf-8');
const CRED_STORE_CODE = stripComments(CRED_STORE_RAW);
const LIB_CODE = stripComments(readFileSync(LIB_PATH, 'utf-8'));

/** 登录路径上一旦出现其中任何一个，就等于门禁回来了。 */
const BIOMETRIC_CALL_MARKERS = [
  'macos_biometric',
  'BiometricResult',
  'LAContext',
  'evaluatePolicy',
  'biometric_unavailable',
];

describe('macOS 已保存账号登录路径不得有生物识别门禁（Rust 真值源）', () => {
  it('macos_credential_store.rs 的【代码】里没有任何生物识别调用', () => {
    for (const marker of BIOMETRIC_CALL_MARKERS) {
      expect(
        CRED_STORE_CODE.includes(marker),
        `登录路径回归：macos_credential_store.rs 的代码里出现了 ${marker}。` +
          `v1.1.24 已把 Touch ID 门禁从 get_password() 摘掉；无 Touch ID 硬件的机器上` +
          `重新引入它 = 已保存账号无法直接登录。`,
      ).toBe(false);
    }
  });

  it('扫描器非空转：剥注释器真的在干活（合成样本自证）+ 被测文件原文确实含该串', () => {
    // 🔴 这条**只验剥注释器与"串确实存在"**，刻意不重复用例 1 的不变量断言 ——
    //    否则「把门禁加回代码」这一个变异会同时红两条，守卫就没对准（红一片 ≠ 精准）。
    const sample = ['//! macos_biometric 在行注释里', '/// macos_biometric 也在行注释里', 'let x = 1;'].join('\n');
    expect(sample).toContain('macos_biometric');
    expect(stripComments(sample)).not.toContain('macos_biometric');
    // 被测文件原文确实含该串（写在注释里）⇒ 用例 1 的 false 不是"串根本不存在"这种空转。
    expect(CRED_STORE_RAW).toContain('macos_biometric');
  });

  it('同类正对照：lib.rs 的【代码】里仍有 macos_biometric::authenticate（VPN 路径）', () => {
    // 与被测对象同类（同为「剥注释后的 Rust 代码里找模块调用」）。
    // 它命中 ⇒ 用例 1 的 not.toContain 在「真的存在时」是能翻红的，不是判据没区分力。
    expect(LIB_CODE).toContain('macos_biometric::authenticate');
  });

  it('VPN 那条独立路径原样保留（本不变量只约束登录路径，不许顺手把生物识别整个删掉）', () => {
    expect(existsSync(BIOMETRIC_PATH)).toBe(true);
    const bio = readFileSync(BIOMETRIC_PATH, 'utf-8');
    expect(bio).toMatch(/pub fn authenticate\s*\(/);
    expect(bio).toMatch(/pub enum BiometricResult/);
    // 三态齐全：无硬件必须仍能被表达成 Unavailable，调用方才有回退依据。
    expect(bio).toMatch(/Unavailable/);
  });
});
