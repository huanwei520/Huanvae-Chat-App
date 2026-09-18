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
 *     （2026-08-29 订正：本机【有】makensis v3.12，gen-49 单4 用它对 hooks.nsi 做过真编译 +
 *     变异自证；但它仍不在 `pnpm test:run` 门禁里，所以"本文件覆盖不到"这句仍然成立。）
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
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

/** 平台 conf 与基础 conf 的 bundle.resources（tauri-cli 2.11.1 json_patch::merge 即 RFC 7396：对象深合并、数组整体覆盖，
 *  映射写在任一处都生效，故守卫判【并集】而非硬性要求写在哪个文件） */
function resourcesOf(file: string): Record<string, string> {
  const conf = JSON.parse(read(file)) as { bundle?: { resources?: Record<string, string> } };
  return conf.bundle?.resources ?? {};
}
const RES_DESKTOP = { ...resourcesOf('src-tauri/tauri.conf.json'), ...resourcesOf('src-tauri/tauri.windows.conf.json') };
const RES_MACOS = { ...resourcesOf('src-tauri/tauri.conf.json'), ...resourcesOf('src-tauri/tauri.macos.conf.json') };

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
    // 组命令行时必须自己补回一对引号（$0 此时已不带引号）。
    // 🔴 这里**故意**同时接受两种形状：直接写在 ExecWait 上，或写在按 $UpdateMode 组装命令行的
    // 种子 StrCpy 上。理由是"引号"与"/UPDATE"是两条互相独立的不变量 —— 把它们绑在同一条断言里，
    // 动其中一条就会让另一条跟着红，变异自证就再也说不清是哪一条在守门。
    // /UPDATE 那条不变量由本文件末尾那个 describe 单独守。
    expect(UNINSTALL_PREV).toMatch(/(ExecWait\s+|StrCpy\s+\$\d\s+)'"\$0"\s+\/S/);
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
// 跑旧卸载器的命令行：update 模式下必须带 /UPDATE，且 /UPDATE 必须排在 _?= 之前
// ────────────────────────────────────────────────────────────────────────────
//
// ## 它守的是什么（v1.1.36 / 37 / 38 连着三版真机可复现的缺陷）
//
// Tauri NSIS 模板的 `Section Uninstall` 里有三处 `${If} $UpdateMode <> 1`，把
// 「删桌面/开始菜单 lnk + Unpin 任务栏 + 删 HKCU Run 自启项」整块围起来。旧卸载器是被
// hooks.nsi 这条 ExecWait 拉起的**独立进程**，它自己的 un.onInit 只从**命令行**解析
// `/UPDATE` —— 我们不传，它的 $UpdateMode 就是 0 ⇒ 按"用户在主动卸载"把那三样全删掉；
// 而新安装器此时 $UpdateMode = 1，模板里建快捷方式的两处直接 Return 不重建
// ⇒ 「删了不建」，一次升级图标全没，且安装日志里一个字都不会说。
// gen-49 单3 在真 Windows 上做过单变量复现（同一份 v1.1.37 字节，只差这一个 token）。
//
// ## 为什么必须是静态守卫（三条通道都拦不住它）
//
//   · `makensis` 拦不住 —— 实测把命令行退回修复前，`makensis -WX` 仍然 **rc=0**、零告警。
//     编译器对"命令行里少一个参数"零判别力。
//   · vitest 常规用例拦不住 —— jsdom 不跑 NSIS，macOS 不跑 Windows 安装器。
//   · 安装日志拦不住 —— 删与不删在 DetailPrint 上逐字同形（这正是它能安静发三版的原因）。
//
// ## 口径：判的是「**这条命令行在 update 分支上带不带 /UPDATE**」
//
// 🔴 **不是**「文件里出现过 `/UPDATE` 这个串」—— 后者会被本文件头那段讲历史的注释满足
// （本仓 frontend-test.md 已把这一类记成坏口径，同文件「HuanvaeGuard 服务已安装」那条
// 就是同族前科）。所以：① 一律判在**剥掉注释**的 `UNINSTALL_PREV` 上；② 不做纯文本 grep，
// 而是**把命令行组装那一小段真的跑一遍**，分别注入 $UpdateMode = 1 / 0，比较两次的产物。
//
// ## 本守卫抓不到什么
//
//   · 它证明不了旧卸载器**真的收到**了 /UPDATE（那是运行时，只有真机能证；
//     gen-49 单4 §2 用现成发货字节做了单变量 A/B）。它只证明**我们组出来的那条命令行**
//     长什么样 —— 别把这两件事合并成一句"修复已验证"。
//   · 解释器只认下面列出的几条指令，遇到不认识的行**直接抛错**；否则脚本一改形状，
//     它会静默跳过看不懂的行，守卫就退化成恒绿的假证明。

/** 模拟值：这两个register 在运行时分别是「剥了引号的 UninstallString」与「它的父目录」。 */
const SIM_UNINST = 'C:\\Program Files\\Huanvae-Chat-App\\uninstall.exe';
const SIM_DIR = 'C:\\Program Files\\Huanvae-Chat-App';

/**
 * 把 `HUANVAE_UNINSTALL_PREVIOUS` 里「组装并执行旧卸载器命令行」那一小段真的跑一遍，
 * 返回 ExecWait 最终拿到的那条命令行字符串。
 *
 * 支持两种形状，正是修复前后各一种：
 *   · `ExecWait '<字面量>' $rc`      —— 修复前：命令行写死，无分支
 *   · `ExecWait '$N' $rc` + 前面若干 StrCpy $N —— 修复后：按 $UpdateMode 组装
 */
function renderUninstallerCommandLine(body: string, updateMode: 0 | 1): string {
  const lines = body.split(/\r?\n/);
  const iExec = lines.findIndex((l) => /^\s*ExecWait\b/.test(l));
  if (iExec < 0) { throw new Error('HUANVAE_UNINSTALL_PREVIOUS 里找不到 ExecWait'); }

  const mExec = /^\s*ExecWait\s+'(.*)'\s+\$\d\s*$/.exec(lines[iExec]);
  if (mExec === null) { throw new Error(`ExecWait 形状不认识：${lines[iExec].trim()}`); }
  const arg = mExec[1];

  const subst = (raw: string, self: string, selfReg: string): string =>
    raw
      .split(selfReg).join(self)
      .split('$0').join(SIM_UNINST)
      .split('$1').join(SIM_DIR);

  // 形状 A：命令行是写死的字面量（修复前就是这样），没有任何 $UpdateMode 分支
  const mReg = /^\$(\d)$/.exec(arg);
  if (mReg === null) { return subst(arg, '', '\u0000never'); }

  // 形状 B：ExecWait 跑的是一个 register，往前找组装它的那几行
  const reg = `$${mReg[1]}`;
  const assignRe = new RegExp(`^\\s*StrCpy\\s+\\${reg}\\s+(['"])(.*)\\1\\s*$`);
  let iStart = -1;
  for (let i = iExec - 1; i >= 0; i -= 1) {
    const m = assignRe.exec(lines[i]);
    // 种子行 = 赋给 reg 且右值**不引用** reg 自己
    if (m !== null && !m[2].includes(reg)) { iStart = i; break; }
  }
  if (iStart < 0) { throw new Error(`找不到组装 ${reg} 的种子行（ExecWait 跑的是一个没人赋值的变量）`); }

  let value = '';
  let active = true;
  let depth = 0;
  for (let i = iStart; i < iExec; i += 1) {
    const line = lines[i].trim();
    if (line === '') { continue; }
    if (line === 'ClearErrors') { continue; }

    const mIf = /^\$\{If\}\s+\$UpdateMode\s+=\s+1$/.exec(line);
    if (mIf !== null) { depth += 1; active = updateMode === 1; continue; }
    if (line === '${EndIf}') {
      if (depth === 0) { throw new Error('${EndIf} 没有配对的 ${If}'); }
      depth -= 1; active = true; continue;
    }
    const mSet = assignRe.exec(line);
    if (mSet !== null) {
      if (active) { value = subst(mSet[2], value, reg); }
      continue;
    }
    throw new Error(`命令行组装段里有不认识的指令（形状变了，请同步扩展解释器）：${line}`);
  }
  if (depth !== 0) { throw new Error('${If} 没有配对的 ${EndIf}'); }
  return value;
}

describe('hooks.nsi PREINSTALL — 跑旧卸载器的命令行必须按 $UpdateMode 带上 /UPDATE', () => {
  const CMD_UPDATE = renderUninstallerCommandLine(UNINSTALL_PREV, 1);
  const CMD_MANUAL = renderUninstallerCommandLine(UNINSTALL_PREV, 0);

  it('🔴 $UpdateMode = 1 时命令行必须含 /UPDATE —— 不含 = 升级一次快捷方式全没', () => {
    expect(CMD_UPDATE, `update 分支组出来的命令行：${CMD_UPDATE}`).toMatch(/(^|\s)\/UPDATE(\s|$)/);
  });

  it('$UpdateMode = 0（用户手动装）时不许带 /UPDATE —— 那会让旧卸载器保留本该清掉的东西', () => {
    expect(CMD_MANUAL, `非 update 分支组出来的命令行：${CMD_MANUAL}`).not.toMatch(/\/UPDATE/);
  });

  it('两个分支必须产出【不同】的命令行（相同 = 那个 ${If} 是摆设，守卫也就没有判别力）', () => {
    expect(CMD_UPDATE).not.toBe(CMD_MANUAL);
  });

  it('🔴 /UPDATE 必须排在 _?= 之【前】—— NSIS 手册 3.2.2：_?= 必须是命令行最后一个参数', () => {
    // 官方原文："_?= sets $INSTDIR ... It must be the last parameter used in the command line"
    // 写成 `_?=$1 /UPDATE` 时，旧卸载器拿到的 $INSTDIR 会变成 "<目录> /UPDATE"、
    // 而 $UpdateMode 仍然是 0 —— 两个后果一起发生，且没有任何一处会报错。
    const iUpd = CMD_UPDATE.indexOf('/UPDATE');
    const iQ = CMD_UPDATE.indexOf('_?=');
    expect(iUpd, '命令行里找不到 /UPDATE').toBeGreaterThanOrEqual(0);
    expect(iQ, '命令行里找不到 _?=').toBeGreaterThanOrEqual(0);
    expect(iUpd, `/UPDATE 排到了 _?= 后面，会被吞进目录路径：${CMD_UPDATE}`).toBeLessThan(iQ);
  });

  it('两个分支的命令行都必须以 `_?=<旧安装目录>` 结尾（后面不许再挂任何参数）', () => {
    for (const [label, cmd] of [['update', CMD_UPDATE], ['manual', CMD_MANUAL]] as const) {
      expect(cmd, `${label} 分支：_?= 后面还有别的东西 -> ${cmd}`).toBe(
        `${cmd.slice(0, cmd.indexOf('_?='))}_?=${SIM_DIR}`,
      );
    }
  });

  it('两个分支都必须以带引号的卸载器路径 + /S 开头（路径含空格，丢引号就跑不起来）', () => {
    for (const [label, cmd] of [['update', CMD_UPDATE], ['manual', CMD_MANUAL]] as const) {
      expect(cmd, `${label} 分支开头不对：${cmd}`).toMatch(
        new RegExp(`^"${SIM_UNINST.replace(/[\\]/g, '\\\\')}" /S(\\s|$)`),
      );
    }
  });

  it('分支判的必须是 $UpdateMode 本身（模板声明的那个变量），且写在剥掉注释的代码里', () => {
    // 判在 UNINSTALL_PREV（已剥整行注释）上 ⇒ 注释里怎么写都满足不了它。
    expect(UNINSTALL_PREV).toMatch(/^\s*\$\{If\}\s+\$UpdateMode\s+=\s+1\s*$/m);
    // 正对照：同一个串在**含注释**的原文里也在（证明这条查法在这份文件上会响，
    // 而不是"这份文件里根本没有 UpdateMode 这个词"）
    expect(NSI_RAW).toContain('$UpdateMode');
  });

  it('解释器本身有判别力：喂一条退回修复前形状的正文，上面那条 /UPDATE 断言必须落空', () => {
    // 这是守卫的**自证**：把 ExecWait 换回写死的旧命令行，renderUninstallerCommandLine
    // 应当两个分支都产出同一条不含 /UPDATE 的命令行。若它此时仍"通过"，说明守卫是假的。
    // 🔴 用函数式 replace，不用字符串式 —— 字符串替换里的 `$1` 会被 JS 当成捕获组引用，
    // 悄悄把 `_?=$1`（NSIS 的 register）换成别的东西，构造出来的样本就不是"修复前那份"了。
    const REVERTED = UNINSTALL_PREV.replace(
      /^\s*StrCpy \$\d '"\$0" \/S'[\s\S]*?^\s*ExecWait\s+'\$\d'\s+\$\d\s*$/m,
      () => "    ClearErrors\n    ExecWait '\"$0\" /S _?=$1' $2",
    );
    expect(REVERTED, '构造退回样本失败（正文形状变了）').not.toBe(UNINSTALL_PREV);
    const a = renderUninstallerCommandLine(REVERTED, 1);
    const b = renderUninstallerCommandLine(REVERTED, 0);
    expect(a).not.toMatch(/\/UPDATE/);
    expect(a).toBe(b);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// POSTINSTALL 失败路径可达性：对**真实脚本文本**跑一个最小 NSIS 子集解释器
// ────────────────────────────────────────────────────────────────────────────
//
// 「每条 sc.exe 后面有 Pop」和「失败分支里有 MessageBox」都只是**形状**断言 —— 它们证明不了
// rc≠0 的时候控制流真的会落进那个分支（少一个 ${Else}、把 ${If} 写反，形状断言照样全绿）。
// 真跑一遍安装器做不到（那要 Windows 真机）；而 makensis 只做编译，它对"控制流落到哪一支"
// 同样零判别力（gen-49 实测：把命令行退回缺陷形态，`makensis -WX` 仍然 rc=0、零告警）。
// 能在 vitest 里做到的最强替代是：
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

/**
 * 条件表达式的求值：LogicLib 的三种比较
 *   · `==` / `!=` ：NSIS 官方语义是**字符串**比较（`!=` 也是字符串不等）；
 *   · `=`  / `!=` ：整数比较（LogicLib 手册：`$x = 0` 按整数比）。
 * 我们的 `$HgGuardExists = 0` 走整数支；两边都能 parse 成数字才按数字比，
 * 否则退回字符串比较（与 LogicLib「非数字操作数按字符串比」的宽容一致）。
 */
function evalCond(lhs: string, op: string, rhs: string): boolean {
  if (op === '==') { return lhs === rhs; }
  const ln = Number.parseInt(lhs, 10);
  const rn = Number.parseInt(rhs, 10);
  if (!Number.isNaN(ln) && !Number.isNaN(rn)) { return op === '=' ? ln === rn : ln !== rn; }
  return op === '=' ? lhs === rhs : lhs !== rhs;
}

/**
 * 支持的最小子集：nsExec::ExecToLog / Pop / ${If}/${OrIf}/${Else}/${EndIf} /
 * DetailPrint / MessageBox / Sleep
 *
 * `initVars`：模拟安装前态变量（如 $HgGuardExists —— 它由 PREINSTALL 写入，不在
 * POSTINSTALL 文本内；不注入就无法模拟「更新前在跑/停着」这两条分支）。
 */
function interpretPostinstall(
  body: string,
  rcOf: (cmd: string) => number,
  initVars: Record<string, string> = { HgGuardExists: '0' },
): NsisRun {
  const details: string[] = [];
  const boxes: string[] = [];
  const regs = new Map<string, string>(
    Object.entries(initVars).map(([k, v]) => [`$${k}`, v]),
  );
  const pending: string[] = [];
  // 每一层记录 { taken: 本层是否已有分支被执行, active: 当前分支是否执行 }
  const stack: { taken: boolean; active: boolean }[] = [];
  const active = () => stack.every((f) => f.active);

  const subst = (s: string) =>
    s.replace(/\$(\d)/g, (_m, d: string) => regs.get(`$${d}`) ?? '');

  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') { continue; }

    const mIf = /^\$\{If\}\s+(\$\w+)\s+(==|!=|=)\s+(\S+)$/.exec(line);
    if (mIf) {
      const lhs = regs.get(mIf[1]) ?? '';
      const ok = evalCond(lhs, mIf[2], mIf[3]);
      const branch = active() && ok;
      stack.push({ taken: branch, active: branch });
      continue;
    }
    // ${OrIf}：与上一支共栈。若之前的条件已命中（taken）⇒ 整块保持执行；
    // 否则只有外层 active && 本条件成立才执行。
    const mOrIf = /^\$\{OrIf\}\s+(\$\w+)\s+(==|!=|=)\s+(\S+)$/.exec(line);
    if (mOrIf) {
      const top = stack[stack.length - 1];
      if (top === undefined) { throw new Error('${OrIf} 没有配对的 ${If}'); }
      if (top.taken) {
        top.active = true;
      } else {
        const lhs = regs.get(mOrIf[1]) ?? '';
        top.active =
          stack.slice(0, -1).every((f) => f.active) && evalCond(lhs, mOrIf[2], mOrIf[3]);
        top.taken = top.taken || top.active;
      }
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
  it('全成功（fresh install）：打印成功文案，一个 MessageBox 都不弹', () => {
    const r = interpretPostinstall(POSTINSTALL, rcTable({}));
    expect(r.details).toContain('HuanvaeGuard 服务已注册并启动');
    expect(r.boxes).toEqual([]);
  });

  it('🔴 更新且服务更新前在跑：start 必须执行（按前态恢复）', () => {
    const r = interpretPostinstall(
      POSTINSTALL,
      rcTable({}),
      { HgGuardExists: '1', HgGuardWasRunning: '1' },
    );
    expect(r.details).toContain('HuanvaeGuard 服务已注册并启动');
    expect(r.details).not.toContain('保持停止状态');
    expect(r.boxes).toEqual([]);
  });

  it('🔴 更新且服务更新前停着：不许 start（更新前未运行则不拉），且必须明说', () => {
    const r = interpretPostinstall(
      POSTINSTALL,
      rcTable({}),
      { HgGuardExists: '1', HgGuardWasRunning: '0' },
    );
    expect(r.details.join('\n')).toContain('保持停止状态');
    expect(r.details.join('\n')).not.toMatch(/已注册并启动/);
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

// ────────────────────────────────────────────────────────────────────────────
// bundle.resources — HuanvaeGuard 组件必须真的映射进安装包
// ────────────────────────────────────────────────────────────────────────────
//
// ## 它守的是什么（v1.1.46 真实事故，owner 实机两次撞墙）
//
// 06e52282 为绕过 msvc/apple-darwin 形态件缺位，把 tauri.windows/macos.conf.json 改成
// `{"bundle":{"externalBin":[]}}`，把平台 conf 里原有的 bundle.resources 映射一并删掉：
//   · Windows 包从此不含 HuanvaeGuard/huanvaeguard-svc.exe 与 wintun.dll；
//   · 安装器 sc create 成功（注册不校验文件存在）→ sc start 恒返回 2（系统找不到文件）
//     → App 内「修复服务」同样失败；
//   · 安装日志与既有门禁全部绿灯（门禁只查脚本与配置文本，从不开解产物看内容），
//     带病发了 v1.1.46。
//
// ## 合并语义依据（为什么判"并集"）
//
// tauri-cli 2.11.1 src/helpers/config.rs:6 `use json_patch::merge`（RFC 7396 JSON Merge
// Patch：对象递归深合并、数组整体覆盖）⇒ 映射写在基础 conf 或平台 conf 任一处都生效，
// 所以这里判【并集】，不硬性要求写在哪个文件；但只要任何一处把 guard 映射删干净，
// 这组用例立刻红。Notification-Sounds 一并钉住：防止平台映射调整时把基础映射静默挤丢。
//
// ## 本文件抓不到什么（同上文静态扫描的边界）
//
// 它证明不了"构建机真的把映射的文件打进了产物"——产物内容由
// scripts/linux/assert-artifact-content.sh 的产物腿（解包核对）承担，两者配套。
describe('bundle.resources — HuanvaeGuard 组件映射（v1.1.46 缺件事故的门禁）', () => {
  const entriesOf = (m: Record<string, string>) => Object.entries(m);

  it('Windows/桌面并集必须含 HuanvaeGuard → HuanvaeGuard/ 映射（缺 = sc start 必失败的事故形态）', () => {
    const hits = entriesOf(RES_DESKTOP).filter(
      ([k, v]) => /HuanvaeGuard\/\*$/.test(k) && v === 'HuanvaeGuard/',
    );
    expect(
      hits,
      `并集中 HuanvaeGuard 映射缺失或不唯一：${JSON.stringify(RES_DESKTOP)}`,
    ).toHaveLength(1);
  });

  it('macOS 并集必须含 HuanvaeGuard-macos → HuanvaeGuard-macos/ 映射', () => {
    const hits = entriesOf(RES_MACOS).filter(
      ([k, v]) => /HuanvaeGuard-macos\/\*$/.test(k) && v === 'HuanvaeGuard-macos/',
    );
    expect(
      hits,
      `并集中 HuanvaeGuard-macos 映射缺失或不唯一：${JSON.stringify(RES_MACOS)}`,
    ).toHaveLength(1);
  });

  it('既有 Notification-Sounds 映射不得在任一并集中静默丢失', () => {
    for (const [label, res] of [['desktop', RES_DESKTOP], ['macos', RES_MACOS]] as const) {
      const hits = entriesOf(res).filter(
        ([k, v]) => /Notification-Sounds\/\*$/.test(k) && v === 'Notification-Sounds/',
      );
      expect(hits, `${label} 并集中 Notification-Sounds 映射缺失或不唯一`).toHaveLength(1);
    }
  });

  it('映射源文件必须在仓且非空（空占位文件进包也是坏的）', () => {
    for (const rel of [
      'src-tauri/resources/HuanvaeGuard/huanvaeguard-svc.exe',
      'src-tauri/resources/HuanvaeGuard/wintun.dll',
      'src-tauri/resources/HuanvaeGuard-macos/hg-macos',
    ]) {
      const st = statSync(resolve(__dirname, '..', rel));
      expect(st.isFile(), `${rel} 不是常规文件`).toBe(true);
      expect(st.size, `${rel} 是空文件`).toBeGreaterThan(0);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 🔴 更新/覆盖安装前停 HuanvaeGuard 服务并等完全停止（2026-09-16 owner 实机定案的
//   更新写失败根因：服务在跑 ⇒ huanvaeguard-svc.exe/wintun.dll 被锁 ⇒ 写入被拒 ⇒
//   残缺安装 ⇒ 1053/已安装未运行）
//
// 两条防线都必须在：
//   · Rust 更新链：src-tauri/src/updater_download.rs `stop_guard_service_for_update`
//     （App 内静默更新，在安装器启动之前停）；
//   · NSIS 钩：hooks.nsi `HUANVAE_GUARD_STOP_FOR_INSTALL`（手动安装/覆盖安装/兜底，
//     在跑旧卸载器与文件复制之前停）。
//
// 「停」与「等」缺一不可：sc stop rc=0 只代表 SCM 收下了请求，文件句柄释放要以
// SCM 终态 STOPPED 为准 —— 所以守卫钉的是「停 → 轮询 STOPPED → 超时中止」整条形状。
// 这里判的是**剥掉注释后**的代码（本文件头注释已记过"注释满足断言"的前科）。
// ────────────────────────────────────────────────────────────────────────────

const STOP_GUARD = macroBody(NSI, 'HUANVAE_GUARD_STOP_FOR_INSTALL');
const RUST_UPDATER = read('src-tauri/src/updater_download.rs');

/** HuanvaeGuard 服务名 —— 三处（NSIS 钩 / Rust 更新链 / Rust 常驻管理）必须逐字一致。 */
describe('HuanvaeGuard 服务名 —— 跨文件一致性（写岔 = 停错/停不到同一个服务）', () => {
  it('hooks.nsi 里所有 sc.exe 操作都指向同一个服务名，且与 Rust 两侧逐字一致', () => {
    const nsiNames = [
      ...NSI.matchAll(/sc\.exe (?:query|stop|start|delete|create) ([A-Za-z0-9_-]+)/g),
    ].map((m) => m[1]);
    expect(nsiNames.length, 'hooks.nsi 里应能扫到 sc.exe 服务操作').toBeGreaterThanOrEqual(6);
    for (const n of nsiNames) {
      expect(n, 'NSI 里出现了别的服务名').toBe('HuanvaeGuard');
    }
    expect(RUST_UPDATER).toMatch(/GUARD_SERVICE_NAME: &str = "HuanvaeGuard"/);
    expect(RUST).toMatch(/const SERVICE_NAME: &str = "HuanvaeGuard"/);
  });
});

describe('hooks.nsi HUANVAE_GUARD_STOP_FOR_INSTALL — 停服 + 等 STOPPED + 超时中止的形状', () => {
  it('PREINSTALL 的第一个动作必须是停服钩（必须赶在跑旧卸载器/文件复制之前）', () => {
    const lines = PREINSTALL.split(/\r?\n/).filter((l) => l.trim());
    const iStop = lines.findIndex((l) =>
      l.includes('!insertmacro HUANVAE_GUARD_STOP_FOR_INSTALL'),
    );
    expect(iStop, 'PREINSTALL 里找不到停服钩 insertmacro').toBeGreaterThanOrEqual(0);
    expect(iStop, '停服钩必须是 PREINSTALL 的第一个动作').toBe(0);
    const iUninst = lines.findIndex((l) => /HUANVAE_UNINSTALL_PREVIOUS/.test(l));
    expect(iUninst, '旧卸载器必须排在停服之后').toBeGreaterThan(iStop);
  });

  it('停服宏只被 insertmacro 一次（内含 Goto 标签，展开两次 = 标签重名编译失败）', () => {
    const whole = NSI.split(/\r?\n/).filter((l) =>
      l.includes('!insertmacro HUANVAE_GUARD_STOP_FOR_INSTALL'),
    );
    expect(whole, '停服钩必须恰好被插入一次').toHaveLength(1);
  });

  it('先探测服务存在性（sc query 的退出码），再 sc stop —— 顺序不可换', () => {
    const lines = STOP_GUARD.split(/\r?\n/);
    const iQuery = lines.findIndex(
      (l) => l.trim() === "nsExec::Exec 'sc.exe query HuanvaeGuard'",
    );
    const iStop = lineIndexOf(STOP_GUARD, /sc\.exe stop HuanvaeGuard/);
    expect(iQuery, '找不到服务存在性探测（裸 sc query 取 rc）').toBeGreaterThanOrEqual(0);
    expect(iStop, '找不到 sc.exe stop').toBeGreaterThanOrEqual(0);
    expect(iStop, 'sc stop 必须在存在性探测之后').toBeGreaterThan(iQuery);
  });

  it('nsExec 下没有 shell：全文件禁用管道/引号 find（VM 实测 rc=255 + find not recognized）', () => {
    const lines = NSI.split(/\r?\n/);
    const bad = lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => l.includes('nsExec::') && (/\|/.test(l) || /find \"/.test(l)));
    expect(
      bad.map(({ i, l }) => `第 ${i + 1} 行: ${l.trim()}`),
      'nsExec 命令行里出现管道或引号 find（CreateProcess 直跑会静默失败）',
    ).toHaveLength(0);
  });

  it('STATE 判定走「重定向到固定文件 + FileRead 扫 STOPPED」，记录前态与轮询各一次', () => {
    const lines = STOP_GUARD.split(/\r?\n/);
    const iRedirects = lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) =>
        l.includes('sc.exe query HuanvaeGuard 1>C:\\Windows\\Temp\\huanvae-guard-state.txt 2>&1'),
      )
      .map(({ i }) => i);
    expect(
      iRedirects.length,
      'state 重定向应出现两次（记录前态 + 轮询等待）',
    ).toBe(2);
    const iStop = lineIndexOf(STOP_GUARD, /sc\.exe stop HuanvaeGuard/);
    expect(
      iRedirects.find((i) => i > iStop),
      'sc stop 之后必须有 STOPPED 轮询（重定向式）',
    ).toBeGreaterThan(iStop);
    // 轮询必须带上限（标签 + 计数器 + IntCmp），不能死循环
    expect(STOP_GUARD).toMatch(/IntCmp \$\d+ 60 /);
    expect(STOP_GUARD).toMatch(/^\s*Sleep 500\s*$/m);
    // 子串扫描必须真的在找 STOPPED（FileRead 循环 + 7 字节切片）
    expect(STOP_GUARD).toContain('FileRead $3 $4');
    expect(STOP_GUARD).toContain('StrCpy $6 $4 7 $5');
    expect((STOP_GUARD.match(/\$6 == "STOPPED"/g) ?? []).length, 'STOPPED 子串比较应出现两次（记录前态 + 轮询）').toBe(2);
  });

  it('记录了两个前态变量（fresh install 与「更新前停着」的恢复语义依赖它们）', () => {
    expect(NSI).toMatch(/^Var HgGuardExists$/m);
    expect(NSI).toMatch(/^Var HgGuardWasRunning$/m);
    expect(STOP_GUARD).toContain('StrCpy $HgGuardExists 0');
    expect(STOP_GUARD).toContain('StrCpy $HgGuardWasRunning 0');
  });

  it('停服后必须轮询等待 STATE=STOPPED（只看 sc stop 的 rc 不算数）——上限与步长', () => {
    const iStop = lineIndexOf(STOP_GUARD, /sc\.exe stop HuanvaeGuard/);
    // 轮询主体（重定向 + 扫描 + 上限）在上一条已经钉死，这里只钉顺序关系。
    const iRedirect = STOP_GUARD
      .split(/\r?\n/)
      .findIndex((l) => l.includes('sc.exe query HuanvaeGuard 1>C:\\Windows\\Temp\\huanvae-guard-state.txt 2>&1'));
    expect(iRedirect, '找不到 state 重定向').toBeGreaterThanOrEqual(0);
    expect(STOP_GUARD).toMatch(/IntCmp \$\d+ 60 /);
    expect(STOP_GUARD).toMatch(/^\s*Sleep 500\s*$/m);
    expect(iStop, 'sc stop 必须在首次 state 读取之后').toBeGreaterThan(iRedirect);
  });

  it('超时分支必须中止安装（MessageBox + Abort，且 MessageBox 带 /SD 默认答案）', () => {
    const iTimeout = lineIndexOf(STOP_GUARD, /^\s*hg_guard_stop_timeout:\s*$/);
    expect(iTimeout, '找不到超时标签').toBeGreaterThanOrEqual(0);
    const lines = STOP_GUARD.split(/\r?\n/);
    const iAbort = lines.findIndex((l) => /^\s*Abort /.test(l));
    expect(iAbort, '超时分支必须 Abort（在文件被动之前中止，绝不硬覆盖）').toBeGreaterThan(iTimeout);
    // 中止必须带确定性退出码（静默安装时 ExitCode=7，供更新链/MDM 判别）
    const iSetErr = lines.findIndex((l) => /SetErrorLevel 7/.test(l));
    expect(iSetErr, '超时中止必须 SetErrorLevel 7（否则静默模式退出码为 0）').toBeGreaterThanOrEqual(0);
    expect(iSetErr).toBeLessThan(iAbort);
    const box = lines.find((l) => l.includes('MessageBox'));
    expect(box, '超时分支必须有用户可见的提示').toBeDefined();
    expect(box, 'MessageBox 缺 /SD 默认答案，静默安装会挂住').toContain('/SD');
    // 中止文案必须交代三件事：发生了什么 / 无残缺 / 下一步
    const stopLine = lines.find((l) => l.includes('继续安装会因服务文件被占用'));
    expect(stopLine, '文案必须说明为何中止（文件被占用）').toBeDefined();
    expect(stopLine, '文案必须说明未改动任何文件（无残缺安装）').toContain('未改动任何文件');
    expect(stopLine, '文案必须给出下一步动作').toMatch(/重启电脑|sc stop/);
  });

  it('每条 nsExec 后的返回值都必须被 Pop 走（本文件自己的铁律，宏内同样适用）', () => {
    const lines = STOP_GUARD.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('nsExec::')) {
        const next = (lines[i + 1] ?? '').trim();
        expect(next, `第 ${i + 1} 行的 nsExec 之后没有紧跟 Pop：${lines[i].trim()}`).toMatch(
          /^Pop \$\d$/,
        );
      }
    }
  });
});

describe('hooks.nsi POSTINSTALL — 服务启动必须按安装前状态决定（更新前未运行则不拉）', () => {
  it('sc.exe start 必须包在 ${If} $HgGuardExists = 0 ${OrIf} $HgGuardWasRunning = 1 里', () => {
    const lines = POSTINSTALL.split(/\r?\n/);
    const iCond = lines.findIndex(
      (l) => l.includes('${If} $HgGuardExists = 0') || l.includes('${OrIf} $HgGuardWasRunning = 1'),
    );
    expect(iCond, 'POSTINSTALL 里找不到按前态启动的条件').toBeGreaterThanOrEqual(0);
    const iStart = lines.findIndex((l) => l.includes('sc.exe start HuanvaeGuard'));
    expect(iStart, '找不到 sc.exe start').toBeGreaterThanOrEqual(0);
    expect(iStart, 'sc start 必须在前态条件之后').toBeGreaterThan(iCond);
    // 条件必须是「fresh install 或 更新前在跑」这两支的并集
    const condText = lines.slice(iCond, iCond + 3).join('\n');
    expect(condText).toContain('${If} $HgGuardExists = 0');
    expect(condText).toContain('${OrIf} $HgGuardWasRunning = 1');
  });

  it('「更新前未运行」分支必须有可见的说明（不许静默吞掉）', () => {
    expect(POSTINSTALL).toContain('保持停止状态');
  });
});

describe('Rust 更新链 — 安装器启动前必须先停服（src-tauri/src/updater_download.rs）', () => {
  it('stop_guard_service_for_update 必须存在，且调用点排在 install() 之前、带 Windows cfg', () => {
    const lines = RUST_UPDATER.split(/\r?\n/);
    const iDef = lines.findIndex((l) => l.includes('pub fn stop_guard_service_for_update'));
    expect(iDef, '找不到停服入口').toBeGreaterThanOrEqual(0);
    const iCall = lines.findIndex((l) => l.includes('stop_guard_service_for_update()?'));
    const iInstall = lines.findIndex((l) => l.includes('.install(&bytes)'));
    expect(iCall, '找不到停服调用点').toBeGreaterThanOrEqual(0);
    expect(iInstall, '找不到 install() 调用点').toBeGreaterThanOrEqual(0);
    expect(iCall, '停服必须发生在 install() 之前').toBeLessThan(iInstall);
    // 调用点必须带 #[cfg(target_os = "windows")]（紧邻上方）
    const window = lines.slice(Math.max(0, iCall - 3), iCall).join('\n');
    expect(window).toContain('#[cfg(target_os = "windows")]');
  });

  it('停服判定必须是纯函数（跨平台单测可达）且带轮询超时常量', () => {
    for (const fn of [
      'fn parse_guard_state(',
      'fn classify_stop_rc(',
      'fn stop_poll_decision(',
      'const GUARD_STOP_TIMEOUT: Duration',
      'const GUARD_STOP_POLL_INTERVAL: Duration',
    ]) {
      expect(RUST_UPDATER, `找不到 ${fn}`).toContain(fn);
    }
  });
});
