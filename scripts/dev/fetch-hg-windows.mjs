#!/usr/bin/env node
/**
 * Windows VPN 服务二进制（huanvaeguard-svc.exe）的构建期拉取 + 完整性校验。
 *
 * 该二进制不由本仓构建（它是另一个独立 Rust workspace 的产物），也不提交进
 * 本仓（见 .gitignore）—— 公开仓里塞这种构建产物会把内部构建路径一起带出去。
 * 所以改成构建时现取：以 src-tauri/resources/hg-windows.manifest.json 里钉死的
 * sha256 为准校验候选源，命中才落盘到 manifest.target。
 *
 * sha256 不匹配 = 硬失败（exit 1），不降级、不放行。这里必须硬失败的理由比
 * macOS 侧更强：bundle.resources 的 glob 是 resources/HuanvaeGuard/*，只要同
 * 目录的 wintun.dll 还在，glob 就仍有匹配、不会报 GlobPathNotFound，于是缺了
 * 这个 exe 的 Windows 安装包能被正常打出来；直到用户机器上 NSIS 后置钩子把服务
 * 的 binPath 指向一个不存在的文件才暴露。故障必须在构建期当场炸掉。
 *
 * 候选源按顺序尝试，第一个字节 sha256 命中的胜出：
 *   1) HG_WINDOWS_SRC 本机二进制的绝对路径
 *   2) 同级 workspace ../HuanvaeGuard/target/x86_64-pc-windows-gnu/release/hg-windows.exe
 *   3) HG_WINDOWS_URL HTTPS 下载地址（走全局 fetch）
 *
 * 上游产物名（hg-windows.exe）与本仓落盘名（huanvaeguard-svc.exe）不同：服务名
 * 与 binPath 写死在 src-tauri/windows/hooks.nsi 与 scripts/dev/hg-service.ps1 里，
 * 所以按 manifest.target 落盘改名。改名不参与、也不影响 sha256 / size 校验。
 *
 * 相关环境变量：
 *   HG_WINDOWS_SRC   见候选 1
 *   HG_WINDOWS_URL   见候选 3
 *   HG_WINDOWS_TOKEN 可选；配了就给候选 3 带 Authorization: Bearer <token> +
 *                    Accept: application/octet-stream，用于私有 Release 资产。
 *                    token 值在任何输出里都不出现（含截断形式）。
 *
 * 非 Windows 平台直接 no-op。
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 该资源只被 tauri.windows.conf.json 的 bundle.resources 打进 Windows 包，
// 其它平台既用不到也不该下载 —— 直接 no-op 退出。
if (process.platform !== 'win32') {
  process.exit(0);
}

// 本脚本位于 <root>/scripts/dev/，往上两级即仓库根。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifestPath = path.resolve(root, 'src-tauri', 'resources', 'hg-windows.manifest.json');

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
} catch (err) {
  console.error(`[fetch-hg-windows] manifest 读取/解析失败: ${manifestPath}`);
  console.error(`[fetch-hg-windows] ${err?.message ?? err}`);
  process.exit(1);
}

if (
  typeof manifest.target !== 'string' ||
  typeof manifest.sha256 !== 'string' ||
  typeof manifest.size !== 'number'
) {
  console.error(`[fetch-hg-windows] manifest 缺少必需字段 target/sha256/size: ${manifestPath}`);
  process.exit(1);
}

const expectedSha = manifest.sha256.toLowerCase();
const target = path.resolve(root, manifest.target);
const siblingPath = path.resolve(
  root,
  '..',
  'HuanvaeGuard',
  'target',
  'x86_64-pc-windows-gnu',
  'release',
  'hg-windows.exe',
);

/** 流式算文件 sha256（小写 hex），避免把整个二进制读进内存。 */
function sha256OfFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/** 算内存里字节的 sha256（小写 hex）。 */
function sha256OfBuffer(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/** 读本地候选文件；未配置或不存在返回 null（静默跳过）。 */
function readLocalCandidate(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  return fs.readFileSync(filePath);
}

/** 下载候选；token 只进请求头，绝不落到任何输出里。 */
async function downloadCandidate(url, token) {
  const headers = token
    ? { Authorization: `Bearer ${token}`, Accept: 'application/octet-stream' }
    : {};
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

// 快路径：目标已在且校验通过就什么都不做。
if (fs.existsSync(target)) {
  try {
    if ((await sha256OfFile(target)) === expectedSha) {
      console.log(`[fetch-hg-windows] 已存在且校验通过，跳过获取: ${target}`);
      process.exit(0);
    }
  } catch (err) {
    // 已有文件读不动（权限/目录/损坏）：报出来，继续走候选源重新获取。
    console.warn(`[fetch-hg-windows] 已有文件无法校验，将重新获取: ${err?.message ?? err}`);
  }
}

const candidates = [
  {
    kind: 'HG_WINDOWS_SRC',
    source: process.env.HG_WINDOWS_SRC ?? '(未配置)',
    load: () => readLocalCandidate(process.env.HG_WINDOWS_SRC),
  },
  {
    kind: 'sibling-workspace',
    source: siblingPath,
    load: () => readLocalCandidate(siblingPath),
  },
  {
    kind: 'HG_WINDOWS_URL',
    // 只记 URL 本身；HG_WINDOWS_TOKEN 永不进 source、永不打印
    source: process.env.HG_WINDOWS_URL ?? '(未配置)',
    load: () =>
      process.env.HG_WINDOWS_URL
        ? downloadCandidate(process.env.HG_WINDOWS_URL, process.env.HG_WINDOWS_TOKEN)
        : null,
  },
];

let picked = null;
for (const candidate of candidates) {
  let bytes;
  try {
    bytes = await candidate.load();
  } catch (err) {
    // 取数失败（网络 / 权限 / HTTP 非 2xx）：报明原因后换下一个候选，不静默吞。
    console.warn(`[fetch-hg-windows] ${candidate.kind} 获取失败（${candidate.source}）: ${err?.message ?? err}`);
    continue;
  }
  if (!bytes) {
    // 未配置或文件不存在 —— 静默跳过
    continue;
  }
  const actualSha = sha256OfBuffer(bytes);
  if (actualSha !== expectedSha) {
    console.warn(
      `[fetch-hg-windows] ${candidate.kind} 已拒绝：sha256 不匹配（源 ${candidate.source}，期望 ${expectedSha}，实际 ${actualSha}）`,
    );
    continue;
  }
  picked = { kind: candidate.kind, source: candidate.source, bytes, sha: actualSha };
  break;
}

if (picked) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // 同目录内先写临时文件再 rename —— 同分区原子替换，避免半截文件被打进包。
  // Windows 上 rename 覆盖已存在文件要求目标未被占用：正在运行的
  // huanvaeguard-svc 服务会独占锁住它，所以 scripts/dev/pre-tauri.mjs 会先停服务
  // 再调本脚本。
  const tmpPath = path.join(
    path.dirname(target),
    `.${path.basename(target)}.tmp-${process.pid}`,
  );
  fs.writeFileSync(tmpPath, picked.bytes);
  fs.renameSync(tmpPath, target);
  // 不 chmod：Windows 没有 POSIX 执行位，可执行性由 .exe 扩展名决定，
  // chmod 在这里只会动只读位，是无意义操作。
  console.log(`[fetch-hg-windows] 已从 ${picked.kind} 获取并校验通过（${picked.source}）`);
  console.log(`[fetch-hg-windows] 落盘 ${target} sha256=${picked.sha}`);
  process.exit(0);
}

console.error('[fetch-hg-windows] 没有任何候选源提供通过校验的二进制，构建中止。');
console.error(`[fetch-hg-windows] manifest: ${manifestPath}`);
console.error(`[fetch-hg-windows] 期望 sha256=${expectedSha} size=${manifest.size}`);
console.error(`[fetch-hg-windows] 目标路径: ${target}`);
console.error('[fetch-hg-windows] 请任选一种方式提供它：');
console.error('[fetch-hg-windows]   1) HG_WINDOWS_SRC=<本机二进制绝对路径>');
console.error(`[fetch-hg-windows]   2) 在同级 workspace 构建出 ${siblingPath}`);
console.error('[fetch-hg-windows]   3) HG_WINDOWS_URL=<HTTPS 下载地址>（私有资产再配 HG_WINDOWS_TOKEN 走 Bearer 认证）');
console.error('[fetch-hg-windows] 此处硬失败是刻意的：缺这个二进制打出的 Windows 包，VPN 服务的 binPath 会指向不存在的文件。');
process.exit(1);
