/**
 * 故障记录检测 —— 流程编排
 *
 * 用户流程：遇 bug → 开启记录（自动附带开启前最近 ~5 分钟缓冲）→ 复现 → 停止 →
 * 附加截图(压缩)+文字描述 → 提交（描述+日志+截图整体打包一次加密）→ 工单号；
 * 失败 → 本地暂存（密文形态）→ 可见重试入口。
 *
 * 采集面：console/异常/网络错误摘要/Rust log/设备元数据/机器码哈希/时间戳。
 * 聊天正文零采集（采集面不包含任何消息存储/渲染层，见 capture.ts）。
 *
 * @module services/faultReport/service
 */

import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import {
  FAULT_LOG_PRE_WINDOW_MS,
  FAULT_REPORT_MAX_SCREENSHOTS,
  activeFaultPublicKeyPem,
  FAULT_SCREENSHOT_JPEG_QUALITY,
  FAULT_SCREENSHOT_MAX_EDGE_PX,
} from './config';
import { faultReportInstance, type NetworkErrorSummary } from './instance';
import { sealFaultReport, type FaultEnvelope } from './crypto';
import { sanitizeUrlForFaultLog } from './sanitizer';
import { stageFaultReport, listStagedReports, removeStagedReport, type StagedFaultReport } from './staging';
import { submitFaultReport } from '../../api/faultReport';
import type { ApiClient } from '../../api/client';

export interface FaultDeviceInfo {
  platform: string;
  os_version: string;
  arch: string;
  model: string;
  app_version: string;
}

/** 服务器可见的截图条目：{name,mime,data}（width/height 为额外诊断字段） */
export interface FaultScreenshot {
  name: string;
  mime: string;
  width: number;
  height: number;
  data: string;
}

/**
 * 加密载荷（信封内 UTF-8 JSON）。
 * 服务器管理端解密渲染字段：description / logs / screenshots（见服务器 envelope.rs FaultReportPayload）；
 * 其余为诊断扩展字段（serde 不拒绝未知字段，后台深度排查用）。
 */
export interface FaultReportPayload {
  description: string;
  /** 合并后的脱敏日志文本（客户端行 + Rust 行 + 网络错误摘要行） */
  logs: string;
  screenshots: FaultScreenshot[];
  client_logs: string;
  rust_logs: string;
  network_errors: NetworkErrorSummary[];
  device_info: FaultDeviceInfo;
  machine_code_hash: string;
  app_version: string;
  recording: { started_at: number; stopped_at: number; pre_window_ms: number };
}

/** 开启记录。返回开启时刻（epoch ms）。 */
export function startFaultRecording(): number {
  const startedAt = faultReportInstance.startRecording();
  faultReportInstance.pushEntry({
    at: startedAt,
    source: 'console',
    level: 'info',
    text: `故障记录已开启（自动附带开启前最近 ${Math.round(FAULT_LOG_PRE_WINDOW_MS / 60000)} 分钟缓冲）`,
  });
  return startedAt;
}

/** 停止记录。返回窗口信息。 */
export function stopFaultRecording(): { started_at: number; stopped_at: number } {
  const since = faultReportInstance.getRecordingSince() ?? Date.now() - FAULT_LOG_PRE_WINDOW_MS;
  const stoppedAt = Date.now();
  faultReportInstance.pushEntry({
    at: stoppedAt,
    source: 'console',
    level: 'info',
    text: '故障记录已停止，可附加截图与描述后提交',
  });
  faultReportInstance.stopRecording();
  return { started_at: since, stopped_at: stoppedAt };
}

export function isFaultRecording(): boolean {
  return faultReportInstance.isRecording();
}

/** 读取 Rust 侧故障日志（追加层缓冲，均已脱敏；Tauri 不可达时退化为空） */
async function fetchRustLogs(sinceMs: number): Promise<string> {
  try {
    const entries = await invoke<Array<{ at: number; level: string; text: string }>>('fault_report_get_rust_logs', {
      sinceMs,
    });
    return entries
      .map((e) => `${new Date(e.at).toISOString()} [rust/${e.level}] ${e.text}`)
      .join('\n');
  } catch {
    return '';
  }
}

async function fetchDeviceInfo(): Promise<FaultDeviceInfo> {
  const fallback: FaultDeviceInfo = {
    platform: 'unknown',
    os_version: 'unknown',
    arch: 'unknown',
    model: 'unknown',
    app_version: '',
  };
  try {
    const info = await invoke<Partial<FaultDeviceInfo>>('fault_report_device_info');
    return { ...fallback, ...info };
  } catch {
    try {
      fallback.app_version = await getVersion();
    } catch {
      // 保持 unknown
    }
    return fallback;
  }
}

async function fetchMachineCodeHash(): Promise<string> {
  try {
    const hash = await invoke<string>('fault_report_machine_code_hash');
    if (typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash)) {
      return hash;
    }
  } catch {
    // 走下方抛错（缺机器码哈希则拒绝提交 —— 信封必须绑定机器码）
  }
  throw new Error('机器码哈希不可用（fault_report_machine_code_hash 失败），已按红线拒绝提交');
}

