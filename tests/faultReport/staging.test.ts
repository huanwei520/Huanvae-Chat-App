/**
 * 本地暂存（上传失败）单测：暂存/列出/删除/上限丢最旧；暂存内容只含密文信封。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  stageFaultReport,
  listStagedReports,
  removeStagedReport,
  clearStagedReports,
  countStagedReports,
} from '../../src/services/faultReport/staging';
import { FAULT_STAGING_MAX_ITEMS } from '../../src/services/faultReport/config';
import type { FaultEnvelope } from '../../src/services/faultReport/crypto';

function fakeEnvelope(i: number): FaultEnvelope {
  return {
    version: 1,
    machine_code_hash: 'a'.repeat(64),
    timestamp: 1700000000 + i,
    nonce: btoa('nonce-nonce-n'),
    ephemeral_public_key: btoa('x'.repeat(32)),
    ciphertext: btoa(`ciphertext-of-report-${i}`),
  };
}

describe('faultReport staging —— 失败暂存与重试', () => {
  beforeEach(() => {
    clearStagedReports();
  });

  it('暂存后可列出（密文形态，含信封字段）', () => {
    stageFaultReport(fakeEnvelope(1), '崩溃于发送');
    const all = listStagedReports();
    expect(all.length).toBe(1);
    expect(all[0].envelope.ciphertext).toBeTruthy();
    expect(all[0].envelope.version).toBe(1);
    expect(all[0].hint).toContain('崩溃于发送');
  });

  it('删除单条', () => {
    const a = stageFaultReport(fakeEnvelope(1), 'a');
    const b = stageFaultReport(fakeEnvelope(2), 'b');
    removeStagedReport(a.id);
    const rest = listStagedReports();
    expect(rest.length).toBe(1);
    expect(rest[0].id).toBe(b.id);
  });

  it(`上限 ${FAULT_STAGING_MAX_ITEMS} 条：超限丢最旧`, () => {
    for (let i = 0; i < FAULT_STAGING_MAX_ITEMS + 2; i++) {
      stageFaultReport(fakeEnvelope(i), `hint-${i}`);
    }
    const all = listStagedReports();
    expect(all.length).toBe(FAULT_STAGING_MAX_ITEMS);
    // 最旧的两条被丢
    expect(all.some((s) => s.hint === 'hint-0')).toBe(false);
    expect(all.some((s) => s.hint === 'hint-1')).toBe(false);
    expect(all[all.length - 1].hint).toBe(`hint-${FAULT_STAGING_MAX_ITEMS + 1}`);
  });

  it('hint 超长截断到 80 字符', () => {
    const item = stageFaultReport(fakeEnvelope(1), 'x'.repeat(200));
    expect(item.hint.length).toBe(80);
  });

  it('count/clear', () => {
    expect(countStagedReports()).toBe(0);
    stageFaultReport(fakeEnvelope(1), 'a');
    expect(countStagedReports()).toBe(1);
    clearStagedReports();
    expect(countStagedReports()).toBe(0);
  });

  it('持久层写入抛错（quota/不可用）时内存主存仍可用', () => {
    const spy = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });
    stageFaultReport(fakeEnvelope(7), 'degraded-mode');
    expect(countStagedReports()).toBe(1);
    expect(listStagedReports()[0].hint).toBe('degraded-mode');
    spy.mockRestore();
  });
});
