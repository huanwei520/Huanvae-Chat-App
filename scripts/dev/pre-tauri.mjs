#!/usr/bin/env node
/**
 * pnpm tauri <任何子命令> 之前的通用 pre-hook，承担三件事：
 *
 * 1. 拉取并校验 macOS VPN 守护进程二进制（所有平台都调，脚本自身在非 macOS
 *    上 no-op）。该二进制不入仓，由 scripts/dev/fetch-hg-macos.mjs 在构建期
 *    下载并按 sha256 校验。拉取失败或校验不通过必须硬失败中止构建 —— 绝不
 *    容忍带着未经校验（或缺失）的守护进程二进制继续 tauri build。
 *
 * 2. Windows 下 huanvaeguard-svc.exe 如果在跑，会锁住
 *    src-tauri/resources/HuanvaeGuard/huanvaeguard-svc.exe，导致 cargo
 *    build-script 的 rerun-if-changed 复制失败（os error 32）。启动 tauri
 *    dev/build 前先停掉它；Tauri 自身的 setup() 里 spawn_start_on_boot
 *    会在进程启动后重新拉起，所以用户无感。这一步是尽力而为，失败仅告警不中止。
 *
 * 3. 拉取并校验 Windows VPN 服务二进制（所有平台都调，脚本自身在非 Windows
 *    上 no-op），规则同第 1 步。**必须排在第 2 步之后**：它要 rename 覆盖
 *    src-tauri/resources/HuanvaeGuard/huanvaeguard-svc.exe，而正在运行的服务
 *    独占锁着该文件，不先停服务就会覆盖失败。
 */

import { execFileSync } from 'node:child_process';
import { platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 以本文件所在目录解析同级脚本路径，不依赖调用方 cwd
const scriptDir = dirname(fileURLToPath(import.meta.url));

/**
 * 跑一个构建期二进制拉取脚本。脚本自身负责平台门（非目标平台 no-op 退 0），
 * 这里只负责「失败即中止」：未经校验的二进制绝不能进构建产物。
 */
function runFetch(fileName, label) {
  try {
    execFileSync(process.execPath, [join(scriptDir, fileName)], { stdio: 'inherit' });
  } catch (err) {
    console.error(
      `[pre-tauri] ${label} VPN 二进制拉取/校验失败，构建中止：`,
      err?.message ?? err,
    );
    process.exit(1);
  }
}

// 1. macOS 守护进程二进制（非 macOS 上该脚本自身 no-op 退 0）
runFetch('fetch-hg-macos.mjs', 'macOS');

// 2. 仅 Windows：先停服务，释放它对 huanvaeguard-svc.exe 的独占锁
if (platform() === 'win32') {
  try {
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        'scripts/dev/hg-service.ps1',
        '-Action',
        'stop',
      ],
      { stdio: 'inherit' },
    );
  } catch (err) {
    console.warn(
      '[pre-tauri] hg-service stop failed (continuing anyway):',
      err?.message ?? err,
    );
  }
}

// 3. Windows VPN 服务二进制（非 Windows 上该脚本自身 no-op 退 0）
//    必须在第 2 步之后：服务在跑时该 exe 被独占锁，rename 覆盖会失败。
runFetch('fetch-hg-windows.mjs', 'Windows');
