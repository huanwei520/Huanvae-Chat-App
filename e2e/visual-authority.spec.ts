/**
 * 视觉门禁自身的守卫（纯逻辑 + 纯文件系统，不开浏览器、不依赖 Tauri 桩）。
 *
 * 两组断言，各防一件事：
 *
 *  A. **真值表** —— 钉住 `decideVisualGate` 的安全属性：
 *     「权威平台（linux）在任何输入下都必须 run」。CI 跑在 ubuntu-latest ⇒ process.platform==='linux'
 *     ⇒ 这组断言就是「CI 不会被误跳过」的机器化证明。
 *     ⚠️ 它测的是**纯函数**（平台/env 是入参），所以在 darwin / win32 / linux 上跑出的结论相同 ——
 *     这正是把它写成纯函数的理由：否则「CI 不会被跳过」在 darwin 上物理上无法验证。
 *
 *  B. **基线覆盖面** —— 每一条 `toHaveScreenshot('x.png')` 都必须有一张对应的
 *     `e2e/snapshots/<spec>-snapshots/x-chromium-linux.png`。
 *     少一张 ⇒ CI 那条从此恒红（首跑写基线并 fail，而 CI 工作区每次都是干净的 ⇒ 永远停在首跑）；
 *     多一张 ⇒ 有孤儿基线（断言被删了、文件没删）。两侧都查。
 *     这条**不是**替代像素比对，它只保证「门有腿站着」。
 *
 *  C. **重复基线登记表** —— 任何两张权威基线**字节相同**时，必须出现在下面的
 *     `KNOWN_DUPLICATE_BASELINES` 里并写明理由；没登记 ⇒ FAIL；登记了但已经不重复 ⇒ 也 FAIL（登记表过期）。
 *     它防的是本仓真实发生过的那一类事故：2026-05 ~ 2026-08 有 5 条截图断言名字里写着
 *     light/dark，实际渲染出来的是同一张图（`emulateMedia({colorScheme})` 对本 App 零效果），
 *     **三个月无人发现，因为没有任何东西在查**。有这条守卫，那些断言在加进来的当天就会红。
 *     🔴 已知边界（必须写出来，别当它是全覆盖）：md5 是**字节**判据。
 *     被删掉的 `auth-dark-theme` 恰好是反例 —— 它与 `auth-initial` **md5 不同**（背景渐变的
 *     低对比差异），但在 Playwright 自己的比较器（pixelmatch, threshold 0.2）下差异 = **0 个像素**。
 *     ⇒ 「字节不同」不蕴含「视觉不同」，这条守卫抓不到那一档；要抓得起 Playwright 的比较器，
 *     而它的入口 `toMatchSnapshot` 在 `--update-snapshots` 下会**改写基线**，不能进常驻守卫。
 *
 * ## 扫描面：readdir 现扫，**不写死清单**
 *
 * 2026-08-21 之前这里是一份硬编码的 `SPECS_WITH_SCREENSHOTS = ['auth.spec.ts', 'visual-regression.spec.ts']`。
 * 那份清单**今天是完整的**，但没有任何东西保证它一直完整 —— 将来新增一个带 `toHaveScreenshot` 的 spec，
 * B 组不会查它的基线（缺基线 ⇒ CI 那条恒红而守卫沉默）、C 组也不会查它的重复。
 * 「名单靠人手同步」正是本仓反复出过事的形态，故改成：
 *
 *   - **spec 侧**：`readdir(e2eDir)` 取全部 `*.spec.ts`，排除本文件自身；
 *   - **基线侧**：`readdir(snapshotDir)` 取全部 `*-snapshots/` 目录 ——
 *     这样连「spec 文件被整个删掉、基线目录还留着」也能被 B 组的孤儿检查抓到。
 *
 * 🔴 仍然存在的已知边界（写出来，别当它是全覆盖）：
 *   1. 提取器是正则 `toHaveScreenshot(\s*'name.png'`，**只认单引号字面量**。
 *      双引号 / 模板串 / 变量名 / 省略名字的自动命名截图都抠不到 ——
 *      但它们的失败方向是**响亮的**：抠不到 ⇒ 基线成孤儿 ⇒ B 组当场红，不会静默放过。
 *   2. 提取器**不剥注释**。别的 spec 若在注释里原样写出 `toHaveScreenshot('x.png')`，
 *      会被当成一条真断言、进而索要一张不存在的基线 ⇒ 同样是**响亮**失败。
 *      本文件自身正因此被显式排除（文件头 B 段就写着这个字面量）。
 *      BACKLOG: 若将来误报变多，再引入剥注释的提取器（参考 tests/huanvaeguard-port-resolution.test.ts）。
 *
 * 路径一律从 `testInfo`（`file` / `project.snapshotDir`）取，不用 `__dirname`（本仓 package.json
 * 是 "type": "module"）也不用 `import.meta.url`（跨 CJS/ESM 转译形态不稳）。
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { test, expect } from '@playwright/test';
import {
  decideVisualGate,
  VISUAL_BASELINE_PLATFORM,
  VISUAL_FORCE_ENV,
} from './helpers/visual-authority';

/**
 * 已知且**有意保留**的重复基线（字节相同）。键写成 `<spec>-snapshots/<文件名>`。
 *
 * 🔴 登记 ≠ 洗白。能登记的只有「两条断言都没有在名字上承诺任何它不变化的维度」的重复；
 * 名字承诺了 dark/light 却渲染出同一张图的那种，处置是**删掉**，不是登记（见文件头 C 的说明）。
 */
