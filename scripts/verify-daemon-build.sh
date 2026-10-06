#!/bin/bash
#
# verify-daemon-build.sh —— hv-control-daemon 构建-打包链路防错闸（xfu0nh5q-1 新增独立件）
#
# ## 为什么有这个闸（DEFECT-3 根因收口）
#   v1.1.54 及此前随包分发的 hv-control-daemon-x86_64-pc-windows-msvc.exe 为错误构建
#   （X11 演示形态：启动路径无条件连 X11，Windows 无 DISPLAY 即 exit=1，控制面起不来）。
#   混入根因：src-tauri/binaries/hv-control-daemon-<triple> 由各块在异构宿主上 ad-hoc
#   构建、手工拷入，tauri bundle.externalBin 只按文件名取件，全程无任何「这份二进制
#   确实是该目标三元组的正确构建」校验；仓内既有门禁 assert-daemon-content.sh 只对
#   manifest 哈希对账，而 manifest 本身与树内件漂移过（v1.1.54 tag 内漂移实证：
#   树内件 a907df12… vs manifest 锚 4c1b1000…）。
#   本闸在任何 tauri 打包（tauri.conf.json beforeBundleCommand 挂载）与 CI
#   （release.yml 独立步）fail-closed 拦截以下三类错混：
#     A) 文件与 manifest 锚定哈希/大小不符（错版本/旧构建顶替）；
#     B) 二进制真实格式与文件名目标三元组不符（错目标构建改名混入，含 cp msvc→gnu 类）；
#     C) manifest 声明的构建特征标记缺失（同目标旧形态构建顶替，如 X11 启动即退旧件）。
#
# ## 校验腿
#   腿1 manifest 本体存在可解析（期望哈希唯一来源）
#   腿2 manifest.artifacts[] 逐件：存在 + bytes + sha256 + gate_markers（require/forbid）
#   腿3 binaries/ 内全部 hv-control-daemon-* 逐件：真实二进制格式 vs 文件名三元组
#       （PE machine=0x8664 + MSVC/MinGW 节区判别；ELF e_machine；Mach-O cputype）
#   腿4 externalBin 接线：tauri.conf.json / tauri.windows.conf.json / tauri.macos.conf.json
#
# ## 用法
#   scripts/verify-daemon-build.sh          # 全四腿
#   退出码：0 = 全绿；1 = 任一 FAIL（fail-closed，绝不静默降级）
#
# ## 依赖：bash + node（构建宿主必有；不依赖 objdump/strings/file，Windows 宿主可跑）
#
# @date 2026-10-06  xfu0nh5q-1

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BINARIES="$PROJECT_ROOT/src-tauri/binaries"
MANIFEST="$PROJECT_ROOT/src-tauri/resources/hv-control-daemon.manifest.json"
export GATE_PROJECT_ROOT="$PROJECT_ROOT"
export GATE_MANIFEST="$MANIFEST"
export GATE_BINARIES="$BINARIES"

FAILED=0
fail() { echo "  [GATE] ✗ FAIL: $1"; FAILED=1; }
pass() { echo "  [GATE] ✓ $1"; }

echo ""
echo "════════ hv-control-daemon 构建正确性防错闸（verify-daemon-build） ════════"

# ---------- 腿1: manifest 本体 ----------
echo ""
echo "腿1 ▶ manifest 本体"
if [[ ! -s "$MANIFEST" ]]; then
  fail "manifest 不存在或为空: $MANIFEST"
else
  if node -e "JSON.parse(require('fs').readFileSync(process.env.GATE_MANIFEST,'utf8'))" 2>/dev/null; then
    pass "manifest 存在且可解析"
  else
    fail "manifest 不可解析（非合法 JSON）"
  fi
fi

# ---------- 腿2: manifest.artifacts[] 逐件（哈希/大小/构建特征标记） ----------
echo ""
echo "腿2 ▶ manifest 锚定件（存在性 + bytes + sha256 + gate_markers）"
node <<'NODE_EOF'
const fs = require('fs');
const crypto = require('crypto');
const root = process.env.GATE_PROJECT_ROOT;
let manifest;
try { manifest = JSON.parse(fs.readFileSync(process.env.GATE_MANIFEST, 'utf8')); }
catch (e) { console.log('  [GATE] ✗ FAIL: manifest 解析失败，腿2 无法执行'); process.exit(1); }
const artifacts = manifest.artifacts || [];
if (!artifacts.length) { console.log('  [GATE] ✗ FAIL: manifest.artifacts 为空'); process.exit(1); }

