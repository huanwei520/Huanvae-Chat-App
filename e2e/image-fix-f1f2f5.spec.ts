/**
 * 图片修复 F1/F2/F5 截图工件 spec（image-fix-f1f2f5）
 *
 * 本文件只产出**验证工件**（截图 + console/调用序证据），不改任何业务代码。
 * 前驱块（均已 PASS）：
 *   - 1788312588493-1-img-fix-f1f2：F1 过期重取链 + F2 presign 取得后即 kick（services/fileCache.ts、hooks/useFileCache.ts）
 *   - 1788312588493-2-img-fix-f5：F5 诚实报错（services/secureProxy.ts proxyRequestUrl 不退化直连）
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 手法（为什么能在 web e2e 里跑到图片链）
 *
 * 1. 复用仓内 tauri-mock（e2e/helpers/tauri-mock.ts，经 test-fixtures 自动注入）。
 *    本 spec 在其后再 addInitScript 一层**补丁**：包一层 __TAURI_INTERNALS__.invoke，
 *    只覆写三个命令：
 *      - download_and_save_file → 按脚本首次抛 HV_URL_EXPIRED / 二次成功（F1 链的燃料）；
 *      - secure_http 中 path 含 /presigned_url 的请求 → 返回受控 presigned_url 序列
 *        （信封与 ApiClient 解包契约一致：{data:{presigned_url,...}}，见 src/api/client.ts request()）；
 *      - ensure_secure_proxy → 返回非 0 端口（场景 A/B），让真实 resolveDisplayUrl 走
 *        回环反代改写分支（`http://127.0.0.1:<port>/<path+query>`）——改写本身是被测代码，
 *        图片字节由 page.route 在回环端口上供给。
 *    其余全部 delegate 回 tauri-mock。所有覆写事件记进 window.__E2E_IMGFIX__.timeline
 *    （单调 step + 时间戳），供「调用序」断言。
 *
 * 2. 真组件挂载：App 自身样式全量在入场加载（App.tsx 静态 import styles/index.css），
 *    页面内 dynamic import vite dev 的真实模块（react / react-dom / SessionContext /
 *    FileMessageContent —— 与 App 同一份模块实例），把**真的** FileMessageContent
 *    （内含真的 useImageCache → getFileSource → presign → kick 下载 → resolveDisplayUrl）
 *    挂进真实 SessionProvider。没有任何逻辑被重写——被驱动的就是前驱块修的那条链。
 *
 * 3. 断言口径（不 截图断言，全部真实证据）：
 *    - A：presign HTTP 调用 ×2（body 逐字节 `{"operation":"preview"}`）+ 下载命令 ×2
 *      （sig v1 → HV_URL_EXPIRED → sig v2）+ store 任务 completed + console 出现
 *      「下载 URL 过期，重取 presigned URL」「后台下载完成」。截图=图片气泡正常渲染态。
 *    - B：timeline 调用序 download-invoke 先于 img-load（图片字节故意延迟 1.5s 才供给，
 *      onLoad 未发生时下载命令已发出），且 img load 后不重复下载（onLoad 去重）。
 *      截图=图片消息正常态。
 *    - C：真实 proxyRequestUrl 在反代端口 0 时等待 PROXY_READY_TIMEOUT_MS 后抛出
 *      「secure proxy not ready: port=0 … refusing insecure direct fallback」——明确语义、
 *      非伪装随机网络错。截图=错误态卡片 + console 转录工件。
 *
 * 降级声明（不伪造）：C 的「等待窗口内就绪→正常代理」半边在 web e2e 无法模拟（需要
 * 真 Rust 反代进程），该半边由 tests/services/secureProxy.test.ts 单测覆盖；本 spec C
 * 只覆盖 F5 的错误分支——即修复本身。
 */