const KNOWN_DUPLICATE_BASELINES: { files: string[]; reason: string }[] = [
  {
    files: [
      'auth.spec.ts-snapshots/auth-initial-chromium-linux.png',
      'visual-regression.spec.ts-snapshots/visual-login-default-chromium-linux.png',
    ],
    reason:
      '同一张「默认视口登录页」。两条断言并非等价：auth.spec.ts 那条用 maxDiffPixelRatio 0.01、' +
      'visual-regression.spec.ts 那条用 0.02 且 fullPage:true（当前页面不超出视口故暂无差别，' +
      '页面一旦变高就会拍到不同区域）。另外 auth.spec.ts 需要保留至少一条截图断言，' +
      '它与同文件的非截图断言混编，正是「不是整套被跳过」的正对照。' +
      'BACKLOG: 阈值另立单收敛后二选一。',
  },
  {
    files: [
      'auth.spec.ts-snapshots/auth-mobile-chromium-linux.png',
      'visual-regression.spec.ts-snapshots/visual-login-mobile-chromium-linux.png',
    ],
    reason: '同上，375x812 移动视口那一对（0.01 vs 0.02）。BACKLOG: 同上。',
  },
];

/**
 * 现扫 e2e 目录下的全部 spec，排除本文件自身（理由见文件头「扫描面」§已知边界 2）。
 * 排除项写成 `basename(test.info().file)` 而不是写死文件名 —— 本文件改名时不会静默失效。
 */
function discoverSpecFiles(e2eDir: string, selfSpec: string): string[] {
  return readdirSync(e2eDir)
    .filter((f) => f.endsWith('.spec.ts') && f !== selfSpec)
    .sort();
}

/** 现扫 snapshotDir 下的全部 `<spec>-snapshots/` 目录（spec 文件已被删时它仍在，故必须独立扫）。 */
function discoverSnapshotDirs(snapshotDir: string): string[] {
  if (!existsSync(snapshotDir)) {
    return [];
  }
  return readdirSync(snapshotDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.endsWith('-snapshots'))
    .map((d) => d.name)
    .sort();
}

/** `auth.spec.ts-snapshots` → `auth.spec.ts` */
function specFileOfSnapshotDir(dirName: string): string {
  return dirName.replace(/-snapshots$/, '');
}

/** 是不是一张「权威平台的真基线」：排除 AppleDouble 影子文件与非权威平台的本地产物。 */
function isAuthoritativeBaseline(fileName: string): boolean {
  // 点开头的一律不算基线：macOS 打包/拷贝会产出 AppleDouble `._xxx.png` 影子文件，
  // 它同样以 `-chromium-linux.png` 结尾 —— 实测在 linux 侧跑时会被误判成 9 个孤儿基线。
  // git 不跟踪它们（`git ls-files e2e/snapshots` 列出的全是真基线），属纯本地噪音。
  if (fileName.startsWith('.')) {
    return false;
  }
  // 非权威平台的本地产物不管（.gitignore 已排除，本来就不该入仓）
  return fileName.endsWith(`-chromium-${VISUAL_BASELINE_PLATFORM}.png`);
}

