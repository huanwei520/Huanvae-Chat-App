/**
 * 小程序启动相关 pure function
 *
 * 抽离自 MiniAppsModal.tsx，便于桌面端（MiniAppsModal）和移动端（MobileMiniAppsPage）
 * 共同 import，避免移动端 bundle 通过 MiniAppsModal 间接引入 WebviewWindow / OAuthClientsPanel
 * 等桌面 only 模块。
 *
 * 包含：
 * - buildMiniAppLaunchUrl：拼接小程序启动 URL（platform JWT 注入到 query）
 * - buildCredentialsFields：创建小程序响应 → SecretDisplay 用的 fields 数组
 */

import type { CreateMiniAppResponse } from '../../api/miniapps';
import type { SecretField } from '../common/SecretDisplay';

/**
 * 拼接打开小程序的 URL
 * 平台 JWT 以 `?token=` 或 `&token=` 形式附加在 access_url 之后，
 * 小程序自己读 URL query 走 OAuth 4 步流程。与后端 ai-demo 约定一致。
 */
export function buildMiniAppLaunchUrl(
  serverUrl: string,
  accessUrl: string,
  token: string,
): string {
  const separator = accessUrl.includes('?') ? '&' : '?';
  return `${serverUrl}${accessUrl}${separator}token=${encodeURIComponent(token)}`;
}

/**
 * 把创建小程序的响应转为 SecretDisplay 用的 fields 数组
 * OAuth 字段缺失时省略对应行；SSH 字段始终存在。
 */
export function buildCredentialsFields(r: CreateMiniAppResponse): SecretField[] {
  const fields: SecretField[] = [];
  if (r.oauth_client_id) {
    fields.push({ label: 'OAuth Client ID', value: r.oauth_client_id });
  }
  if (r.oauth_client_secret) {
    fields.push({ label: 'OAuth Client Secret', value: r.oauth_client_secret });
  }
  fields.push(
    { label: 'SSH 端口', value: String(r.container.ssh_port) },
    { label: 'SSH 用户', value: r.container.ssh_user },
    { label: 'SSH 密码', value: r.container.ssh_password },
  );
  return fields;
}
