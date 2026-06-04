/**
 * 小程序启动相关 pure function
 *
 * 抽离自 MiniAppsModal.tsx，便于桌面端（MiniAppsModal）和移动端（MobileMiniAppsPage）
 * 共同 import，避免移动端 bundle 通过 MiniAppsModal 间接引入 WebviewWindow / OAuthClientsPanel
 * 等桌面 only 模块。
 *
 * 包含：
 * - buildMiniAppLaunchUrl：拼接小程序启动 URL（platform JWT 注入到 query）
 *
 * 注：审批制改造后,创建走「提交申请」(submitMiniAppRequest),响应不含容器/凭据/OAuth,
 * 原 buildCredentialsFields(创建即时展示凭据)已随之删除——凭据在管理员审批生成后,
 * 由开发者经容器信息 / reset-password 获取。
 */

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
