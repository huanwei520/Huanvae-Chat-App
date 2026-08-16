/**
 * 契约测试：Windows VPN 服务的「安装器必须提权 + 注册失败必须可见」这条线，不许再静默退化。
 *
 * ## 它守的是什么
 *
 * v1.1.35 之前，Windows 新装用户打开 VPN 页恒显示「服务未运行」。链条是：
 *   1. `bundle.windows.nsis` 没写 `installMode` ⇒ Tauri NSIS 模板取默认 `currentUser`
 *      ⇒ `RequestExecutionLevel user` ⇒ 安装器**不提权**；
 *   2. `hooks.nsi` 的 `sc.exe create` 要 SCM 写权限（仅 Administrators）⇒ 必然失败（5 拒绝访问）；
 *   3. 那 7 条 `nsExec::ExecToLog` **一条都没 `Pop` 取返回码**，末尾还无条件
 *      `DetailPrint "HuanvaeGuard 服务已安装"` ⇒ **失败与成功在安装日志里逐字同形**。
 *
 * 三环缺一都不会出这个故障，所以三环都要有机器守着。它们各自**静默**失效：
 * 改回 `currentUser`、少写一个 `Pop`、把成功文案挪回无条件位置 —— 没有任何一处会报错，
 * 而 vitest 的常规用例结构上也测不到（jsdom 不跑 NSIS、macOS 不跑 SCM）。
 * 源码级静态扫描是唯一能守住这条线的机制（与 animation-conflict / huanvaeguard-port-resolution 同套路；
 * vitest 静态扫描读源码用 `__dirname`，见 .claude/rules/frontend-test.md）。
 *
 * ## 🔴 `installMode` 这个键名在 tauri.conf.json 里出现【两次】，语义完全不同
 *
 *   - `bundle.windows.nsis.installMode`      —— 安装器提权级别（perMachine / currentUser）
 *   - `plugins.updater.windows.installMode`  —— 更新器安装 UI 模式（passive / quiet / basicUi）
 *
 * ⇒ 纯文本 `grep '"installMode".*"passive"'` 在这里是**假阳判据**：它会被另一处的命中满足。
 * 本文件因此一律走 `JSON.parse` 结构化取键，脚本侧（test-all.ps1 / test-all.sh / pre-release.ps1）
 * 也已同批改成结构化取值。
 *
 * ## 本文件抓不到什么（静态扫描的边界，别以为它是全覆盖）
 *
 *   - 只剥**整行**注释（trim 后以 `;` 开头）。写成行尾注释的 `nsExec::` 不会被剥掉，
 *     可能被算成一条真实调用 —— 本文件的注释风格是整行式，但这条限制要写出来。
 *   - 它证明不了"安装器在真机上真的提权了 / sc create 真的成功了"。那属于真机验证，
 *     只有 Windows 主机能做（同族前例见 .claude/rules/rust-dev.md「SCM 能拉起」那节）。
 *   - `${If}` 深度是按 LogicLib 的 `${If}` / `${EndIf}` 配对数出来的。`${AndIf}` / `${ElseIf}` /
 *     `${Else}` 都**不改变深度**，所以 hooks.nsi 用到它们不影响这里；但 `${Unless}` / `${Select}`
 *     等其它 LogicLib 结构不被理解，将来引入需同步扩展这里。
 *   - 它是**形状 + 次序**断言，不是可达性证明。PREINSTALL 那段的可达性由
 *     `makensis -PPO` 展开出的真实跳转标签承担（见本单交付里的 nsis-preprocessed.nsi），
 *     而 makensis 不在 `pnpm test:run` 门禁里 —— 这一块是本文件覆盖不到的，别当它覆盖了。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(rel: string): string {
  return readFileSync(resolve(__dirname, '..', rel), 'utf-8');
}

/** 剥掉 NSIS 整行注释（trim 后以 `;` 开头）。不能按 `;.*$` 剥 —— SDDL 里全是分号。 */
function stripNsisComments(src: string): string {
  return src
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith(';'))
    .join('\n');
}

/**
 * 取出某个 `!macro <name> ... !macroend` 的**内容**（不含两端那两行）。
 *
 * 用 throw 而不是 expect：本函数在模块顶层被调用，那里不在任何 `it` 的上下文里。
 */
