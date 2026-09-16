/**
 * 上传失败本地暂存队列
 *
 * 红线对齐：暂存内容 = 【已加密信封】+ 元数据，不含任何明文日志/截图
 * （服务器不可达时本地也不落明文）。
 *
 * 存储策略：内存 Map 为主存（本次会话内绝对可用），localStorage 做写穿持久化
 * （存在 quota/不可用环境；读写均 try/catch，持久化失败只降级为"本次会话内有效"）。
 * 上限 FAULT_STAGING_MAX_ITEMS 条，超限丢最旧。
 *
 * @module services/faultReport/staging
 */

import { FAULT_STAGING_MAX_ITEMS } from './config';
import type { FaultEnvelope } from './crypto';

const STORAGE_KEY = 'huanvae.faultReport.staging.v1';

export interface StagedFaultReport {
  /** 本地暂存 ID（staged-<ts>-<rand>） */
  id: string;
  /** 暂存时间 epoch ms */
  stagedAt: number;
  /** 已加密信封（密文形态） */
  envelope: FaultEnvelope;
  /** 用户填写的附言摘要（仅标题用途，无正文 —— 正文已在信封内） */
  hint: string;
}

const memory = new Map<string, StagedFaultReport>();
let hydrated = false;

function isStagedReport(v: unknown): v is StagedFaultReport {
  if (!v || typeof v !== 'object') {
    return false;
  }
  const r = v as Partial<StagedFaultReport>;
  return (
    typeof r.id === 'string' &&
    typeof r.stagedAt === 'number' &&
    !!r.envelope && typeof r.envelope === 'object' && typeof r.envelope.ciphertext === 'string' &&
    typeof r.hint === 'string'
  );
}

/** 首次触达时从持久层恢复（损坏/不可用则安全降级为空） */
function hydrate(): void {
  if (hydrated) {
    return;
  }
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (isStagedReport(item) && !memory.has(item.id)) {
          memory.set(item.id, item);
        }
      }
    }
  } catch {
    // 持久层损坏/不可用：降级为空，不影响内存主存
  }
}

/** 写穿持久化（失败仅降级，不抛错） */
function persist(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...memory.values()]));
  } catch {
    // 持久化失败：仅本次会话内有效
  }
}

function sortedItems(): StagedFaultReport[] {
  return [...memory.values()].sort((a, b) => a.stagedAt - b.stagedAt);
}

/** 暂存一条（超上限丢最旧） */
export function stageFaultReport(envelope: FaultEnvelope, hint: string): StagedFaultReport {
  hydrate();
  const item: StagedFaultReport = {
    id: `staged-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    stagedAt: Date.now(),
    envelope,
    hint: hint.slice(0, 80),
  };
  memory.set(item.id, item);
  while (memory.size > FAULT_STAGING_MAX_ITEMS) {
    const oldest = sortedItems()[0];
    if (oldest) {
      memory.delete(oldest.id);
    }
  }
  persist();
  return item;
}

/** 列出全部暂存（最旧在前） */
export function listStagedReports(): StagedFaultReport[] {
  hydrate();
  return sortedItems();
}

/** 删除一条（重试成功后调用） */
export function removeStagedReport(id: string): void {
  hydrate();
  memory.delete(id);
  persist();
}

/** 暂存条数 */
export function countStagedReports(): number {
  hydrate();
  return memory.size;
}

/** 清空（测试/用户主动放弃） */
export function clearStagedReports(): void {
  hydrate();
  memory.clear();
  persist();
}
