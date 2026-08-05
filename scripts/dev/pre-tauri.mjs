#!/usr/bin/env node
/**
 * pnpm tauri <任何子命令> 之前的通用 pre-hook。
 *
 * 作用：Windows 下 huanvaeguard-svc.exe 如果在跑，会锁住
 * src-tauri/resources/HuanvaeGuard/huanvaeguard-svc.exe，导致 cargo
 * build-script 的 rerun-if-changed 复制失败（os error 32）。启动 tauri
 * dev/build 前先停掉它；Tauri 自身的 setup() 里 spawn_start_on_boot
 * 会在进程启动后重新拉起，所以用户无感。
 *
 * 非 Windows 平台直接 no-op。
 */

import { execFileSync } from 'node:child_process';
import { platform } from 'node:os';

if (platform() !== 'win32') {
  process.exit(0);
}

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