function macroBody(src: string, name: string): string {
  const lines = src.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim().startsWith(`!macro ${name}`));
  if (start < 0) { throw new Error(`hooks.nsi 里找不到 !macro ${name}`); }
  const end = lines.findIndex((l, i) => i > start && l.trim() === '!macroend');
  if (end <= start) { throw new Error(`!macro ${name} 没有配对的 !macroend`); }
  return lines.slice(start + 1, end).join('\n');
}

/** 逐行标注该行所处的 LogicLib `${If}` 嵌套深度（顶层 = 0）。 */
function withIfDepth(body: string): { line: string; depth: number }[] {
  let depth = 0;
  return body.split(/\r?\n/).map((line) => {
    if (/\$\{EndIf\}/.test(line)) { depth -= 1; }
    const here = depth;
    if (/\$\{If\}/.test(line)) { depth += 1; }
    return { line, depth: here };
  });
}

const NSI_RAW = read('src-tauri/windows/hooks.nsi');
const NSI = stripNsisComments(NSI_RAW);
const RUST = read('src-tauri/src/desktop/huanvaeguard.rs');
const CONF = JSON.parse(read('src-tauri/tauri.conf.json')) as {
  bundle: { windows: { nsis: { installMode?: string } } };
  plugins: { updater: { windows: { installMode?: string } } };
};

const POSTINSTALL = macroBody(NSI, 'NSIS_HOOK_POSTINSTALL');
const PREINSTALL = macroBody(NSI, 'NSIS_HOOK_PREINSTALL');
/** 两个调用点（HKCU / HKLM）共用的那段"跑旧卸载器并判定结果"的正文 */
const UNINSTALL_PREV = macroBody(NSI, 'HUANVAE_UNINSTALL_PREVIOUS');

/** 在 body 里找第一条匹配 re 的行号（找不到返回 -1）。用来断言**次序**，不只是"存在"。 */
function lineIndexOf(body: string, re: RegExp): number {
  return body.split(/\r?\n/).findIndex((l) => re.test(l));
}

describe('tauri.conf.json — 两个 installMode 各自的取值（结构化取键，不用文本 grep）', () => {
  it('bundle.windows.nsis.installMode 必须是 perMachine —— 否则安装器不提权，sc create 必然失败', () => {
    expect(CONF.bundle.windows.nsis.installMode).toBe('perMachine');
  });

  it('plugins.updater.windows.installMode 必须【显式】是 passive', () => {
    // 上游 WindowsUpdateInstallMode 把 Passive 标成 #[default]，"删掉这个键"= 仍然是 passive、
    // 只是变成看不见的默认值。所以这里判的是"写出来了且等于 passive"，不是"存在与否"。
    expect(CONF.plugins.updater.windows.installMode).toBe('passive');
  });
});

