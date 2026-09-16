/**
 * 故障上报 —— 进程内单例状态（缓冲 / 网络错误列表 / 记录窗口）
 *
 * 独立成模块以避免 capture ↔ service 循环依赖。
 *
 * @module services/faultReport/instance
 */

import { FaultRingBuffer, type FaultLogEntry } from './ringBuffer';
import { FAULT_LOG_BUFFER_MAX_BYTES } from './config';
import { sanitizeUrlForFaultLog } from './sanitizer';

export interface NetworkErrorSummary {
  /** epoch ms */
  at: number;
  /** 请求 URL（不含查询串中的敏感值 —— 摘要只保留 URL 与状态码两字段） */
  url: string;
  /** HTTP 状态码；网络层异常（未收到响应）记 0 */
  status: number;
}

class FaultReportState {
  /** 全局故障日志环形缓冲（写入前必须已脱敏） */
  readonly buffer = new FaultRingBuffer(FAULT_LOG_BUFFER_MAX_BYTES);

  /** 网络错误结构化摘要（URL+状态码，无请求头无请求体） */
  readonly networkErrors: NetworkErrorSummary[] = [];

  /** 记录窗口：null=未在记录；否则为本次开启的起点 */
  private recordingSince: number | null = null;

  pushEntry(entry: FaultLogEntry): void {
    this.buffer.push(entry);
  }

  recordNetworkError(summary: NetworkErrorSummary): void {
    // 防御层：任何调用点进入本模块前 URL 必已脱敏；此处再过一遍保证写入缓冲/结构化列表的值安全（幂等）
    const url = sanitizeUrlForFaultLog(summary.url);
    faultReportInstance.pushEntry({
      at: summary.at,
      source: 'network',
      level: 'error',
      text: `网络请求失败 url=${url} status=${summary.status}`,
    });
    // 网络错误结构化列表只保留最近 200 条，防长会话累积
    this.networkErrors.push({ ...summary, url });
    if (this.networkErrors.length > 200) {
      this.networkErrors.splice(0, this.networkErrors.length - 200);
    }
  }

  startRecording(): number {
    this.recordingSince = Date.now();
    return this.recordingSince;
  }

  stopRecording(): void {
    this.recordingSince = null;
  }

  isRecording(): boolean {
    return this.recordingSince !== null;
  }

  getRecordingSince(): number | null {
    return this.recordingSince;
  }
}

/** 全局单例（App 生命周期内共享一份缓冲） */
export const faultReportInstance = new FaultReportState();
