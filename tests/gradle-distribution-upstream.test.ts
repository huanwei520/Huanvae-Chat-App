/**
 * 契约测试：Gradle wrapper 的发行版下载源必须是**上游** services.gradle.org，不得是任何镜像/加速站。
 *
 * 背景：`src-tauri/gen/android/gradle/wrapper/gradle-wrapper.properties` 的 `distributionUrl`
 * 是全仓**唯一一条 A 类（构建期依赖源）镜像**——npm（`.npmrc` = registry.npmjs.org）、
 * cargo（无 `[source.*] replace-with`）、maven/android（`google()` + `mavenCentral()`）本来就是上游，
 * 只有这一行长期指向第三方镜像。构建期依赖源指向镜像的问题在于：
 * 它决定了**编译进发货产物的那些字节从哪来**，而镜像方的内容既不受本仓控制、也没有签名校验
 * （wrapper 的 `distributionSha256Sum` 本仓未设），供应链信任面被无声地扩大了一圈。
 *
 * 为什么必须是**机器**复查而不是散文声明：这一行位于 `src-tauri/gen/` 下——它是
 * `tauri android init` 的生成物目录，任何一次重新生成 / 从模板复制 / "顺手改回国内源提速"
 * 都能把它悄悄换回镜像，而**整套门禁没有任何一项会因此变红**：
 * TypeScript 不解析 properties，ESLint 只扫 `src/`，vitest 的其它用例不读它，
 * cargo/clippy 不碰 gradle，甚至 Android 构建本身在镜像可用时也照样绿。
 * 也就是说，回退到镜像的**唯一**可观测后果是"没人发现"。本测试就是那个观测点。
 * （同套路：animation-conflict / css-encoding / secure-display-routing /
 * huanvaeguard-port-resolution；静态扫描读文件用 `__dirname`，见 .claude/rules/frontend-test.md）
 *
 * ## 口径：禁的是「把镜像域名当**真值**用」，不是「禁止该字符串出现」
 *
 * 判定一律在**剥掉注释之后的代码行**上做（Java properties 的注释 = 整行 trim 后以 `#` 或 `!` 开头）。
 * 这样一条正当的历史说明注释（例如 `# 2026-08-13: 由 mirrors.cloud.tencent.com 改回上游`）
 * 不会被判违规——否则这条测试会逼着后来的人**删掉正确的文档**才能过门禁。
 * 对齐 .claude/rules/frontend-test.md 「不变量口径写"禁裸写死"，不是"禁出现该数字"；
 * 且要在【剥掉注释的代码】上判」。
 *
 * ## 本测试**防不住**什么（写清楚，别让读者以为它是全覆盖）
 *
 * - 防不住 denylist 之外的新镜像域名（它是黑名单 + 一条"必须等于上游"的白名单双保险；
 *   真正兜底的是白名单那条 —— 换成任何非 services.gradle.org 的 host 都会红）。
 * - 防不住**运行期**被 `-Dgradle.wrapperUrl` / `GRADLE_OPTS` / CI 环境变量覆盖（那不在源码面）。
 * - 不校验发行版内容完整性（本仓未设 `distributionSha256Sum`；那是另一条独立的加固项）。
 * - 不锁 Gradle 版本号——版本升级是正当改动，锁死会把升级变成"必须先改测试"。
 */

/* eslint-disable no-undef */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';

const PROJECT_ROOT = resolve(__dirname, '..');
/* eslint-enable no-undef */

/** 上游发行版分发站（Gradle 官方）。 */
const UPSTREAM_HOST = 'services.gradle.org';

/**
 * 已知镜像 / 加速站标记。命中任意一条即视为"构建期依赖源被指向第三方"。
 *
 * 注意这只是**黑名单侧**的早期告警（能给出比"host 不等于上游"更具体的报错文案）；
 * 真正的兜底是下面 `distributionUrl` 必须等于 `UPSTREAM_HOST` 那条白名单断言。
 */
const MIRROR_MARKERS: { label: string; re: RegExp }[] = [
  { label: '腾讯云镜像', re: /mirrors\.cloud\.tencent\.com/i },
  { label: '阿里云镜像', re: /aliyun/i },
  { label: '华为云镜像', re: /huaweicloud/i },
  { label: 'npmmirror', re: /npmmirror/i },
  { label: 'gh-proxy 加速', re: /gh-?proxy/i },
  // 通用 `mirrors.<something>` 主机名形态（腾讯之外的其它 mirrors.* 站点）
  { label: 'mirrors.* 主机', re: /(^|[/@.])mirrors\.[a-z0-9-]/i },
];

