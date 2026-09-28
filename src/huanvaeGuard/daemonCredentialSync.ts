/**
 * 主窗口侧 guard 守护进程凭据静默同步 —— 401 自愈链（gtcy072z）的补强跳。
 *
 * ## 为什么主窗口也要推（而不只靠 VPN 页）
 *
 * gtcy072z 落地的推送链只有一个消费者：HuanvaeGuardPage（VPN 页窗口）。这有两个
 * 结构性空洞，owner 2026-09-26 20:30 实拍横幅复发即由此而来（详见
 * blocks/1790430647659-tu14ytyn-1 交付）：
 *
 * 1. **VPN 页没开 = 链不存在**：`session:tokens-updated` 是 Tauri 窗口事件
 *    （不出进程，见 .claude/skills/guard-token-resync §0），主窗口每次续期广播时
 *    若 VPN 页窗口未开，没有任何人把新令牌过线给守护进程；等用户重新打开 VPN 页，
 *    守护进程可能早已拿着被撤销/过期的 refresh token 撞出「token refresh after
 *    401 failed」横幅。
 * 2. **开页竞态**：页面挂载即 emit `session:request-tokens`，回发到达时首拍探活
 *    （tunnelActiveRef）往往还没落地，推送被门控静默跳过，只能等 60s 节流的
 *    死凭据探测器兜底。
 *
 * 本模块把「过线给守护进程」这一跳挂进主窗口的令牌生命周期（登录 setSession 与
 * 每次续期 updateTokens），让守护进程**不等 VPN 页**就跟上最新令牌——401→refresh→
 * 再 401 的死局在形成之前就被静默续期掐掉。推送只走本地回环（localApi.
 * updateControlCredentials → POST /api/tunnel/credentials），守护进程侧对同值推送
 * 幂等、对无隧道推送报「无活跃控制面」，两类都没有副作用。
 *
 * ## 平台边界
 *
 * 与页面侧同一规则：推送是桌面轨专属。安卓/iOS 的 guard 会话走插件会话文件
 * （sessionFd），没有本地 HTTP 控制面（Guard 仓 client/android/ 对
 * tunnel/credentials 穷举零命中），所以 isMobile 一律不推。
 *
 * ## 日志纪律
 *
 * 本模块所有日志**不得包含令牌值**（对齐 guard-token-resync §4 检查单）；
 * 失败只报原因分类。
 *
 * @module services/huanvaeGuard/daemonCredentialSync
 */

import * as localApi from './localApi';

/**
 * 推送门控（纯函数，便于单测）：桌面轨 + 非空 access token 才推。
 *
 * 与 HuanvaeGuardPage.pushControlCredentials 的三条件门控同构（那边多一个
 * tunnelActiveRef——页面窗口里知道隧道状态，主窗口不知道；主窗口侧推给
 * 没有活跃控制面的守护进程只会收到一条 error 回执，无副作用，可放心发）。
 */
export function shouldSyncToDaemon(accessToken: string, isMobilePlatform: boolean): boolean {
  if (isMobilePlatform) { return false; }
  return accessToken.length > 0;
}

/**
 * 同步一次令牌到守护进程，返回结构化结果（不抛错——推送失败绝不影响会话主流程）。
 *
 * `endpointMissing` 单独拎出来：404 = 守护进程早于凭据推送端点发布（gtcy072z
 * Guard 半边 acfb104 之前构建的二进制），此时自愈链在最后一跳结构性断裂，
 * 调用方应给出「升级守护进程」的可执行指引，而不是笼统的「未生效」。
 */
export async function syncToDaemon(
  accessToken: string,
  refreshToken?: string,
): Promise<{ ok: boolean; endpointMissing: boolean; error?: string }> {
  try {
    const r = await localApi.updateControlCredentials({
      access_token: accessToken,
      // 空串归一化（键缺省）由 localApi 那道闸负责，这里透传即可
      refresh_token: refreshToken || undefined,
    });
    if (r.success) {
      return { ok: true, endpointMissing: false };
    }
    return {
      ok: false,
      endpointMissing: localApi.credentialsEndpointMissing(r.error),
      error: r.error,
    };
  } catch (e) {
    return { ok: false, endpointMissing: false, error: String(e) };
  }
}