/** 从一个 spec 源码里抠出所有 `toHaveScreenshot('name.png'` 的 name。 */
function screenshotNamesOf(e2eDir: string, specFile: string): string[] {
  const src = readFileSync(join(e2eDir, specFile), 'utf-8');
  const names: string[] = [];
  const re = /toHaveScreenshot\(\s*'([^']+\.png)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    names.push(m[1]);
  }
  return names;
}

function baselineFileName(screenshotName: string): string {
  return `${screenshotName.replace(/\.png$/, '')}-chromium-${VISUAL_BASELINE_PLATFORM}.png`;
}

test.describe('视觉门禁守卫 — 判定逻辑真值表', () => {
  test('权威平台恒 run：force 无论取什么值都不能把它变成 skip', () => {
    for (const force of [undefined, '', '0', 'false', '1', 'true', 'anything']) {
      const d = decideVisualGate(VISUAL_BASELINE_PLATFORM, force);
      expect(d.run, `platform=${VISUAL_BASELINE_PLATFORM} force=${String(force)}`).toBe(true);
      expect(d.reason).toBeNull();
    }
  });

  test('非权威平台默认 skip，且原因行必须说清「权威在 CI linux / 本地不断言」', () => {
    for (const plat of ['darwin', 'win32', 'freebsd', 'android']) {
      const d = decideVisualGate(plat, undefined);
      expect(d.run, `platform=${plat}`).toBe(false);
      expect(d.reason, `platform=${plat}`).toContain('视觉回归权威在 CI linux');
      expect(d.reason, `platform=${plat}`).toContain('本地不断言');
      expect(d.reason, `platform=${plat}`).toContain(plat);
    }
  });

  test('逃生阀只放行、不设卡', () => {
    expect(decideVisualGate('darwin', '1').run).toBe(true);
    expect(decideVisualGate('darwin', 'true').run).toBe(true);
    // 只有明确的 '1' / 'true' 才放行；别的值一律仍是 skip（避免 E2E_VISUAL_FORCE=0 被读成「开」）
    expect(decideVisualGate('darwin', '0').run).toBe(false);
    expect(decideVisualGate('darwin', '').run).toBe(false);
    expect(VISUAL_FORCE_ENV).toBe('E2E_VISUAL_FORCE');
  });
});

test.describe('视觉门禁守卫 — 权威基线覆盖面', () => {
  test('每条截图断言都有对应的权威平台基线（缺一张 ⇒ CI 那条恒红）', () => {
    const e2eDir = dirname(test.info().file);
    const snapshotDir = test.info().project.snapshotDir;
    const specs = discoverSpecFiles(e2eDir, basename(test.info().file));
    // 正对照①：readdir 必须真的扫到 spec —— 空集会让下面每一条断言恒 PASS（假绿）
    expect(specs.length, 'e2e 目录下一个 *.spec.ts 都没扫到，扫描面坏了').toBeGreaterThan(0);

    const missing: string[] = [];
    const specsWithAssertions: string[] = [];
    let asserted = 0;
    for (const spec of specs) {
      const names = screenshotNamesOf(e2eDir, spec);
      if (names.length > 0) {
        specsWithAssertions.push(spec);
      }
      for (const n of names) {
        asserted += 1;
        if (!existsSync(join(snapshotDir, `${spec}-snapshots`, baselineFileName(n)))) {
          missing.push(`${spec} :: ${n}`);
        }
      }
    }
    // 正对照②：提取器必须真的抠到东西（本仓当前 auth / visual-regression 两个 spec 有真断言）
    expect(
      specsWithAssertions.length,
      '扫遍所有 spec 一条 toHaveScreenshot 都没抠到，提取器坏了',
    ).toBeGreaterThan(0);
    expect(asserted, '全仓截图断言总数为 0，说明扫描面写错了').toBeGreaterThan(0);
    expect(missing, `以下截图断言缺权威基线：\n${missing.join('\n')}`).toEqual([]);
  });

  test('没有孤儿权威基线（断言删了 / spec 整个删了，基线文件没删）', () => {
    const e2eDir = dirname(test.info().file);
    const snapshotDir = test.info().project.snapshotDir;
    // 从**基线目录**这一侧扫，而不是从 spec 清单扫：spec 文件被整个删掉时它的目录仍在，
    // 只有这样才抓得到那一类孤儿。
    const dirs = discoverSnapshotDirs(snapshotDir);
    expect(dirs.length, '一个 *-snapshots 目录都没扫到，snapshotDir 口径写错了').toBeGreaterThan(0);

    const orphans: string[] = [];
    let scanned = 0;
    for (const dirName of dirs) {
      const spec = specFileOfSnapshotDir(dirName);
      const specPath = join(e2eDir, spec);
      // spec 没了 ⇒ 它名下一张基线都不该留 ⇒ wanted 为空集，全部计作孤儿
      const wanted = existsSync(specPath)
        ? new Set(screenshotNamesOf(e2eDir, spec).map(baselineFileName))
        : new Set<string>();
      for (const f of readdirSync(join(snapshotDir, dirName))) {
        if (!isAuthoritativeBaseline(f)) {
          continue;
        }
        scanned += 1;
        if (!wanted.has(f)) {
          orphans.push(`${dirName}/${f}`);
        }
      }
    }
    expect(scanned, '一张权威基线都没扫到，说明 snapshotDir 或后缀口径写错了').toBeGreaterThan(0);
    expect(orphans, `以下权威基线没有任何断言在用：\n${orphans.join('\n')}`).toEqual([]);
  });
});