// 可打印 ASCII 串提取（≥8 字符），供构建特征标记检查
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

let bad = 0;
for (const a of artifacts) {
  const p = `${root}/${a.path}`;
  const label = `[${a.target}] ${a.path}`;
  if (!fs.existsSync(p) || fs.statSync(p).size === 0) {
    console.log(`  [GATE] ✗ FAIL: ${label} 缺失或为空`); bad++; continue;
  }
  const buf = fs.readFileSync(p);
  let itemBad = 0;
  if (a.bytes !== undefined && buf.length !== a.bytes) {
    console.log(`  [GATE] ✗ FAIL: ${label} 大小不符 (期望 ${a.bytes} 实际 ${buf.length})`); itemBad++;
  }
  const got = crypto.createHash('sha256').update(buf).digest('hex');
  if (a.sha256 && got !== a.sha256) {
    console.log(`  [GATE] ✗ FAIL: ${label} sha256 不符`);
    console.log(`          期望: ${a.sha256}`);
    console.log(`          实际: ${got}`); itemBad++;
  }
  const gm = a.gate_markers || {};
  const hay = ((gm.require || []).length || (gm.forbid || []).length) ? asciiStrings(buf) : '';
  for (const m of (gm.require || [])) {
    if (!hay.includes(m)) {
      console.log(`  [GATE] ✗ FAIL: ${label} 缺少构建特征标记 "${m}"（疑为同目标旧形态/异源构建顶替）`); itemBad++;
    }
  }
  for (const m of (gm.forbid || [])) {
    if (hay.includes(m)) {
      console.log(`  [GATE] ✗ FAIL: ${label} 出现禁入特征标记 "${m}"`); itemBad++;
    }
  }
  if (itemBad === 0) {
    console.log(`  [GATE] ✓ ${label} sha256/bytes/markers 全一致 (${(a.sha256 || '').slice(0, 12)}…, ${buf.length}B)`);
  }
  bad += itemBad;
}
process.exit(bad ? 1 : 0);
NODE_EOF
[[ $? -ne 0 ]] && fail "manifest 锚定件核对存在 FAIL（见上明细）" || pass "manifest.artifacts 全部锚定件哈希/大小/特征标记一致"

# ---------- 腿3: 真实二进制格式 vs 文件名目标三元组 ----------
echo ""
echo "腿3 ▶ 二进制格式 vs 目标三元组（错目标构建改名混入拦截；覆盖 binaries/ 全部 daemon 件）"
if [[ ! -d "$BINARIES" ]]; then
  fail "binaries 目录不存在: $BINARIES"