import type { Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import * as crypto from 'node:crypto';
import { test, expect } from './helpers/test-fixtures';

// ─────────────────────────────────────────────────────────────────────────────
// 工件落盘目录（未跟踪）：test-artifacts/raw/imgfix-artifacts/
// ─────────────────────────────────────────────────────────────────────────────

const ARTIFACT_DIR = path.resolve(process.cwd(), 'test-artifacts', 'raw', 'imgfix-artifacts');

/** tauri-mock 假后端保留域（RFC 5737 / .test TLD，绝不会打到真实主机） */
const MOCK_SERVER_URL = 'https://e2e-backend.huanvae.test';
/** 覆写 ensure_secure_proxy 返回的回环反代端口（仅场景 A/B） */
const MOCK_PROXY_PORT = 47477;

/** F1 场景的受控 presigned URL 序列：v1 = 首次签发（将过期），v2 = 重签 */
const UUID_A = 'f1000000-1111-2222-3333-444455556666';
const PRESIGN_A = [
  `${MOCK_SERVER_URL}/friends-file/obj-a?X-Amz-Signature=v1&X-Amz-Expires=900`,
  `${MOCK_SERVER_URL}/friends-file/obj-a?X-Amz-Signature=v2&X-Amz-Expires=900`,
];
/** B 场景单张：一次签发、一次成功下载 */
const UUID_B = 'f2000000-1111-2222-3333-444455556666';
const PRESIGN_B = [`${MOCK_SERVER_URL}/friends-file/obj-b?X-Amz-Signature=v1&X-Amz-Expires=900`];

/** tauri-mock unified_download.rs 的 HV_URL_EXPIRED Display 真实形态（对齐单测样本） */
const HV_URL_EXPIRED_MSG =
  'HV_URL_EXPIRED: 范围探测: HTTP 403（预签名 URL 已过期或失效，重取 URL 后可从断点续传）';

// ─────────────────────────────────────────────────────────────────────────────
// 确定性非均匀测试图（纯 node:zlib 手工 PNG，无外部依赖/无凭据）
// ─────────────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) { c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) { c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** 渐变 + 色块 + 网格线的非均匀图：截到它 = 图片真的解码渲染了（非空判据的素材面） */
function makeTestPng(w: number, h: number): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const i = row + 1 + x * 4;
      const t = y / h;
      raw[i] = Math.round(30 + 90 * t);
      raw[i + 1] = Math.round(90 + 120 * (x / w));
      raw[i + 2] = Math.round(160 - 60 * t);
      raw[i + 3] = 255;
      if (x % 60 < 2 || y % 45 < 2) { raw[i] = 255; raw[i + 1] = 255; raw[i + 2] = 255; }
      if (x >= 40 && x < 90 && y >= 30 && y < 90) { raw[i] = 230; raw[i + 1] = 60; raw[i + 2] = 50; }
      if (x >= 110 && x < 160 && y >= 30 && y < 90) { raw[i] = 250; raw[i + 1] = 200; raw[i + 2] = 40; }
      if (x >= 180 && x < 230 && y >= 30 && y < 90) { raw[i] = 60; raw[i + 1] = 170; raw[i + 2] = 80; }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const TEST_PNG_A = makeTestPng(640, 360);
const TEST_PNG_B = makeTestPng(640, 360);

// ─────────────────────────────────────────────────────────────────────────────
// invoke 补丁（在 tauri-mock 之后 addInitScript；只覆写三处，其余 delegate）
// ─────────────────────────────────────────────────────────────────────────────

interface ImgFixPatchConfig {
  fileUuid: string;
  /** 依序发放的 presigned_url（超出后重复最后一个） */
  presignUrls: string[];
  /** 'expire-then-success'：首次下载抛 HV_URL_EXPIRED、其后成功；'always-success'：恒成功 */
  downloadScript: 'expire-then-success' | 'always-success';
  /** 覆写 ensure_secure_proxy 的返回值（0 = 不覆写，走 tauri-mock 默认） */
  proxyPort: number;
  /** 成功下载返回的本地路径 */
  successLocalPath: string;
}

const PATCH_SCRIPT_SOURCE = `
  (cfg) => {
    const tl = [];
    let step = 0;
    const rec = (kind, detail) => {
      step += 1;
      tl.push({ step, kind, t: Date.now(), detail: detail ?? null });
    };
    window.__E2E_IMGFIX__ = { timeline: tl, cfg: cfg };
    rec('patch-installed', { downloadScript: cfg.downloadScript, proxyPort: cfg.proxyPort });

    const originalInvoke = window.__TAURI_INTERNALS__.invoke;
    let downloadCalls = 0;
    let presignIdx = 0;

    window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
      if (cmd === 'download_and_save_file') {
        downloadCalls += 1;
        rec('download-invoke', { n: downloadCalls, url: (args && args.url) ?? null, cacheKey: (args && args.cacheKey) ?? null });
        if (cfg.downloadScript === 'expire-then-success' && downloadCalls === 1) {
          throw new Error(${JSON.stringify(HV_URL_EXPIRED_MSG)});
        }
        return cfg.successLocalPath;
      }
      if (cmd === 'secure_http') {
        const req = (args && args.req) || {};
        if (typeof req.url === 'string' && req.url.includes('/presigned_url')) {
          rec('presign-http', { url: req.url, body: req.body ?? null });
          const url = cfg.presignUrls[Math.min(presignIdx, cfg.presignUrls.length - 1)];
          presignIdx += 1;
          return {
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ data: {
              presigned_url: url,
              expires_at: '2099-01-01T00:00:00Z',
              file_uuid: cfg.fileUuid,
              file_size: 1024,
              content_type: 'image/png',
            } }),
          };
        }
      }
      if (cmd === 'ensure_secure_proxy' && cfg.proxyPort > 0) {
        rec('ensure-secure-proxy', { port: cfg.proxyPort });
        return cfg.proxyPort;
      }
      return originalInvoke(cmd, args);
    };

    // img 生命周期记录：捕获阶段监听（load 不冒泡，capture 能收到）
    document.addEventListener('load', (ev) => {
      const el = ev.target;
      if (el && el.tagName === 'IMG' && el.classList && el.classList.contains('message-image')) {
        rec('img-load', { src: String(el.currentSrc || el.src).slice(0, 160), naturalWidth: el.naturalWidth });
      }
    }, true);
    document.addEventListener('error', (ev) => {
      const el = ev.target;
      if (el && el.tagName === 'IMG' && el.classList && el.classList.contains('message-image')) {
        rec('img-error', { src: String(el.currentSrc || el.src).slice(0, 160) });
      }
    }, true);
    // 🔴 init script 在 document-start 运行时 documentElement 尚不存在（Chromium 实测抛
    //    "parameter 1 is not of type 'Node'"），必须等 DOM 就绪后再 observe。
    const attachObserver = () => {
      new MutationObserver((muts) => {
        for (const m of muts) {
          for (const node of m.addedNodes) {
            if (node.nodeType === 1 && node.tagName === 'IMG' && node.classList && node.classList.contains('message-image')) {
              rec('img-added', { src: String(node.src).slice(0, 160) });
            }
          }
        }
      }).observe(document.documentElement, { childList: true, subtree: true });
    };
    if (document.documentElement) { attachObserver(); } else { document.addEventListener('DOMContentLoaded', attachObserver, { once: true }); }
  }
`;

async function installImgFixPatch(page: Page, cfg: ImgFixPatchConfig): Promise<void> {
  // addInitScript 不支持「字符串脚本 + arg」（Cannot evaluate a string with arguments），
  // 故把配置作为 JSON 字面量内联进脚本，自执行。
  await page.addInitScript(`(${PATCH_SCRIPT_SOURCE})(${JSON.stringify(cfg)});`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 真组件挂载（dynamic import vite dev 的真实模块 —— 与 App 同一份模块实例）
// ─────────────────────────────────────────────────────────────────────────────

interface HarnessCfg {
  fileUuid: string;
  filename: string;
  fileSize: number;
  urlType: 'user' | 'friend' | 'group';
  title: string;
}

const MOUNT_HARNESS_SOURCE = `
  async (cfg) => {
    // 1) 从已转译的模块源码里发现 vite 预打包依赖的真实 URL（react / react-dom client）
    const scSource = await (await fetch('/src/contexts/SessionContext.tsx')).text();
    const reactUrl = (scSource.match(/from\\s*"([^"]*\\/node_modules\\/.vite\\/deps\\/react\\.js[^"]*)"/) || [])[1];
    const mainSource = await (await fetch('/src/main.tsx')).text();
    const domUrl = (mainSource.match(/from\\s*"([^"]*react-dom_client[^"]*)"/) || [])[1];
    if (!reactUrl || !domUrl) {
      throw new Error('module discovery failed: reactUrl=' + reactUrl + ' domUrl=' + domUrl);
    }
    // vite 预打包的 react / react-dom/client 都是 CJS interop：真身在 default 上
    const unwrap = (ns) => (ns && ns.default && typeof ns.default === 'object' ? ns.default : ns);
    const React = unwrap(await import(reactUrl));
    const ReactDOM = unwrap(await import(domUrl));
    if (typeof React.createElement !== 'function' || typeof ReactDOM.createRoot !== 'function') {
      throw new Error('react module unwrap failed: createElement=' + typeof React.createElement +
        ' createRoot=' + typeof ReactDOM.createRoot);
    }
    const { SessionProvider, useSession } = await import('/src/contexts/SessionContext.tsx');
    const { FileMessageContent } = await import('/src/chat/shared/FileMessageContent.tsx');

    // 2) 种会话：走真的 restoreSession（不持久化），useApi 由此可用（真实 ApiClient）
    function Gate({ children }) {
      const s = useSession();
      React.useEffect(() => {
        if (!s.isLoggedIn) {
          s.restoreSession({
            serverUrl: ${JSON.stringify(MOCK_SERVER_URL)},
            userId: 'e2euser',
            accessToken: 'e2e-imgfix-access-token',
            refreshToken: 'e2e-imgfix-refresh-token',
            avatarPath: null,
            profile: {
              user_id: 'e2euser',
              user_nickname: 'E2E 用户',
              user_email: null,
              user_signature: null,
              user_avatar_url: null,
              admin: 'false',
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-01T00:00:00Z',
            },
          });
        }
      }, []);
      if (!s.isLoggedIn) { return null; }
      return children;
    }

    // 3) 宿主 DOM：覆盖层 + 注解标题 + 真实气泡壳（message-row/message-bubble/bubble-content
    //    与 src/chat/friend/MessageBubble.tsx 同名同类）
    const host = document.createElement('div');
    host.id = 'imgfix-harness';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#e9edf3;overflow:auto;font-family:system-ui,sans-serif;';
    host.innerHTML =
      '<div style="max-width:760px;margin:28px auto 40px;">' +
        '<div id="imgfix-caption" style="background:#1f2937;color:#f9fafb;border-radius:10px 10px 0 0;padding:10px 16px;font-size:13px;line-height:1.6;"></div>' +
        '<div id="imgfix-chat" style="background:#f7f8fa;border:1px solid #d7dce3;border-top:none;padding:20px 16px 8px;"></div>' +
        '<pre id="imgfix-evidence" style="background:#0f172a;color:#86efac;border:1px solid #d7dce3;border-top:none;border-radius:0 0 10px 10px;padding:12px 16px;font-size:12px;line-height:1.7;white-space:pre-wrap;margin:0;"></pre>' +
      '</div>';
    document.body.appendChild(host);
    host.querySelector('#imgfix-caption').textContent = cfg.title;

    const row = document.createElement('div');
    row.className = 'message-row other';
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble other';
    const content = document.createElement('div');
    content.className = 'bubble-content';
    const mountPoint = document.createElement('div');
    mountPoint.id = 'imgfix-mount';
    content.appendChild(mountPoint);
    bubble.appendChild(content);
    row.appendChild(bubble);
    host.querySelector('#imgfix-chat').appendChild(row);

    // 4) 挂真组件：真的 FileMessageContent（内部真的 useImageCache → presign → kick 下载）
    ReactDOM.createRoot(mountPoint).render(
      React.createElement(SessionProvider, null,
        React.createElement(Gate, null,
          React.createElement(FileMessageContent, {
            messageUuid: 'imgfix-msg-' + cfg.fileUuid.slice(0, 8),
            messageType: 'image',
            messageContent: cfg.filename,
            fileUuid: cfg.fileUuid,
            fileSize: cfg.fileSize,
            urlType: cfg.urlType,
          }),
        ),
      ),
    );
    return { mounted: true };
  }
`;

async function mountImageBubbleHarness(page: Page, cfg: HarnessCfg): Promise<void> {
  // 字符串源必须以 IIFE 表达式形式喂给 evaluate：裸函数表达式会被当成「表达式」求值，
  // 返回的是函数对象（序列化成 undefined）而不是调用它。
  const r = await page.evaluate(`(${MOUNT_HARNESS_SOURCE})(${JSON.stringify(cfg)});`);
  expect(r).toMatchObject({ mounted: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// 小工具
// ─────────────────────────────────────────────────────────────────────────────

type Timeline = Array<{ step: number; kind: string; t: number; detail: Record<string, unknown> | null }>;

/** timeline 事件的 detail 安全取值（补丁侧可能记 null） */
function detailOf(e: Timeline[number]): Record<string, unknown> {
  return (e.detail ?? {}) as Record<string, unknown>;
}

function readTimeline(page: Page): Promise<Timeline> {
  return page.evaluate(() => (window as unknown as { __E2E_IMGFIX__: { timeline: Timeline } }).__E2E_IMGFIX__.timeline);
}

function readDownloadTask(page: Page, uuid: string): Promise<Record<string, unknown> | undefined> {
  return page.evaluate(async (u) => {
    // 非字面量 specifier：页面内动态 import vite dev 的真实模块（与 App 同一模块实例）
    const storePath = '/src/stores/fileCacheStore.ts';
    const mod = (await import(storePath)) as {
      useFileCacheStore: { getState(): { downloadTasks: Record<string, Record<string, unknown> | undefined> } };
    };
    return mod.useFileCacheStore.getState().downloadTasks[u];
  }, uuid);
}

/** 图片真的解码完成（naturalWidth>0）＝气泡里是渲染出来的图，不是占位/裂图 */
async function waitImageDecoded(page: Page, timeout = 30_000): Promise<number> {
  let last = 0;
  await expect.poll(async () => {
    last = await page.evaluate(() => {
      const img = (document.querySelector('#imgfix-mount img.message-image') ||
        document.querySelector('.file-message img.message-image')) as HTMLImageElement | null;
      return img ? img.naturalWidth : 0;
    });
    return last;
  }, { timeout }).toBeGreaterThan(0);
  return last;
}

/** 失败/成功都落一份页面态诊断（host 在不在、气泡 DOM、时间线）——失败也不留黑箱 */
async function dumpDiagnostics(page: Page, name: string): Promise<void> {
  const state = await page.evaluate(() => ({
    url: window.location.href,
    hostPresent: !!document.getElementById('imgfix-harness'),
    mountHTML: (document.querySelector('#imgfix-mount') || { innerHTML: '(mount 不在)' }).innerHTML.slice(0, 1200),
    timeline: ((window as unknown as { __E2E_IMGFIX__?: { timeline: Timeline } }).__E2E_IMGFIX__ || { timeline: [] }).timeline,
  })).catch((e) => ({ evaluateError: String(e) }));
  fs.writeFileSync(path.join(ARTIFACT_DIR, name), JSON.stringify(state, null, 2));
}

/** 截图落盘 + 非空判据（rust-dev.md「截图有内容」精神：大小阈值 + md5 去重素材） */
async function screenshotArtifact(page: Page, name: string, md5s: Map<string, string>): Promise<string> {
  const p = path.join(ARTIFACT_DIR, name);
  await page.screenshot({ path: p, fullPage: false });
  const size = fs.statSync(p).size;
  expect(size).toBeGreaterThan(15_000); // 1280x720 整页：均匀纯色页 ≈10KB 内，带内容页远超此值
  const md5 = crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
  md5s.set(name, `${md5}  ${size}B`);
  return p;
}

/** 把 Node 侧捕获的 console/页面异常转录进工件（含场景断言所需的原始行） */
function writeTranscript(name: string, lines: string[]): string {
  const p = path.join(ARTIFACT_DIR, name);
  fs.writeFileSync(p, lines.join('\n'), 'utf8');
  return p;
}

test.describe('图片修复 F1/F2/F5 截图工件（只产工件，不改业务代码）', () => {
  // 串行 + 最长的 B 放最后：并行 worker 各自结束时 HTML reporter 会写 playwright-report/，
  // 它在 vite dev 的 watch 根内 ⇒ 触发 "page reload" ⇒ 在飞的页面被整页重载（run7 实测
  // 打断 B 的收尾断言）。串行化后，B 运行期间没有其他测试结束，报告写入都落在测试间隙。
  test.describe.configure({ mode: 'serial' });

  test('A：F1 下载 URL 过期 → 重签 → 续传成功（截图=图片气泡正常渲染态）', async ({ page }) => {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    const md5s = new Map<string, string>();
    const logs: string[] = [];
    page.on('console', (m) => logs.push(`[console.${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

    // 回环反代端口上的图片字节（真实 resolveDisplayUrl 改写出的 URL 形态）
    await page.route(`http://127.0.0.1:${MOCK_PROXY_PORT}/**`, (route) => route.fulfill({
      status: 200, contentType: 'image/png', body: TEST_PNG_A,
    }));
    await installImgFixPatch(page, {
      fileUuid: UUID_A,
      presignUrls: PRESIGN_A,
      downloadScript: 'expire-then-success',
      proxyPort: MOCK_PROXY_PORT,
      successLocalPath: '/data/e2euser_e2e-backend.huanvae.test/file/pictures/f1e2e75_pic.png',
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#user-id')).toBeVisible(); // tauri-mock 注入完好、登录页就绪

    await mountImageBubbleHarness(page, {
      fileUuid: UUID_A,
      filename: 'f1-expired-refetch.png',
      fileSize: 1024,
      urlType: 'friend',
      title: '【e2e 工件 · 场景 A】F1 过期重取链：首次下载 HV_URL_EXPIRED(403) → 重签 presign → 新 URL 续传成功 — 图片气泡正常渲染态（下方绿色面板为真实事件时间线）',
    });

    try {

      // 等 F1 链跑完：两次下载调用 + store 任务 completed
      await expect.poll(async () => {
        const tl = await readTimeline(page);
        return tl.filter((e) => e.kind === 'download-invoke').length;
      }, { timeout: 30_000 }).toBe(2);

      const task = await readDownloadTask(page, UUID_A);
      expect(task && task.status).toBe('completed');
      expect(task && task.localPath).toBe('/data/e2euser_e2e-backend.huanvae.test/file/pictures/f1e2e75_pic.png');

      // 调用序与形态断言：presign ×2（body 逐字节 {operation:'preview'}）+ 下载 sig v1 → v2
      const tl = await readTimeline(page);
      const presigns = tl.filter((e) => e.kind === 'presign-http');
      expect(presigns).toHaveLength(2);
      for (const p of presigns) {
        expect(String(detailOf(p).url)).toContain(`/api/storage/friends_file/${UUID_A}/presigned_url`);
        expect(detailOf(p).body).toBe('{"operation":"preview"}'); // 逐字节
      }
      const downloads = tl.filter((e) => e.kind === 'download-invoke');
      expect(String(detailOf(downloads[0]).url)).toBe(PRESIGN_A[0]);
      expect(String(detailOf(downloads[1]).url)).toBe(PRESIGN_A[1]); // 重签后的新 URL 重调 = 续传
      expect(downloads[1].step).toBeGreaterThan(presigns[1].step); // 新 URL 来自第二次 presign

      // 图片真的解码渲染；渲染证据先行落盘（即使后续任何断言翻车，工件已在盘）
      await waitImageDecoded(page);
      expect(tl.filter((e) => e.kind === 'img-error')).toHaveLength(0);
      await screenshotArtifact(page, 'imgfix-A-raw-render.png', md5s);

      // console 链证据：过期重取 warn + 下载完成 log（含 urlExpiredRefetches 计数）
      const joined = logs.join('\n');
      expect(joined).toContain('下载 URL 过期，重取 presigned URL（第 1/2 次）');
      expect(joined).toContain('后台下载完成');
      expect(joined).toContain('urlExpiredRefetches: 1');

      // 把真实事件时间线写进工件页面（自描述截图），再截图
      const evidence = [
        `presign#1  → ${PRESIGN_A[0]}`,
        `download#1 → HV_URL_EXPIRED (mock 引擎形态: ${HV_URL_EXPIRED_MSG.slice(0, 46)}…)`,
        'console    → [FileCache] 下载 URL 过期，重取 presigned URL（第 1/2 次）',
        `presign#2  → ${PRESIGN_A[1]}   body={"operation":"preview"}`,
        'download#2 → OK → /data/e2euser_e2e-backend.huanvae.test/file/pictures/f1e2e75_pic.png',
        `store      → downloadTasks[${UUID_A.slice(0, 8)}…].status = completed`,
      ].join('\n');
      await page.evaluate((txt) => {
        (document.querySelector('#imgfix-evidence') as HTMLElement).textContent = txt;
      }, evidence);
      await page.waitForTimeout(250);

      await screenshotArtifact(page, 'imgfix-A-f1-expired-refetch-bubble.png', md5s);
    } finally {
      // 失败/成功都落诊断与转录：失败也不留黑箱
      await dumpDiagnostics(page, 'imgfix-A-diagnostics.json');
      writeTranscript('imgfix-A-console.txt', logs);
      const tlDump = await readTimeline(page).catch(() => []);
      fs.writeFileSync(path.join(ARTIFACT_DIR, 'imgfix-A-timeline.json'), JSON.stringify(tlDump, null, 2));
    }
  });

  test('B：F2 presign 取得后即 kick 后台下载，不等 img onLoad（调用序断言，截图=图片消息正常态）', async ({ page }) => {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    const md5s = new Map<string, string>();
    const logs: string[] = [];
    page.on('console', (m) => logs.push(`[console.${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

    // 图片字节故意延迟 1.5s 才供给：若下载仍等 onLoad，download-invoke 只可能晚于 img-load
    await page.route(`http://127.0.0.1:${MOCK_PROXY_PORT}/**`, async (route) => {
      await new Promise((r) => { setTimeout(r, 1500); });
      await route.fulfill({ status: 200, contentType: 'image/png', body: TEST_PNG_B });
    });
    await installImgFixPatch(page, {
      fileUuid: UUID_B,
      presignUrls: PRESIGN_B,
      downloadScript: 'always-success',
      proxyPort: MOCK_PROXY_PORT,
      successLocalPath: '/data/e2euser_e2e-backend.huanvae.test/file/pictures/f2kick_pic.png',
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#user-id')).toBeVisible();

    await mountImageBubbleHarness(page, {
      fileUuid: UUID_B,
      filename: 'f2-presign-kick.png',
      fileSize: 1024,
      urlType: 'friend',
      title: '【e2e 工件 · 场景 B】F2 触发时点：presign 取得后立即 kick 后台下载（不等 img onLoad）— 图片消息正常态（下方为调用序：下载命令先于图片 load 事件 1.5s+）',
    });

    try {

      // 下载命令已发出（此时图片字节还压在 route 延迟里）
      await expect.poll(async () => {
        const tl = await readTimeline(page);
        return tl.some((e) => e.kind === 'download-invoke');
      }, { timeout: 30_000 }).toBe(true);

      // 图片最终渲染完成（onLoad 发生）
      await waitImageDecoded(page);
      const tl = await readTimeline(page);
      const download = tl.find((e) => e.kind === 'download-invoke');
      const imgLoad = tl.find((e) => e.kind === 'img-load');
      const imgAdded = tl.find((e) => e.kind === 'img-added');
      const presign = tl.find((e) => e.kind === 'presign-http');
      if (!download || !imgLoad || !presign) {
        throw new Error(`B：timeline 缺关键事件 download/imgLoad/presign：${JSON.stringify(tl)}`);
      }
      expect(Number(detailOf(imgLoad).naturalWidth)).toBeGreaterThan(0);

      // 渲染证据先行落盘
      await screenshotArtifact(page, 'imgfix-B-raw-render.png', md5s);

      // 核心调用序断言：下载命令先于 img load 事件 ≥1s（证明独立于渲染回调）
      expect(download.step).toBeLessThan(imgLoad.step);
      expect(imgLoad.t - download.t).toBeGreaterThanOrEqual(1000);
      // kick 在拿到 presign 的那一刻已发出：presign → download，与 img DOM 无先后耦合
      expect(presign.step).toBeLessThan(download.step);
      if (imgAdded) {
      // 图片元素入 DOM 也不先于 presign（整条链由 presign 驱动，而非渲染回调驱动）
        expect(presign.step).toBeLessThan(imgAdded.step);
      }

      // onLoad 之后再无第二次下载（去重）：任务 completed 且下载调用恰 1 次
      await page.waitForTimeout(400); // 给 onLoad→cacheFile 的可能误 kick 留窗口
      const task = await readDownloadTask(page, UUID_B);
      expect(task && task.status).toBe('completed');
      const tlAfterLoad = await readTimeline(page);
      expect(tlAfterLoad.filter((e) => e.kind === 'download-invoke')).toHaveLength(1);

      const evidence = [
        `presign#1      → step ${presign.step}`,
        `download#1     → step ${download.step}  (t=${download.t})`,
        `img DOM added  → step ${imgAdded ? imgAdded.step : '(未记录)'}`,
        `img load 事件  → step ${imgLoad.step}  (t=${imgLoad.t}，晚于下载命令 ${imgLoad.t - download.t}ms)`,
        'onLoad 后再 kick？ → 无（download-invoke 共 1 次，downloadTriggeredRef/在飞占位去重）',
      ].join('\n');
      await page.evaluate((txt) => {
        (document.querySelector('#imgfix-evidence') as HTMLElement).textContent = txt;
      }, evidence);
      await page.waitForTimeout(250);

      await screenshotArtifact(page, 'imgfix-B-f2-presign-kick-normal.png', md5s);
    } finally {
      // 失败/成功都落诊断与转录：失败也不留黑箱
      await dumpDiagnostics(page, 'imgfix-B-diagnostics.json');
      writeTranscript('imgfix-B-console.txt', logs);
      const tlDump = await readTimeline(page).catch(() => []);
      fs.writeFileSync(path.join(ARTIFACT_DIR, 'imgfix-B-timeline.json'), JSON.stringify(tlDump, null, 2));
    }
  });

  test('C：F5 反代未就绪超时 → 诚实明确报错，非伪装随机网络错（截图=错误态 + console 工件）', async ({ page }) => {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    const md5s = new Map<string, string>();
    const logs: string[] = [];
    page.on('console', (m) => logs.push(`[console.${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

    // 不覆写 ensure_secure_proxy：tauri-mock 默认返回 0（= 反代未就绪，F5 的触发态）
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#user-id')).toBeVisible();

    const PROBE_URL = `${MOCK_SERVER_URL}/api/storage/file/f5probe/probe.bin`;
    const result = await page.evaluate(async (probeUrl) => {
      // 非字面量 specifier：页面内动态 import vite dev 的真实模块（与 App 同一模块实例）
      const proxyModPath = '/src/services/secureProxy.ts';
      const proxyMod = (await import(proxyModPath)) as {
        proxyRequestUrl: (u: string) => Promise<string>;
        proxyPort: () => number;
        PROXY_READY_TIMEOUT_MS: number;
      };
      const { proxyRequestUrl, proxyPort, PROXY_READY_TIMEOUT_MS } = proxyMod;
      const portBefore = proxyPort();

      // 宿主 DOM：错误态卡片（与 A/B 同一工件版式）
      const host = document.createElement('div');
      host.id = 'imgfix-harness';
      host.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#e9edf3;overflow:auto;font-family:system-ui,sans-serif;';
      host.innerHTML =
        '<div style="max-width:760px;margin:28px auto 40px;">' +
          '<div style="background:#7f1d1d;color:#fee2e2;border-radius:10px 10px 0 0;padding:10px 16px;font-size:13px;line-height:1.6;">' +
            '【e2e 工件 · 场景 C】F5 诚实报错：反代未就绪（ensure_secure_proxy → 端口 0），proxyRequestUrl 等待超时后抛明确语义错误，拒绝退化直连源站（不伪装成随机网络错误）' +
          '</div>' +
          '<div id="imgfix-error-card" style="background:#fff;border:1px solid #d7dce3;border-top:none;padding:20px 16px;">' +
            '<div style="font-weight:700;color:#7f1d1d;font-size:15px;margin-bottom:10px;">⛔ secure proxy not ready（真实抛出的错误原文）</div>' +
            '<pre id="imgfix-error-msg" style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;font-size:12px;line-height:1.7;white-space:pre-wrap;color:#7f1d1d;">等待真实 proxyRequestUrl 抛错…</pre>' +
          '</div>' +
          '<pre id="imgfix-evidence" style="background:#0f172a;color:#86efac;border:1px solid #d7dce3;border-top:none;border-radius:0 0 10px 10px;padding:12px 16px;font-size:12px;line-height:1.7;white-space:pre-wrap;margin:0;"></pre>' +
        '</div>';
      document.body.appendChild(host);

      const t0 = performance.now();
      try {
        const resolved = await proxyRequestUrl(probeUrl);
        return { threw: false, resolved, portBefore, timeoutBudget: PROXY_READY_TIMEOUT_MS };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const elapsedMs = Math.round(performance.now() - t0);
        (document.getElementById('imgfix-error-msg') as HTMLElement).textContent = message;
        (document.getElementById('imgfix-evidence') as HTMLElement).textContent = [
          `proxyPort() before call = ${portBefore}`,
          `等待预算 PROXY_READY_TIMEOUT_MS = ${PROXY_READY_TIMEOUT_MS}ms`,
          `实际等待 = ${elapsedMs}ms`,
          `probe URL = ${probeUrl}`,
          '错误语义 = "secure proxy not ready … refusing insecure direct fallback"（明确、可诊断）',
        ].join('\n');
        console.error('[ImgFixE2E] F5 反代未就绪 → 诚实报错（真实 proxyRequestUrl 抛出）:', message);
        return { threw: true, message, elapsedMs, portBefore, timeoutBudget: PROXY_READY_TIMEOUT_MS };
      }
    }, PROBE_URL);

    // F5 断言：抛错、语义明确、等待预算符合常量
    if (!result.threw) {
      throw new Error(`F5：反代未就绪时 proxyRequestUrl 不应成功返回: ${JSON.stringify(result)}`);
    }
    expect(result.portBefore).toBe(0);
    expect(result.message).toMatch(/secure proxy not ready/);
    expect(result.message).toContain('port=0');
    expect(result.message).toContain('refusing insecure direct fallback');
    expect(result.message).toContain(PROBE_URL);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(1500); // ≈ PROXY_READY_TIMEOUT_MS(2000) 的真实等待
    expect(result.elapsedMs).toBeLessThan(8000);

    // console 落 transcript；截图错误态
    expect(logs.join('\n')).toContain('secure proxy not ready');
    await page.waitForTimeout(250);
    await screenshotArtifact(page, 'imgfix-C-f5-honest-error.png', md5s);
    writeTranscript('imgfix-C-console.txt', logs);
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'imgfix-C-result.json'), JSON.stringify(result, null, 2));
  });
});
