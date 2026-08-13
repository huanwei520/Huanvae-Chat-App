/**
 * 契约测试：发布流水线下发给客户端的更新 URL 必须是**原始仓库直链**，不得带任何代理 / 加速前缀。
 *
 * 背景：`.github/workflows/release.yml` 生成两份客户端真正去读的更新清单——
 * 桌面端 `latest.json`（Tauri updater 消费）与 `android-latest.json`
 * （`src/update/service.android.ts` 消费）。历史上这两份清单里的 `url` 都长成
 * `"${PROXY}https://github.com/..."`，即在原始 release 链接前面拼了一层第三方加速站。
 * 2026-08-13 按 huanwei「不要再指向任何镜像了，**全部都用原始仓库链接**」+
 * 「不留降级路径」的口径全部去掉。
 *
 * 为什么必须是**机器**复查而不是散文声明：`.github/workflows/**` 历来不在任何门禁的
 * 覆盖面内——TypeScript 不解析 YAML、ESLint 只扫 `src/`、cargo/clippy 不碰它，
 * 而它**只在 push tag 那一刻才真正执行**。也就是说，谁"顺手加回一层加速前缀提速"，
 * 唯一的可观测后果是"没人发现，直到用户装到一个从代理站下来的包"。
 * 本测试就是那个观测点。（同套路：gradle-distribution-upstream / animation-conflict /
 * css-encoding / secure-display-routing；静态扫描读文件用 `__dirname`，
 * 见 .claude/rules/frontend-test.md）
 *
 * ## 口径：禁的是「把代理域名当**真值**拼进下发 URL」，不是「禁止该字符串出现」
 *
 * 判定一律在**剥掉注释之后的代码行**上做（YAML 注释 = 整行 trim 后以 `#` 开头）。
 * 这样一条正当的历史说明注释（例如 `# 2026-08-13: 去掉 cdn.gh-proxy.org 前缀`）
 * 不会被判违规——否则这条测试会逼着后来的人**删掉正确的文档**才能过门禁。
 * 对齐 .claude/rules/frontend-test.md 「不变量口径写"禁裸写死"，不是"禁出现该数字"；
 * 且要在【剥掉注释的代码】上判」。
 *
 * 剥注释只剥「整行注释」、不做行尾截断：YAML 的 `#` 要成为注释必须前置空白，
 * 而本文件里 URL / shell 片段中出现的 `#` 若按"行中间截断"处理会把 URL 拦腰砍断，
 * 反而制造假 PASS（被砍掉的后半段里若有代理前缀就扫不到了）。
 *
 * ## 本测试**防不住**什么（写清楚，别让读者以为它是全覆盖）
 *
 * - 防不住 denylist 之外的新加速站域名——真正兜底的是下面那条**白名单**断言
 *   （每条下发 URL 必须以 `https://github.com/` 或 `${R2_BASE}/` 起头，
 *   任何前缀都会让它红）。
 * - 防不住**运行期**注入：GitHub Actions 的仓库级 / 组织级 variables、secrets
 *   或 workflow_dispatch 入参都能在源码面之外改变最终值。
 * - 防不住 R2 那一侧（`${R2_BASE}` 指向 store.huanvae.cn 自建源，本就不是"镜像"，
 *   它是本产品自己的分发源，白名单里显式放行）。
 * - 不检查 URL 指向的产物是否真的存在——那由 workflow 自己的"必需产物齐全"断言负责。
 */

/* eslint-disable no-undef */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PROJECT_ROOT = resolve(__dirname, '..');
/* eslint-enable no-undef */

const WORKFLOW_REL = '.github/workflows/release.yml';

/**
 * 下发 URL 允许的两种起头形态（白名单，兜底判据）。
 *
 * - `https://github.com/` —— 原始仓库 release 直链（huanwei 口径里的"原始仓库链接"）
 * - `${R2_BASE}/` —— 本产品自建 R2 源（不是第三方镜像，是自己的分发源）
 */
const ALLOWED_URL_PREFIXES = ['https://github.com/', '${R2_BASE}/'];

