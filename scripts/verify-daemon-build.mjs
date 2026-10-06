#!/usr/bin/env node
/**
 * verify-daemon-build.mjs —— hv-control-daemon 构建-打包链路防错闸（唯一实现）
 *
 * scripts/verify-daemon-build.sh 为本文件的 exec 包装（保持既有调用契约）；
 * tauri.conf.json beforeBundleCommand 直接调本文件（cmd /C 可拉起 node，无 bash 的
 * Windows 构建宿主亦可执行）。CI 步（release.yml）经 .sh 包装调用，同一实现。
 *
 * 拦截三类错混（fail-closed，任一 FAIL 即退出码 1）：
 *   A) 文件与 manifest 锚定哈希/大小不符（错版本/旧构建顶替）；
 *   B) 二进制真实格式与文件名目标三元组不符（错目标构建改名混入，含 cp msvc→gnu 类）；
 *   C) manifest 声明的构建特征标记缺失（同目标旧形态构建顶替，如 X11 启动即退旧件）。
 *
 * 依赖：仅 node 内置模块（fs/crypto/path）；repo 根从本文件位置推导，与 CWD 无关。
 *
 * @date 2026-10-06  xfu0nh5q-1（第2轮整改：由 bash 单实现改为 node 唯一实现）
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BINARIES = path.join(ROOT, 'src-tauri', 'binaries');
const MANIFEST = path.join(ROOT, 'src-tauri', 'resources', 'hv-control-daemon.manifest.json');

let failed = 0;
const fail = (m) => { console.log(`  [GATE] ✗ FAIL: ${m}`); failed++; };
const pass = (m) => { console.log(`  [GATE] ✓ ${m}`); };

console.log('');
console.log('════════ hv-control-daemon 构建正确性防错闸（verify-daemon-build） ════════');

// ---------- 腿1: manifest 本体 ----------
console.log('');
console.log('腿1 ▶ manifest 本体');
let manifest = null;
if (!fs.existsSync(MANIFEST) || fs.statSync(MANIFEST).size === 0) {
  fail(`manifest 不存在或为空: ${MANIFEST}`);
} else {
  try { manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); pass('manifest 存在且可解析'); }
  catch (e) { fail(`manifest 不可解析（非合法 JSON）: ${e.message}`); }
}

// ASCII 可打印串提取（≥8 字符），供构建特征标记检查
function asciiStrings(buf, min = 8) {
  const out = []; let cur = [];
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (c >= 0x20 && c <= 0x7e) cur.push(c);
    else { if (cur.length >= min) out.push(Buffer.from(cur).toString('latin1')); cur = []; }
  }
  if (cur.length >= min) out.push(Buffer.from(cur).toString('latin1'));
  return out.join('\n');
}

// ---------- 腿2: manifest.artifacts[] 逐件 ----------
console.log('');
console.log('腿2 ▶ manifest 锚定件（存在性 + bytes + sha256 + gate_markers）');
if (manifest) {
  const artifacts = manifest.artifacts || [];
  if (!artifacts.length) fail('manifest.artifacts 为空');
  for (const a of artifacts) {
    const p = path.join(ROOT, a.path);
    const label = `[${a.target}] ${a.path}`;
    if (!fs.existsSync(p) || fs.statSync(p).size === 0) { fail(`${label} 缺失或为空`); continue; }
    const buf = fs.readFileSync(p);
    let itemBad = 0;
    if (a.bytes !== undefined && buf.length !== a.bytes) {
      fail(`${label} 大小不符 (期望 ${a.bytes} 实际 ${buf.length})`); itemBad++;
    }
    const got = crypto.createHash('sha256').update(buf).digest('hex');
    if (a.sha256 && got !== a.sha256) {
      fail(`${label} sha256 不符\n          期望: ${a.sha256}\n          实际: ${got}`); itemBad++;
    }
    const gm = a.gate_markers || {};
    const hay = ((gm.require || []).length || (gm.forbid || []).length) ? asciiStrings(buf) : '';
    for (const m of (gm.require || [])) if (!hay.includes(m)) { fail(`${label} 缺少构建特征标记 "${m}"（疑为同目标旧形态/异源构建顶替）`); itemBad++; }
    for (const m of (gm.forbid || [])) if (hay.includes(m)) { fail(`${label} 出现禁入特征标记 "${m}"`); itemBad++; }
    if (itemBad === 0) pass(`${label} sha256/bytes/markers 全一致 (${(a.sha256 || '').slice(0, 12)}…, ${buf.length}B)`);
  }
} else {
  fail('manifest 不可用，腿2 无法执行');
}

// ---------- 腿3: 真实二进制格式 vs 文件名目标三元组 ----------
console.log('');
console.log('腿3 ▶ 二进制格式 vs 目标三元组（错目标构建改名混入拦截；覆盖 binaries/ 全部 daemon 件）');
const EXPECT = {
  'x86_64-pc-windows-msvc':   { kind: 'pe', machine: 0x8664, mingw: false },
  'x86_64-pc-windows-gnu':    { kind: 'pe', machine: 0x8664, mingw: true  },
  'x86_64-unknown-linux-gnu': { kind: 'elf', machine: 0x3e },
  'x86_64-linux-android':     { kind: 'elf', machine: 0x3e },
  'i686-linux-android':       { kind: 'elf', machine: 0x03 },
  'aarch64-linux-android':    { kind: 'elf', machine: 0xb7 },
  'armv7-linux-androideabi':  { kind: 'elf', machine: 0x28 },
  'aarch64-apple-darwin':     { kind: 'macho', cpu: 0x0100000c },
  'x86_64-apple-darwin':      { kind: 'macho', cpu: 0x01000007 }, // CPU_TYPE_X86_64 = 7|ABI64
};
if (!fs.existsSync(BINARIES)) {
  fail(`binaries 目录不存在: ${BINARIES}`);
} else {
  const files = fs.readdirSync(BINARIES).filter(f => f.startsWith('hv-control-daemon-')).sort();
  if (!files.length) {
    fail('binaries/ 内无 hv-control-daemon-* 件');
  } else {
    for (const base of files) {
      const m = base.match(/^hv-control-daemon-(.+?)(\.exe)?$/);
      if (!m) { console.log(`  [GATE] SKIP ${base}（命名不匹配，跳过）`); continue; }
      const triple = m[1], isExe = !!m[2];
      const exp = EXPECT[triple];
      const p = path.join(BINARIES, base);
      if (!exp) { fail(`${base} 未登记的目标三元组 "${triple}"`); continue; }
      if (exp.kind === 'pe' && !isExe) { fail(`${base} windows 目标缺 .exe 后缀`); continue; }
      if (exp.kind !== 'pe' && isExe) { fail(`${base} 非 windows 目标带 .exe 后缀`); continue; }
      const buf = fs.readFileSync(p);
      const u16 = b => buf.readUInt16LE(b), u32 = b => buf.readUInt32LE(b);
      if (exp.kind === 'pe') {
        if (buf.length < 0x40 || buf.toString('latin1', 0, 2) !== 'MZ') { fail(`${base} 无 MZ 头（非 PE）`); continue; }
        const pe = u32(0x3c);
        if (pe + 24 > buf.length || buf.toString('latin1', pe, pe + 4) !== 'PE\0\0') { fail(`${base} 无 PE 签名`); continue; }
        const machine = u16(pe + 4);
        if (machine !== exp.machine) { fail(`${base} PE machine=0x${machine.toString(16)} != 期望 0x${exp.machine.toString(16)}`); continue; }
        const nsec = u16(pe + 6), sizeOpt = u16(pe + 20);
        const tbl = pe + 24 + sizeOpt;
        const secs = [];
        for (let i = 0; i < nsec; i++) {
          const o = tbl + i * 40;
          if (o + 40 > buf.length) break;
          secs.push(buf.toString('latin1', o, o + 8).replace(/\0+$/, ''));
        }
        const mingwMarks = secs.filter(s => s === '.bss' || s === '.idata' || s === '.tls');
        if (exp.mingw && mingwMarks.length === 0) { fail(`${base} 声称 ${triple} 但节区无 MinGW 标记（.bss/.idata/.tls 均缺）——疑为 MSVC 构建改名混入; 节区=[${secs.join(',')}]`); continue; }
        if (!exp.mingw && mingwMarks.length > 0) { fail(`${base} 声称 ${triple} 但含 MinGW 节区 [${mingwMarks.join(',')}]——疑为 GNU 构建改名混入; 节区=[${secs.join(',')}]`); continue; }
        pass(`${base} PE64 machine=0x${machine.toString(16)} 节区=[${secs.join(',')}]`);
      } else if (exp.kind === 'elf') {
        if (buf.length < 0x14 || buf.toString('latin1', 0, 4) !== '\x7fELF') { fail(`${base} 无 ELF 头`); continue; }
        const machine = u16(0x12);
        if (machine !== exp.machine) { fail(`${base} ELF e_machine=0x${machine.toString(16)} != 期望 0x${exp.machine.toString(16)}`); continue; }
        pass(`${base} ELF e_machine=0x${machine.toString(16)}`);
      } else {
        const magic = u32(0); // u32LE 读出 MH_MAGIC_64=0xfeedfacf / MH_MAGIC=0xfeedface → 小端文件
        if (magic !== 0xfeedfacf && magic !== 0xcffaedfe && magic !== 0xfeedface && magic !== 0xcefaedfe) {
          fail(`${base} 无 Mach-O 魔数 (0x${magic.toString(16)})`); continue;
        }
        const le = (magic === 0xfeedfacf || magic === 0xfeedface);
        const cpu = le ? buf.readUInt32LE(4) : buf.readUInt32BE(4);
        if (cpu !== exp.cpu) { fail(`${base} Mach-O cputype=0x${cpu.toString(16)} != 期望 0x${exp.cpu.toString(16)}`); continue; }
        pass(`${base} Mach-O cputype=0x${cpu.toString(16)}`);
      }
    }
  }
}

// ---------- 腿4: externalBin 接线 ----------
console.log('');
console.log('腿4 ▶ externalBin 接线（件在仓里还必须真随包）');
for (const cf of ['tauri.conf.json', 'tauri.windows.conf.json', 'tauri.macos.conf.json']) {
  const p = path.join(ROOT, 'src-tauri', cf);
  if (!fs.existsSync(p) || fs.statSync(p).size === 0) { fail(`conf 缺失: src-tauri/${cf}`); continue; }
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const eb = (j.bundle && j.bundle.externalBin) || [];
    if (eb.some(x => String(x).includes('hv-control-daemon'))) pass(`${cf}: externalBin 含 hv-control-daemon`);
    else fail(`${cf}: externalBin 未填 hv-control-daemon（安装包将不带 daemon）`);
  } catch (e) { fail(`src-tauri/${cf} 不可解析: ${e.message}`); }
}

console.log('');
if (failed === 0) {
  console.log('GRAND: hv-control-daemon 构建正确性防错闸全绿（rc=0）');
  process.exit(0);
} else {
  console.log(`GRAND: FAIL —— 构建正确性闸拦截，禁止打包/发货（rc=1，FAIL×${failed}）`);
  process.exit(1);
}
