/**
 * secureProxy —— 回环安全反代(Rust `secure_proxy.rs`)的 JS 适配。
 *
 * webview 的浏览器原生加载(`<img>`/`<video>`/`<audio>`、上传 XHR)用**系统信任**校验 TLS,
 * 验不过私有 CA 签的自签 leaf。故把这些资源 URL 改写成 `http://127.0.0.1:<port>/<原路径>`,
 * 经 Rust 反代(钉内置 CA、连源站 IP、不发 SNI、不验主机名)取数据面资源。webview↔反代=本地回环明文。
 *
 * 用法:App 启动早期 `initSecureProxy()`(取端口);discovery 选定 active 后 `setProxyTarget(ip,port,host)`;
 * 头像等用 `proxyResourceUrl(path)` 拿到反代 URL 喂给 `<img src>`、上传/请求用 `proxyRequestUrl(url)`。
 * @module services/secureProxy
 */

import { invoke } from '@tauri-apps/api/core';
import { isE2E, e2eResourceUrl } from './e2eMode';

let proxyPortValue = 0;
/** 反代目标源站的逻辑域名(setProxyTarget 时缓存),用于 resolveDisplayUrl 判定"后端 vs 外部"。 */
let proxyHostValue = '';

/** 启动回环反代并缓存端口(幂等)。在渲染任何远程头像/图片前调用。 */
export async function initSecureProxy(): Promise<number> {
  try {
    proxyPortValue = await invoke<number>('ensure_secure_proxy');
  } catch (e) {
    console.error('[secureProxy] 启动失败:', e);
  }
  return proxyPortValue;
}

/** 设置/更新反代目标源站(discovery 选定 active 后调用)。host=源站逻辑域名(反代转发时显式设的 Host 头)。 */
export async function setProxyTarget(ip: string, port: number, host: string): Promise<void> {
  proxyHostValue = host;
  try {
    await invoke('set_proxy_target', { ip, port, host });
  } catch (e) {
    console.error('[secureProxy] set_proxy_target 失败:', e);
  }
}

/** 反代监听端口(0=未就绪) */
export function proxyPort(): number {
  return proxyPortValue;
}

/** 抽出 URL 的 path+query(完整 URL 取 pathname+search;相对路径补前导斜杠)。非法完整 URL 返回 null。 */
function pathAndQueryOf(input: string): string | null {
  if (input.startsWith('http://') || input.startsWith('https://')) {
    try {
      const u = new URL(input);
      return u.pathname + u.search;
    } catch {
      return null;
    }
  }
  return input.startsWith('/') ? input : `/${input}`;
}

/**
 * 把数据面资源 URL(完整 URL 或相对路径)改写成回环反代 URL(`http://127.0.0.1:<port>/<path+query>`)。
 * 用于 webview 原生加载(`<img>`/`<video>` 等)。
 * - null/空 / 非法 URL → 原样或 null(完整 URL 原样返回,相对路径返回 null)
 * - 反代未就绪(端口 0)→ 退化:完整 URL 原样返回(可能瞬时加载失败),相对路径返回 null
 */
export function proxyResourceUrl(path: string | null | undefined): string | null {
  if (!path) { return null; }
  if (isE2E()) {
    // e2e：无反代面,完整 URL 原样(presigned 保 Host 签名)、相对路径拼集群基址
    return e2eResourceUrl(path);
  }
  const pq = pathAndQueryOf(path);
  if (pq === null) { return path; }
  if (!proxyPortValue) {
    return path.startsWith('http') ? path : null;
  }
  return `http://127.0.0.1:${proxyPortValue}${pq}`;
}

/**
 * **唯一收口点**:把"要在 webview 原生 `<img>/<video>` 里显示的远程媒体地址"解析成可显示的 src。
 * 所有数据面媒体显示(聊天图片/视频、头像、小程序图标、OAuth logo、独立预览窗)都**必须**经此函数,
 * 不得把裸 presigned/后端 URL 直接喂给 `<img src>`(否则 webview 用系统信任库验私有 CA 自签 leaf 失败)。
 * 由 `tests/secure-display-routing.test.ts` 静态契约测试强制。
 * - 空 → null
 * - 后端资源(相对路径,或 host = 反代逻辑域名的完整 URL)→ 回环反代(`proxyResourceUrl`,钉 CA 取数据)
 * - 外部资源(host ≠ 逻辑域名的完整 URL,真 CA)→ **原样放行**(webview 直接可加载,反代会把它错转到后端)
 */
export function resolveDisplayUrl(input: string | null | undefined): string | null {
  if (!input) { return null; }
  if (isE2E()) {
    return e2eResourceUrl(input);
  }
  if (input.startsWith('http://') || input.startsWith('https://')) {
    try {
      const u = new URL(input);
      // 已是回环反代 URL(127.0.0.1/localhost)——端口可能过期:反代端口优先 PREFERRED_PORT,被占则
      // ephemeral(每会话可变),而 DB 可能存了旧会话解析出的 loopback URL(旧端口)。剥掉旧端口,用当前
      // 端口重新反代,避免打死端口裂图(否则会走下面"外部"分支被原样返回旧端口)。
      if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') {
        return proxyResourceUrl(u.pathname + u.search);
      }
      // 已知反代逻辑域名,且 host 不是它 → 外部资源,原样(真 CA 直连,别反代到后端)
      if (proxyHostValue && u.hostname !== proxyHostValue) {
        return input;
      }
    } catch {
      return input;
    }
  }
  return proxyResourceUrl(input);
}

/**
 * 把一个**完整**数据面请求 URL 改写成回环反代 URL,供 webview 原生 XHR/fetch(上传分片、头像上传、
 * multipart、诊断上报等)使用——这些请求经 http://127.0.0.1:<port> 由 Rust 反代
 * 转发到源站(钉 CA、连源站 IP、不发 SNI、Host=逻辑域名)。反代未就绪(端口 0,启动早期幂等取过)或
 * URL 非法时退化为原 URL(失败诚实暴露,不静默掩盖)。
 */
export function proxyRequestUrl(url: string): string {
  if (isE2E()) {
    return e2eResourceUrl(url);
  }
  const pq = pathAndQueryOf(url);
  if (pq === null || !proxyPortValue) { return url; }
  return `http://127.0.0.1:${proxyPortValue}${pq}`;
}