test.describe('视觉门禁守卫 — 重复基线登记表', () => {
  test('字节相同的权威基线必须已登记，且登记项必须仍然重复', () => {
    const snapshotDir = test.info().project.snapshotDir;
    const md5ByKey = new Map<string, string>();
    for (const dirName of discoverSnapshotDirs(snapshotDir)) {
      const dir = join(snapshotDir, dirName);
      for (const f of readdirSync(dir)) {
        // 与 B 组同口径：跳过 AppleDouble 影子文件与非权威平台产物
        if (!isAuthoritativeBaseline(f)) {
          continue;
        }
        md5ByKey.set(
          `${dirName}/${f}`,
          createHash('md5').update(readFileSync(join(dir, f))).digest('hex'),
        );
      }
    }
    // 正对照：扫到 0 张时下面每一条断言都恒真 —— 先把这条堵死
    expect(md5ByKey.size, '一张权威基线都没扫到，说明 snapshotDir 或后缀口径写错了').toBeGreaterThan(0);

    // 实际的重复分组（size >= 2）
    const byMd5 = new Map<string, string[]>();
    for (const [key, md5] of md5ByKey) {
      const bucket = byMd5.get(md5) ?? [];
      bucket.push(key);
      byMd5.set(md5, bucket);
    }
    const actualGroups = [...byMd5.values()]
      .filter((g) => g.length > 1)
      .map((g) => [...g].sort().join(' == '))
      .sort();

    // 登记表侧：文件必须都还在，且必须【仍然】互为重复（否则是过期登记）
    const staleEntries: string[] = [];
    for (const entry of KNOWN_DUPLICATE_BASELINES) {
      const missing = entry.files.filter((f) => !md5ByKey.has(f));
      if (missing.length > 0) {
        staleEntries.push(`登记项引用了不存在的基线: ${missing.join(', ')}`);
        continue;
      }
      const md5s = new Set(entry.files.map((f) => md5ByKey.get(f)));
      if (md5s.size !== 1) {
        staleEntries.push(`登记项已不再字节相同（可以从登记表删掉了）: ${entry.files.join(' == ')}`);
      }
    }
    expect(staleEntries, `重复基线登记表已过期：\n${staleEntries.join('\n')}`).toEqual([]);

    const declaredGroups = KNOWN_DUPLICATE_BASELINES
      .map((e) => [...e.files].sort().join(' == '))
      .sort();

    expect(
      actualGroups,
      '出现了未登记的重复基线（两条断言渲染出同一张图 = 其中至少一条没有携带任何信息）。\n' +
        '处置二选一：① 名字承诺了它不变化的维度 ⇒ 删掉那条断言与它的基线；' +
        '② 两条都没说谎 ⇒ 写进 KNOWN_DUPLICATE_BASELINES 并给出理由与 BACKLOG。',
    ).toEqual(declaredGroups);
  });
});