describe('hooks.nsi POSTINSTALL — 每条 sc.exe 的返回码都必须被取走', () => {
  it('每一条 nsExec::ExecToLog 后面紧跟一行 Pop', () => {
    const lines = POSTINSTALL.split(/\r?\n/);
    const execIdx = lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => l.includes('nsExec::ExecToLog'))
      .map(({ i }) => i);

    // 先断言扫描结果非空：格式一变导致空集合时，下面的循环会空转、测试假通过
    expect(execIdx.length).toBeGreaterThanOrEqual(5);

    for (const i of execIdx) {
      const next = (lines[i + 1] ?? '').trim();
      expect(next, `第 ${i + 1} 行的 nsExec 之后没有紧跟 Pop：${lines[i].trim()}`).toMatch(/^Pop \$\d$/);
    }
  });

  it('create / sdset / start 三条的返回码必须真的被判（Pop 之后有 ${If} $0）', () => {
    const lines = POSTINSTALL.split(/\r?\n/);
    // stop / delete 是明确豁免的两条：服务本来就不存在时它们必然 1060，判它反而把
    // 干净的首次安装报成失败。豁免理由写在 hooks.nsi 里，这里只钉住"其余三条必须判"。
    const mustCheck = ['sc.exe create', 'sc.exe sdset', 'sc.exe start'];
    for (const cmd of mustCheck) {
      const i = lines.findIndex((l) => l.includes(cmd));
      expect(i, `POSTINSTALL 里找不到 ${cmd}`).toBeGreaterThanOrEqual(0);
      expect(lines[i + 1]?.trim(), `${cmd} 之后没有 Pop`).toMatch(/^Pop \$\d$/);
      // rc 必须在紧随其后的两行内进入判断（中间最多允许一行空行/注释残留）
      const window = [lines[i + 2] ?? '', lines[i + 3] ?? ''].join('\n');
      expect(window, `${cmd} 的返回码被 Pop 走了却没人判`).toMatch(/\$\{If\}\s+\$\d/);
    }
  });

  it('不再有无条件的成功文案「HuanvaeGuard 服务已安装」', () => {
    // 这一句正是"失败也显示成功"的源头：它在旧版本里处于 ${If} 之外，
    // 无论 sc create 成没成都会打印。
    //
    // 🔴 口径是「**代码里**不得再出现」，不是「整份文件里不得出现该字符串」——
    // 后者会把 hooks.nsi 文件头那段**讲这段历史**的注释一并判违规，逼着后来的人
    // 删掉正确的文档才能过门禁（本仓 frontend-test.md 已把这一类记成坏口径，
    // 而本条第一版就原样犯了一次，是这条测试自己红出来的）。所以判在剥掉注释的 NSI 上。
    expect(NSI).not.toContain('HuanvaeGuard 服务已安装');
    // 正对照：同一条查法在**含注释**的原文上必须命中（证明这个 0 是"代码里真没有"，
    // 不是查法在这份文件上根本不会响）
    expect(NSI_RAW).toContain('HuanvaeGuard 服务已安装');
  });

  it('成功文案与所有 MessageBox 都必须位于 ${If} 分支内（顶层出现 = 无条件 = 会撒谎）', () => {
    const annotated = withIfDepth(POSTINSTALL);
    const conditional = annotated.filter(
      ({ line }) => line.includes('MessageBox') || line.includes('服务已注册'),
    );
    expect(conditional.length, 'POSTINSTALL 里既没有成功文案也没有 MessageBox，扫描口径已失效')
      .toBeGreaterThanOrEqual(3);
    for (const { line, depth } of conditional) {
      expect(depth, `这一行处在 \${If} 之外（无条件执行）：${line.trim()}`).toBeGreaterThanOrEqual(1);
    }
  });

  it('两条致命失败路径（create 失败 / start 失败）都有用户可见的 MessageBox', () => {
    // DetailPrint 只进安装器的详情面板；更新器用 /P（passive）跑安装器时详情面板不展开、
    // 装完还自动关窗 ⇒ DetailPrint 对用户等于不存在。失败要让人看见，只能靠 MessageBox。
    const boxes = POSTINSTALL.split(/\r?\n/).filter((l) => l.includes('MessageBox'));
    expect(boxes.length).toBeGreaterThanOrEqual(2);
    // /SD IDOK：真·静默安装（/S）下 MessageBox 会死等，必须给默认答案，否则安装器挂住
    for (const b of boxes) {
      expect(b, `MessageBox 缺 /SD 默认答案，静默安装会挂住：${b.trim()}`).toContain('/SD ');
    }
  });
});

