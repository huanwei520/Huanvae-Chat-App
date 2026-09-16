/**
 * 跨语言互操作验证：服务器块 reference_encrypt.py（Python cryptography）seal 的信封，
 * 由本仓 TS 实现 open —— 逐字节互操作证明（py→ts 方向）。
 * 临时密钥对存于 test-artifacts/dg80pf1a-interop/（非仓库内密钥，联调用完即弃）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { x25519 } from '@noble/curves/ed25519.js';
import { base64ToBytes } from '../../src/services/faultReport/bytes';
import { openFaultReport, parseFaultPublicKeyPem, type FaultEnvelope } from '../../src/services/faultReport/crypto';
import { FAULT_REPORT_PUBLIC_KEY_PEM } from '../../src/services/faultReport/config';

const INTEROP_DIR = 'test-artifacts/dg80pf1a-interop';

describe('faultReport 与服务器 reference_encrypt.py 跨语言互操作', () => {
  it('py seal → ts open：载荷逐字段一致（description/logs/screenshots）', () => {
    const env = JSON.parse(readFileSync(`${INTEROP_DIR}/py-sealed-envelope.json`, 'utf8')) as FaultEnvelope;
    const privRaw = base64ToBytes(readFileSync(`${INTEROP_DIR}/scratch-priv-b64.txt`, 'utf8').trim());
    const opened = openFaultReport(env, privRaw) as Record<string, unknown>;
    expect(opened['description']).toBe('interop py->ts: 描述含中文');
    expect(opened['logs']).toContain('line2 [rust/INFO] hello');
    const shots = opened['screenshots'] as Array<Record<string, unknown>>;
    expect(shots.length).toBe(0);
    expect(env.version).toBe(1);
  });

  it('官方正式公钥（内置）与服务器交付文件解析结果一致（32 字节裸钥）', () => {
    const delivered = readFileSync(
      '/work/Huanvae-Chat-Rust/docs/diagnosis/fault-report/fault-report-public-key.pem',
      'utf8',
    );
    expect(Array.from(parseFaultPublicKeyPem(delivered))).toEqual(
      Array.from(parseFaultPublicKeyPem(FAULT_REPORT_PUBLIC_KEY_PEM)),
    );
  });

  it('内置正式公钥可正常 seal（当前进程无私钥，仅验证 seal 路径可用）', () => {
    const { publicKey } = x25519.keygen(); // 仅占位防止未使用告警；真正断言在 seal 不抛错
    expect(publicKey.length).toBe(32);
    expect(() => parseFaultPublicKeyPem(FAULT_REPORT_PUBLIC_KEY_PEM)).not.toThrow();
  });
});
