/**
 * 小程序启动相关 pure function
 *
 * 抽离自 MiniAppsModal.tsx，便于桌面端（MiniAppsModal）和移动端（MobileMiniAppsPage）
 * 共同 import，避免移动端 bundle 通过 MiniAppsModal 间接引入 WebviewWindow / OAuthClientsPanel
 * 等桌面 only 模块。
 *
 * 包含：
 * - buildMiniAppLaunchUrl：拼接小程序启动 URL（platform JWT 注入到 query）
 * - buildResourceProposal：把申请表单的 CPU/内存输入转成后端 proposed_cpu/proposed_mem
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

/** 申请资源提议（对应后端 proposed_cpu / proposed_mem，均可选）。 */
export interface ResourceProposal {
  proposed_cpu?: string;
  proposed_mem?: string;
}

/**
 * 把申请表单的「CPU 核数」「内存 GB」输入转成后端 proposed_cpu / proposed_mem 字段。
 *
 * - 空输入 / 非正数（0、负数、非数字）则省略对应字段（后端按默认 2c2g 处理，
 *   不发送空串或负值——避免把无意义的提议值存进 DB 让管理员看到）。
 * - CPU 原样传核数字符串（后端 `parse::<f64>`，"2" / "2.5" 均可）。
 * - 内存补 `g` 单位（后端 parse_mem_mb 用 f64 解析 g/m/gb/mb），即输入 "2" → "2g"。
 *
 * 这些是申请人的「提议」值：管理员审批时可调整，且受后端硬上限（与下限）钳制。
 */
export function buildResourceProposal(cpuCores: string, memGb: string): ResourceProposal {
  const result: ResourceProposal = {};
  const cpu = cpuCores.trim();
  const mem = memGb.trim();
  if (cpu && Number(cpu) > 0) {
    result.proposed_cpu = cpu;
  }
  if (mem && Number(mem) > 0) {
    result.proposed_mem = `${mem}g`;
  }
  return result;
}