else
  shopt -s nullglob
  FILES=("$BINARIES"/hv-control-daemon-*)
  shopt -u nullglob
  if [[ ${#FILES[@]} -eq 0 ]]; then
    fail "binaries/ 内无 hv-control-daemon-* 件"
  else
    LEG3_BAD=0
    for f in "${FILES[@]}"; do
      export GATE_FILE="$f"
      OUT=$(node <<'NODE_EOF'
const fs = require('fs');
const p = process.env.GATE_FILE;
const base = p.split('/').pop();
const m = base.match(/^hv-control-daemon-(.+?)(\.exe)?$/);
if (!m) { console.log(`SKIP ${base}（命名不匹配，跳过）`); process.exit(0); }
const triple = m[1], isExe = !!m[2];
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
const exp = EXPECT[triple];
if (!exp) { console.log(`FAIL ${base} 未登记的目标三元组 "${triple}"`); process.exit(1); }
if (exp.kind === 'pe' && !isExe) { console.log(`FAIL ${base} windows 目标缺 .exe 后缀`); process.exit(1); }
if (exp.kind !== 'pe' && isExe) { console.log(`FAIL ${base} 非 windows 目标带 .exe 后缀`); process.exit(1); }
const buf = fs.readFileSync(p);
const u16 = b => buf.readUInt16LE(b), u32 = b => buf.readUInt32LE(b);
let detail = '';
if (exp.kind === 'pe') {
  if (buf.length < 0x40 || buf.toString('latin1', 0, 2) !== 'MZ') { console.log(`FAIL ${base} 无 MZ 头（非 PE）`); process.exit(1); }
  const pe = u32(0x3c);
  if (pe + 24 > buf.length || buf.toString('latin1', pe, pe + 4) !== 'PE\0\0') { console.log(`FAIL ${base} 无 PE 签名`); process.exit(1); }
  const machine = u16(pe + 4);
  if (machine !== exp.machine) { console.log(`FAIL ${base} PE machine=0x${machine.toString(16)} != 期望 0x${exp.machine.toString(16)}`); process.exit(1); }
  const nsec = u16(pe + 6), sizeOpt = u16(pe + 20);
  const tbl = pe + 24 + sizeOpt;
  const secs = [];
  for (let i = 0; i < nsec; i++) {
    const o = tbl + i * 40;
    if (o + 40 > buf.length) break;
    secs.push(buf.toString('latin1', o, o + 8).replace(/\0+$/, ''));
  }
  const mingwMarks = secs.filter(s => s === '.bss' || s === '.idata' || s === '.tls');
  if (exp.mingw && mingwMarks.length === 0) {
    console.log(`FAIL ${base} 声称 ${triple} 但节区无 MinGW 标记（.bss/.idata/.tls 均缺）——疑为 MSVC 构建改名混入; 节区=[${secs.join(',')}]`); process.exit(1);
  }
  if (!exp.mingw && mingwMarks.length > 0) {
    console.log(`FAIL ${base} 声称 ${triple} 但含 MinGW 节区 [${mingwMarks.join(',')}]——疑为 GNU 构建改名混入; 节区=[${secs.join(',')}]`); process.exit(1);
  }
  detail = `PE64 machine=0x${machine.toString(16)} 节区=[${secs.join(',')}]`;
} else if (exp.kind === 'elf') {
  if (buf.length < 0x14 || buf.toString('latin1', 0, 4) !== '\x7fELF') { console.log(`FAIL ${base} 无 ELF 头`); process.exit(1); }
  const machine = u16(0x12);
  if (machine !== exp.machine) { console.log(`FAIL ${base} ELF e_machine=0x${machine.toString(16)} != 期望 0x${exp.machine.toString(16)}`); process.exit(1); }
  detail = `ELF e_machine=0x${machine.toString(16)}`;
} else {
  const magic = u32(0); // u32LE 读出的 MH_MAGIC_64=0xfeedfacf / MH_MAGIC=0xfeedface → 小端文件
  if (magic !== 0xfeedfacf && magic !== 0xcffaedfe && magic !== 0xfeedface && magic !== 0xcefaedfe) {
    console.log(`FAIL ${base} 无 Mach-O 魔数 (0x${magic.toString(16)})`); process.exit(1);
  }
  const le = (magic === 0xfeedfacf || magic === 0xfeedface);
  const cpu = le ? buf.readUInt32LE(4) : buf.readUInt32BE(4);
  if (cpu !== exp.cpu) { console.log(`FAIL ${base} Mach-O cputype=0x${cpu.toString(16)} != 期望 0x${exp.cpu.toString(16)}`); process.exit(1); }
  detail = `Mach-O cputype=0x${cpu.toString(16)}`;
}
console.log(`PASS ${base} ${detail}`);
NODE_EOF
      ) || LEG3_BAD=1
      echo "  [GATE] $OUT"
    done
    if [[ "$LEG3_BAD" -ne 0 ]]; then fail "格式 vs 三元组核对存在 FAIL"; else pass "全部 ${#FILES[@]} 件格式与文件名三元组匹配"; fi
  fi
fi

# ---------- 腿4: externalBin 接线 ----------
echo ""
echo "腿4 ▶ externalBin 接线（件在仓里还必须真随包）"
for cf in tauri.conf.json tauri.windows.conf.json tauri.macos.conf.json; do
  p="$PROJECT_ROOT/src-tauri/$cf"
  if [[ ! -s "$p" ]]; then fail "conf 缺失: src-tauri/$cf"; continue; fi
  hit=$(GATE_CONF="$p" node -e "
const j = JSON.parse(require('fs').readFileSync(process.env.GATE_CONF, 'utf8'));
const eb = (j.bundle && j.bundle.externalBin) || [];
console.log(eb.some(x => String(x).includes('hv-control-daemon')) ? 'YES' : 'NO');" 2>/dev/null)
  if [[ "$hit" == "YES" ]]; then
    pass "$cf: externalBin 含 hv-control-daemon"
  else
    fail "$cf: externalBin 未填 hv-control-daemon（安装包将不带 daemon）"
  fi
done

echo ""
if [[ "$FAILED" -eq 0 ]]; then
  echo "GRAND: hv-control-daemon 构建正确性防错闸全绿（rc=0）"
  exit 0
else
  echo "GRAND: FAIL —— 构建正确性闸拦截，禁止打包/发货（rc=1）"
  exit 1
fi