/**
 * 剥掉 Java properties 的注释行。
 *
 * Java properties 规范：整行（去掉前导空白后）以 `#` 或 `!` 开头即注释。
 * properties **没有**行尾注释语法，所以不需要（也不能）做"行中间截断"——
 * 那会把 URL 里的 `#`（若有）误当注释起点。
 */
function stripPropertiesComments(src: string): string {
  return src
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return !(trimmed.startsWith('#') || trimmed.startsWith('!'));
    })
    .join('\n');
}

/** 递归找出目录下所有 gradle-wrapper.properties（相对仓库根的 posix 风格路径）。 */
function findWrapperProps(dirAbs: string): string[] {
  const found: string[] = [];
  const walk = (cur: string): void => {
    for (const name of readdirSync(cur)) {
      const abs = join(cur, name);
      const st = statSync(abs);
      if (st.isDirectory()) {
        walk(abs);
      } else if (name === 'gradle-wrapper.properties') {
        found.push(relative(PROJECT_ROOT, abs).split(sep).join('/'));
      }
    }
  };
  walk(dirAbs);
  return found.sort();
}

/** 已知的那一份（同时用作"扫描器没扫空"的正对照锚点）。 */
const KNOWN_WRAPPER = 'src-tauri/gen/android/gradle/wrapper/gradle-wrapper.properties';

const WRAPPER_FILES = findWrapperProps(resolve(PROJECT_ROOT, 'src-tauri/gen/android'));

describe('Gradle wrapper 发行版源必须是上游（防回退到镜像）', () => {
  it('扫描器至少扫到已知的那一份 wrapper（防止 glob 扫空 → 下面的 it.each 空转假通过）', () => {
    expect(WRAPPER_FILES.length).toBeGreaterThan(0);
    expect(WRAPPER_FILES).toContain(KNOWN_WRAPPER);
  });

  it.each(WRAPPER_FILES)('%s：distributionUrl 保留 `https\\://` 转义形式', (rel) => {
    const code = stripPropertiesComments(readFileSync(resolve(PROJECT_ROOT, rel), 'utf-8'));

    // properties 里冒号是分隔符，必须反斜杠转义；写成裸 `https://` 会让解析把 `https` 当 key，
    // 于是 distributionUrl 变成"未设置"——wrapper 会用它自己的默认值，静默偏离本文件的声明。
    expect(code).toMatch(/^distributionUrl=https\\:\/\//m);
    expect(code).not.toMatch(/^distributionUrl=https:\/\//m);
  });

  it.each(WRAPPER_FILES)('%s：distributionUrl 指向上游 services.gradle.org', (rel) => {
    const code = stripPropertiesComments(readFileSync(resolve(PROJECT_ROOT, rel), 'utf-8'));

    const values = (code.match(/^distributionUrl=.*$/gm) ?? []).map((line) =>
      line.replace(/^distributionUrl=/, ''),
    );
    // 恰好一条：多条会让 properties 后者覆盖前者，"我改的那条"未必是生效的那条
    expect(values).toHaveLength(1);

    // 反转义（`\:` → `:`）后按真实 URL 解析 host，避免"字符串里出现上游域名"式的假通过
    // （例如 `https://evil.example.com/?u=services.gradle.org` 含上游域名却并不指向它）。
    // 用 join('') 而不是 values[0]：上面已断言长度为 1，join 等价取首元素，
    // 但返回类型是 string 而非 string|undefined —— 免掉一个永不执行的 undefined 兜底分支。
    const url = new URL(values.join('').replace(/\\:/g, ':'));

    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe(UPSTREAM_HOST);
    expect(url.pathname.startsWith('/distributions/')).toBe(true);
  });

  it.each(WRAPPER_FILES)('%s：代码行不含任何已知镜像 / 加速站（注释里写历史说明不算）', (rel) => {
    const code = stripPropertiesComments(readFileSync(resolve(PROJECT_ROOT, rel), 'utf-8'));

    const hits = MIRROR_MARKERS.filter((m) => m.re.test(code)).map((m) => m.label);
    expect(hits).toEqual([]);
  });
});