/**
 * 已知代理 / 加速站 / 镜像标记。命中任意一条即视为"下发链路被指向第三方"。
 *
 * 这是**黑名单侧**的早期告警（能给出比"前缀不在白名单里"更具体的报错文案）；
 * 真正的兜底是下面那条白名单断言。
 */
const PROXY_MARKERS: { label: string; re: RegExp }[] = [
  { label: 'gh-proxy 加速站', re: /gh-?proxy/i },
  { label: 'ghfast 加速站', re: /ghfast/i },
  { label: 'kkgithub 加速站', re: /kkgithub/i },
  { label: 'hub.fgit 加速站', re: /hub\.fgit/i },
  { label: 'moeyy 加速站', re: /moeyy/i },
  { label: 'jsdelivr CDN 转发', re: /jsdelivr/i },
  { label: 'mirrors.* 主机', re: /(^|[/@.])mirrors\.[a-z0-9-]/i },
];

/**
 * 剥掉 YAML 的整行注释。
 *
 * YAML 注释：整行去掉前导空白后以 `#` 开头。**不做行尾截断**——理由见文件头。
 */
function stripYamlLineComments(src: string): string {
  return src
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
}

/** 取出所有下发给客户端的下载 URL（`"url"` 与 `"directUrl"` 两个键，行首锚定）。 */
function collectDeliveredUrls(code: string): string[] {
  const out: string[] = [];
  const re = /^[ \t]*"(?:url|directUrl)":[ \t]*"([^"]*)"/gm;
  let m = re.exec(code);
  while (m !== null) {
    out.push(m[1]);
    m = re.exec(code);
  }
  return out;
}

const WORKFLOW_SRC = readFileSync(resolve(PROJECT_ROOT, WORKFLOW_REL), 'utf-8');
const WORKFLOW_CODE = stripYamlLineComments(WORKFLOW_SRC);
const DELIVERED_URLS = collectDeliveredUrls(WORKFLOW_CODE);

describe('发布流水线下发的更新 URL 必须是原始仓库直链（防回退到代理）', () => {
  it('正对照：扫描器真读到了 workflow，且真抽出了下发 URL（防扫空 → 下面的断言空转假通过）', () => {
    // 锚点 1：文件确实是那个 workflow（而不是读空 / 读错文件）
    expect(WORKFLOW_SRC).toMatch(/^name: Release$/m);
    // 锚点 2：确实抽到了 URL；条数用下界而不是等号——加一个平台是正当改动，
    // 锁死条数会把"加平台"变成"必须先改测试"。
    expect(DELIVERED_URLS.length).toBeGreaterThanOrEqual(12);
    // 锚点 3：抽到的确实是那几条已知的下发 URL（形状对得上，不是抽了一堆别的东西）
    expect(DELIVERED_URLS.some((u) => u.includes('_x64-setup.exe'))).toBe(true);
    expect(DELIVERED_URLS.some((u) => u.includes('_aarch64.app.tar.gz'))).toBe(true);
    expect(DELIVERED_URLS.some((u) => u.includes('${APK_NAME}'))).toBe(true);
  });

  it('每一条下发 URL 都以原始仓库直链 / 自建 R2 源起头，前面没有任何前缀', () => {
    const violations = DELIVERED_URLS.filter(
      (u) => !ALLOWED_URL_PREFIXES.some((p) => u.startsWith(p)),
    );
    // 报错时直接把违规的那几条原样打出来，不用再回去翻文件
    expect(violations).toEqual([]);
  });

  it('代码行里不含任何已知代理 / 加速站（注释里写历史说明不算）', () => {
    const hits = PROXY_MARKERS.filter((m) => m.re.test(WORKFLOW_CODE)).map((m) => m.label);
    expect(hits).toEqual([]);
  });

  it('不残留任何代理变量（死配置也是污染：定义了没人读，下一个人会以为它生效）', () => {
    // `PROXY=` / `PROXY_URLS:` 这两种历史形态，剥注释后一条都不许有
    expect(WORKFLOW_CODE).not.toMatch(/^[ \t]*PROXY(_URLS)?\s*[:=]/m);
  });
});