/**
 * 截图压缩：最长边压到 FAULT_SCREENSHOT_MAX_EDGE_PX，转 JPEG。
 * 纯浏览器 API，任一步失败即抛错由 UI 提示。
 */
export async function compressScreenshot(file: File): Promise<FaultScreenshot> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, FAULT_SCREENSHOT_MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('canvas 2d 上下文不可用');
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', FAULT_SCREENSHOT_JPEG_QUALITY);
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    return {
      name: `screenshot-${Date.now()}.jpg`,
      mime: 'image/jpeg',
      width,
      height,
      data: b64,
    };
  } finally {
    bitmap.close();
  }
}

/** 组包并一次整体加密（描述+日志+截图同一密文）。返回信封与明文字节数（供 UI 显示大小）。 */
export async function buildAndSealFaultReport(params: {
  description: string;
  screenshots: FaultScreenshot[];
  recording: { started_at: number; stopped_at: number };
}): Promise<{ envelope: FaultEnvelope; plaintextBytes: number }> {
  const publicKeyPem = activeFaultPublicKeyPem();
  if (!publicKeyPem || publicKeyPem.trim().length === 0) {
    throw new Error('上报通道未配置正式公钥（待服务器密钥事务交付），已 fail-closed 拒绝提交');
  }
  const startedAt = params.recording.started_at;
  const preWindowSince = Math.min(startedAt - FAULT_LOG_PRE_WINDOW_MS, startedAt);

  const [deviceInfo, machineCodeHash, appVersion] = await Promise.all([
    fetchDeviceInfo(),
    fetchMachineCodeHash(),
    getVersion().catch(() => 'unknown'),
  ]);

  const clientLogs = faultReportInstance.buffer.snapshot(preWindowSince);
  const rustLogs = await fetchRustLogs(preWindowSince);
  const networkErrors = faultReportInstance.networkErrors.filter((e) => e.at >= preWindowSince);

  // 服务器渲染字段 logs = 合并脱敏文本（客户端行 + Rust 行 + 网络错误摘要行；e.url 在入队时已脱敏，此处再过一遍兑底）
  const networkLines = networkErrors.map(
    (e) => `${new Date(e.at).toISOString()} [network] ${sanitizeUrlForFaultLog(e.url)} -> status ${e.status}`,
  );
  const logs = [clientLogs, rustLogs, ...networkLines].filter(Boolean).join('\n');

  const payload: FaultReportPayload = {
    description: params.description,
    logs,
    screenshots: params.screenshots.slice(0, FAULT_REPORT_MAX_SCREENSHOTS),
    client_logs: clientLogs,
    rust_logs: rustLogs,
    network_errors: networkErrors,
    device_info: { ...deviceInfo, app_version: appVersion },
    machine_code_hash: machineCodeHash,
    app_version: appVersion,
    recording: {
      started_at: params.recording.started_at,
      stopped_at: params.recording.stopped_at,
      pre_window_ms: FAULT_LOG_PRE_WINDOW_MS,
    },
  };

  const plaintextBytes = new TextEncoder().encode(JSON.stringify(payload)).length;
  const envelope = sealFaultReport(payload, publicKeyPem);
  return { envelope, plaintextBytes };
}

/** 提交已加密信封；失败时本地暂存（密文形态）并向上抛错（UI 显示失败+重试入口）。 */
export async function submitSealedEnvelope(
  api: ApiClient,
  envelope: FaultEnvelope,
  hint: string,
): Promise<string> {
  try {
    const resp = await submitFaultReport(api, envelope);
    return resp.ticket_id;
  } catch (err) {
    stageFaultReport(envelope, hint);
    throw err;
  }
}

/** 重试全部暂存：返回 { succeeded, failed }（成功的从暂存队列移除）。 */
export async function retryStagedReports(
  api: ApiClient,
): Promise<{ succeeded: string[]; failed: Array<{ id: string; reason: string }> }> {
  const succeeded: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];
  const staged: StagedFaultReport[] = listStagedReports();
  for (const item of staged) {
    try {
      // eslint-disable-next-line no-await-in-loop -- 串行是刻意的：重试逐条提交，避免失败后并发重放放大服务器压力
      const ticket = await submitFaultReport(api, item.envelope);
      removeStagedReport(item.id);
      succeeded.push(ticket.ticket_id);
    } catch (err) {
      failed.push({ id: item.id, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return { succeeded, failed };
}

/** UI 状态快照 */
export interface FaultReportUiState {
  recording: boolean;
  bufferStats: { count: number; bytes: number; dropped: number };
  stagedCount: number;
  publicKeyConfigured: boolean;
}

export function getFaultReportUiState(): FaultReportUiState {
  return {
    recording: faultReportInstance.isRecording(),
    bufferStats: faultReportInstance.buffer.stats(),
    stagedCount: listStagedReports().length,
    publicKeyConfigured: !!activeFaultPublicKeyPem(),
  };
}