describe('hooks.nsi PREINSTALL — 跑旧卸载器同样必须取退出码（与 POSTINSTALL 是同一个病）', () => {
  // 这一段原来是 `ExecWait '"$0" /S _?=$1'`（不取 rc）+ 无条件 DetailPrint「旧版本已卸载」。
  // 与 POSTINSTALL 那条前科逐字同型：失败与成功在安装日志里长得一模一样。

  it('ExecWait 必须把退出码取进变量 —— 不取 = 失败与成功同形', () => {
    const execs = UNINSTALL_PREV.split(/\r?\n/).filter((l) => l.trim().startsWith('ExecWait'));
    // 先断言扫描结果非空：形状一变导致空集合时，下面的循环会空转、测试假通过
    expect(execs, 'HUANVAE_UNINSTALL_PREVIOUS 里一条 ExecWait 都没有，扫描口径已失效')
      .toHaveLength(1);
    expect(execs[0].trim()).toMatch(/^ExecWait\s+'.+'\s+\$\d$/);
  });

  it('必须【先】判 error flag 【再】判 rc —— 官方 ExecWait 语义：出错时那个变量是未定义的', () => {
    const iExec = lineIndexOf(UNINSTALL_PREV, /^\s*ExecWait\b/);
    const iErrors = lineIndexOf(UNINSTALL_PREV, /^\s*\$\{If\}\s+\$\{Errors\}\s*$/);
    const iRc = lineIndexOf(UNINSTALL_PREV, /^\s*\$\{ElseIf\}\s+\$\d\s+!=\s+0\s*$/);
    expect(iExec, '找不到 ExecWait').toBeGreaterThanOrEqual(0);
    expect(iErrors, '找不到 ${If} ${Errors}').toBeGreaterThan(iExec);
    expect(iRc, 'rc 的判断必须排在 error flag 之后').toBeGreaterThan(iErrors);
    // ClearErrors 必须在 ExecWait 之前，否则读到的是上一条命令留下的 error flag
    const iClear = lineIndexOf(UNINSTALL_PREV, /^\s*ClearErrors\s*$/);
    expect(iClear, 'ExecWait 之前必须 ClearErrors').toBeGreaterThanOrEqual(0);
    expect(iClear).toBeLessThan(iExec);
  });

  it('rc=0 之后必须独立复核一次（不信卸载器的自述）', () => {
    // 与 repair() 末尾「sc start 返回 0 ≠ 服务真起来」同一条纪律。复核用的是**同一个读取**：
    // 卸载器会删掉自己那条 Add/Remove Programs 记录，所以成功之后再读必须为空。
    const reads = UNINSTALL_PREV.split(/\r?\n/).filter((l) => /^\s*ReadRegStr\b/.test(l));
    expect(reads, '应当有两次 ReadRegStr：动手前判断有没有旧版本 + 动手后独立复核')
      .toHaveLength(2);
    const iExec = lineIndexOf(UNINSTALL_PREV, /^\s*ExecWait\b/);
    const iRecheck = UNINSTALL_PREV.split(/\r?\n/)
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => /^\s*ReadRegStr\b/.test(l))
      .map(({ i }) => i)[1];
    expect(iRecheck, '第二次 ReadRegStr 必须在 ExecWait 之后，否则不是复核').toBeGreaterThan(iExec);
  });

  it('成功文案「旧版本已卸载」必须位于 ${If} 分支内（顶层出现 = 无条件 = 会撒谎）', () => {
    const annotated = withIfDepth(UNINSTALL_PREV);
    const success = annotated.filter(({ line }) => line.includes('旧版本已卸载'));
    expect(success.length, '找不到成功文案，扫描口径已失效').toBe(1);
    // rc 判断 + 复核判断 ⇒ 它至少嵌在三层里（有旧版本 / 无 error 且 rc=0 / 记录已消失）
    expect(success[0].depth, `成功文案在 \${If} 之外（无条件执行）：${success[0].line.trim()}`)
      .toBeGreaterThanOrEqual(3);
  });

  it('${GetParent} 之前必须先剥掉 UninstallString 的引号（模板写入时是带引号的）', () => {
    // Tauri NSIS 模板写的是 `"$INSTDIR\uninstall.exe"`（带引号），而 ${GetParent}（FileFunc）
    // 是纯字符串操作、不认引号 ⇒ 不先剥，$1 会带一个前导引号，`_?=$1` 与 RMDir 双双失效，
    // 整段变成一个静默的空操作 —— 那正是这段代码在改之前的真实状态。
    const iStrip = lineIndexOf(UNINSTALL_PREV, /^\s*StrCpy\s+\$\d\s+\$\d\s+-1\s+1\s*$/);
    const iParent = lineIndexOf(UNINSTALL_PREV, /^\s*\$\{GetParent\}/);
    expect(iStrip, '找不到剥引号的 StrCpy（`StrCpy $x $x -1 1`）').toBeGreaterThanOrEqual(0);
    expect(iParent, '找不到 ${GetParent}').toBeGreaterThan(iStrip);
    // ExecWait 组命令行时必须自己补回一对引号（$0 此时已不带引号）
    expect(UNINSTALL_PREV).toMatch(/ExecWait\s+'"\$\d"\s/);
  });

  it('两个调用点（HKCU / HKLM）走的是同一段正文，没有各写一遍', () => {
    const inserts = PREINSTALL.split(/\r?\n/)
      .filter((l) => /^\s*!insertmacro\s+HUANVAE_UNINSTALL_PREVIOUS\s+HK(CU|LM)\s/.test(l));
    expect(inserts).toHaveLength(2);
    // PREINSTALL 自己不许再夹带第二份实现（那样两边会各自漂）
    expect(PREINSTALL).not.toMatch(/^\s*ExecWait\b/m);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// POSTINSTALL 失败路径可达性：对**真实脚本文本**跑一个最小 NSIS 子集解释器
// ────────────────────────────────────────────────────────────────────────────
//
// 「每条 sc.exe 后面有 Pop」和「失败分支里有 MessageBox」都只是**形状**断言 —— 它们证明不了
// rc≠0 的时候控制流真的会落进那个分支（少一个 ${Else}、把 ${If} 写反，形状断言照样全绿）。
// 本机没有 makensis、更没有 Windows，真跑一遍安装器做不到；能做到的最强替代是：
// **把真实的 POSTINSTALL 文本喂给一个解释器，注入 rc，看它落到哪一支。**
//
// 🔴 它证明什么、不证明什么，必须分清：
//   证明 —— 给定 hooks.nsi 里**这段文本**，create 返回 5 时确实会走到 MessageBox 那一支，
//           且成功文案不会被打印（= 失败不会被显示成成功）。
//   不证明 —— NSIS 本身的语义与本解释器一致、安装器在真机上真的提权了、sc.exe 真的返回 5。
//           那三件只有 Windows 真机能证（同族前例见 .claude/rules/rust-dev.md「SCM 能拉起」）。
//
// 解释器只认下面这几条指令，**遇到任何不认识的非空行直接抛错** —— 否则脚本一改形状，
// 解释器会静默跳过它不懂的行，测试就退化成恒绿的假证明。

interface NsisRun {
  details: string[];
  boxes: string[];
}

/** 支持的最小子集：nsExec::ExecToLog / Pop / ${If}/${Else}/${EndIf} / DetailPrint / MessageBox / Sleep */
function interpretPostinstall(body: string, rcOf: (cmd: string) => number): NsisRun {
  const details: string[] = [];
  const boxes: string[] = [];
  const regs = new Map<string, string>();
  const pending: string[] = [];
  // 每一层记录 { taken: 本层是否已有分支被执行, active: 当前分支是否执行 }
  const stack: { taken: boolean; active: boolean }[] = [];
  const active = () => stack.every((f) => f.active);

  const subst = (s: string) =>
    s.replace(/\$(\d)/g, (_m, d: string) => regs.get(`$${d}`) ?? '');

  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') { continue; }

    const mIf = /^\$\{If\}\s+(\$\d)\s+(==|!=)\s+(\S+)$/.exec(line);
    if (mIf) {
      const lhs = regs.get(mIf[1]) ?? '';
      const ok = mIf[2] === '==' ? lhs === mIf[3] : lhs !== mIf[3];
      const branch = active() && ok;
      stack.push({ taken: branch, active: branch });
      continue;
    }
    if (line === '${Else}') {
      const top = stack[stack.length - 1];
      if (top === undefined) { throw new Error('${Else} 没有配对的 ${If}'); }
      top.active = !top.taken && stack.slice(0, -1).every((f) => f.active);
      top.taken = top.taken || top.active;
      continue;
    }
    if (line === '${EndIf}') {
      if (stack.pop() === undefined) { throw new Error('${EndIf} 没有配对的 ${If}'); }
      continue;
    }

    const mExec = /^nsExec::ExecToLog\s+'(.*)'$/.exec(line);
    if (mExec) {
      if (active()) { pending.push(String(rcOf(mExec[1]))); }
      continue;
    }
    const mPop = /^Pop\s+(\$\d)$/.exec(line);
    if (mPop) {
      if (active()) {
        const v = pending.pop();
        if (v === undefined) { throw new Error(`Pop 时栈是空的：${line}`); }
        regs.set(mPop[1], v);
      }
      continue;
    }
    const mDetail = /^DetailPrint\s+"(.*)"$/.exec(line);
    if (mDetail) {
      if (active()) { details.push(subst(mDetail[1])); }
      continue;
    }
    const mBox = /^MessageBox\s+\S+\s+"(.*)"\s+\/SD\s+\S+$/.exec(line);
    if (mBox) {
      if (active()) { boxes.push(subst(mBox[1])); }
      continue;
    }
    if (/^Sleep\s+\d+$/.test(line)) { continue; }

    throw new Error(`解释器不认识这一行（脚本形状变了，请同步扩展解释器）：${line}`);
  }
  if (stack.length !== 0) { throw new Error('${If} 没有配对的 ${EndIf}'); }
  if (pending.length !== 0) { throw new Error(`有 ${pending.length} 条 nsExec 的返回码没人 Pop`); }
  return { details, boxes };
}

/** 按 sc.exe 子命令给 rc；未列出的一律 0 */
function rcTable(overrides: Record<string, number>): (cmd: string) => number {
  return (cmd) => {
    for (const [key, rc] of Object.entries(overrides)) {
      if (cmd.includes(`sc.exe ${key}`)) { return rc; }
    }
    return 0;
  };
}

describe('POSTINSTALL 失败路径可达性（对真实脚本文本注入 rc）', () => {
  it('全成功：打印成功文案，一个 MessageBox 都不弹', () => {
    const r = interpretPostinstall(POSTINSTALL, rcTable({}));
    expect(r.details).toContain('HuanvaeGuard 服务已注册并启动');
    expect(r.boxes).toEqual([]);
  });

  it('🔴 create 返回 5（非管理员的原始故障形态）：走进报错分支，且**不**打印任何成功文案', () => {
    const r = interpretPostinstall(POSTINSTALL, rcTable({ create: 5 }));
    // 失败必须被说出来，且带上真实 rc
    expect(r.details).toContain('HuanvaeGuard 服务注册失败（sc create 返回 5）');
    expect(r.boxes).toHaveLength(1);
    expect(r.boxes[0]).toContain('错误码 5');
    // 旧实现正是在这里撒谎：无论成没成都打印一句"已安装"
    expect(r.details.join('\n')).not.toMatch(/已注册并启动|服务已安装/);
  });

  it('create 成功但 start 返回 1053：说"已注册但起不来"，不说"已注册并启动"', () => {
    const r = interpretPostinstall(POSTINSTALL, rcTable({ start: 1053 }));
    expect(r.details).toContain('HuanvaeGuard 服务已注册，但启动失败（sc start 返回 1053）');
    expect(r.boxes).toHaveLength(1);
    expect(r.boxes[0]).toContain('1053');
    expect(r.details).not.toContain('HuanvaeGuard 服务已注册并启动');
  });

  it('sdset 失败只告警、不中止：仍然继续 start 并成功', () => {
    const r = interpretPostinstall(POSTINSTALL, rcTable({ sdset: 5 }));
    expect(r.details.join('\n')).toMatch(/警告：授予服务启停权限失败（sc sdset 返回 5）/);
    expect(r.details).toContain('HuanvaeGuard 服务已注册并启动');
    expect(r.boxes).toEqual([]);
  });

  it('stop / delete 返回 1060（服务本来就不存在）不影响后续：这两条的 rc 是明确豁免的', () => {
    const r = interpretPostinstall(POSTINSTALL, rcTable({ stop: 1060, delete: 1060 }));
    expect(r.details).toContain('HuanvaeGuard 服务已注册并启动');
    expect(r.boxes).toEqual([]);
  });
});

describe('hooks.nsi ↔ src-tauri/src/desktop/huanvaeguard.rs — 服务定义必须逐字一致', () => {
  // 安装器与 App 内「修复服务」按钮注册的是**同一个**服务。任何一项写岔，
  // 修复按钮就会建出一个与安装器不同形态的服务（最典型：SDDL 少给 AU 启停权限 ⇒
  // 非管理员的主程序从此启停不了它），而两边各自都"成功"，没有任何一处会报错。
  const pairs: { label: string; rustConst: string }[] = [
    { label: '服务名', rustConst: 'SERVICE_NAME' },
    { label: '显示名', rustConst: 'SERVICE_DISPLAY_NAME' },
    { label: '描述', rustConst: 'SERVICE_DESCRIPTION' },
    { label: 'SDDL', rustConst: 'SERVICE_SDDL' },
  ];

  for (const { label, rustConst } of pairs) {
    it(`${label}（Rust 常量 ${rustConst}）的值必须原样出现在 hooks.nsi 里`, () => {
      const m = new RegExp(`const ${rustConst}: &str = "([^"]+)"`).exec(RUST);
      expect(m, `huanvaeguard.rs 里找不到 const ${rustConst}`).not.toBeNull();
      const value = m![1];
      expect(value.length).toBeGreaterThan(0);
      expect(NSI, `hooks.nsi 里没有 ${rustConst} 的值：${value}`).toContain(value);
    });
  }

  it('守护进程相对路径两边一致（HuanvaeGuard\\huanvaeguard-svc.exe）', () => {
    expect(NSI).toContain('$INSTDIR\\HuanvaeGuard\\huanvaeguard-svc.exe');
    expect(RUST).toContain('huanvaeguard-svc.exe');
    expect(RUST).toContain('"HuanvaeGuard"');
  });
});

describe('perMachine 的必要配套：Windows 数据根不能落在 Program Files', () => {
  // perMachine 把 INSTDIR 挪到 Program Files（标准用户只读），而本项目是 portable 布局、
  // 数据就在 exe 同级的 data\ —— 少了 user_data.rs 那支重定向，App 在 Windows 上直接废掉
  // （SQLite 建不了库）。这两条守的就是"改了安装模式却忘了配套"这一类静默失效。
  const USER_DATA = read('src-tauri/src/user_data.rs');
  const PRODUCT_NAME = (JSON.parse(read('src-tauri/tauri.conf.json')) as { productName: string })
    .productName;

  it('user_data.rs 必须有 Program Files 重定向分支', () => {
    expect(USER_DATA).toContain('ProgramFiles');
    expect(USER_DATA).toContain('data_local_dir');
  });

  it('重定向用的目录名必须等于 tauri.conf.json 的 productName（否则存量用户找不到自己的旧数据）', () => {
    // 老的 currentUser 安装 INSTDIR = %LOCALAPPDATA%\<productName>，数据在它下面的 data\。
    // 用同一个名字，升级到 perMachine 版之后能原地接上，不需要任何迁移代码。
    const m = /const WINDOWS_DATA_DIR_NAME: &str = "([^"]+)"/.exec(USER_DATA);
    expect(m, 'user_data.rs 里找不到 const WINDOWS_DATA_DIR_NAME').not.toBeNull();
    expect(m![1]).toBe(PRODUCT_NAME);
  });

  it('PREINSTALL 不许用 RMDir /r 删旧安装目录（那正是用户聊天库所在的地方）', () => {
    // 旧的用户级安装目录 = %LOCALAPPDATA%\<productName>，也就是新数据根的父目录。
    // 递归删 = 升级当天把 chat_data.db / accounts.json / 文件缓存一起清掉。
    expect(PREINSTALL).not.toMatch(/RMDir\s+\/r/);
    expect(UNINSTALL_PREV).not.toMatch(/RMDir\s+\/r/);
    // 正对照：非递归的 RMDir 确实还在（不是把它整个删了才"通过"的）。
    // 两个调用点共用一段正文 ⇒ 正文里 1 处，PREINSTALL 里插 2 次。
    expect(UNINSTALL_PREV.match(/^\s*RMDir\s+"\$1"$/gm) ?? []).toHaveLength(1);
    expect(
      PREINSTALL.match(/^\s*!insertmacro\s+HUANVAE_UNINSTALL_PREVIOUS\s+HK/gm) ?? [],
    ).toHaveLength(2);
  });
});
