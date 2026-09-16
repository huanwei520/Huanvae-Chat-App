/**
 * ECIES 加密封装单测（信封 v1，与服务器 examples/fault_report 逐字节互操作协议）：
 * - 公钥加密 → 对应私钥解密一致；篡改（密文/nonce/信封字段）解密失败；
 * - 派生参数钉死：salt=SHA256(PREFIX||0x00||u32be(1)||0x00||hash||0x00||u64be(秒))、AAD=salt、
 *   HKDF info="huanvae/fault-report/v1/ecies/chacha20poly1305"、nonce 12B；
 * - 内置正式公钥（config）可解析出 32 字节裸钥。
 * 测试密钥对在测试运行时现场生成，仓库零私钥。
 */

import { describe, it, expect } from 'vitest';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { utf8StringToBytes, bytesToBase64, base64ToBytes } from '../../src/services/faultReport/bytes';
import {
  sealFaultReport,
  openFaultReport,
  parseFaultPublicKeyPem,
  deriveSalt,
  HKDF_INFO,
  FaultCryptoError,
} from '../../src/services/faultReport/crypto';
import { FAULT_REPORT_ENVELOPE_VERSION, FAULT_REPORT_PUBLIC_KEY_PEM } from '../../src/services/faultReport/config';

function makeRecipientPem(): { pem: string; secretKey: Uint8Array; publicKey: Uint8Array } {
  const kp = x25519.keygen();
  // SPKI DER 形态 PEM：12 字节头（30 2a 30 05 06 03 2b 65 6e 03 21 00）+ 32 字节裸公钥
  const spki = new Uint8Array(44);
  spki.set([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x03, 0x21, 0x00], 0);
  spki.set(kp.publicKey, 12);
  const b64 = bytesToBase64(spki);
  const lines = b64.match(/.{1,64}/g)?.join('\n') ?? b64;
  return { pem: `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----\n`, secretKey: kp.secretKey, publicKey: kp.publicKey };
}

const VALID_HASH = 'a'.repeat(64);

function samplePayload() {
  return {
    description: '点发送后崩溃',
    logs: '2026-09-15T12:00:00Z [console/error] TypeError: x is not a function',
    screenshots: [
      { name: 's1.jpg', mime: 'image/jpeg', width: 100, height: 200, data: bytesToBase64(new Uint8Array([1, 2, 3])) },
    ],
    client_logs: '2026-09-15T12:00:00Z [console/error] TypeError: x is not a function',
    rust_logs: '2026-09-15T12:00:01Z [rust/INFO] ws reconnect',
    network_errors: [{ at: 1, url: 'https://api.example.com/api/messages', status: 500 }],
    device_info: { platform: 'android', os_version: '14', arch: 'aarch64', model: 'test', app_version: '1.1.46' },
    machine_code_hash: VALID_HASH,
    app_version: '1.1.46',
    recording: { started_at: 1, stopped_at: 2, pre_window_ms: 300000 },
  };
}

describe('faultReport ECIES v1 —— 加密往返与篡改检测', () => {
  it('PEM 解析：SPKI 形态与裸 32 字节形态均可', () => {
    const { pem, publicKey } = makeRecipientPem();
    expect(Array.from(parseFaultPublicKeyPem(pem))).toEqual(Array.from(publicKey));
    const raw = `-----BEGIN X25519 PUBLIC KEY-----\n${bytesToBase64(publicKey)}\n-----END X25519 PUBLIC KEY-----`;
    expect(Array.from(parseFaultPublicKeyPem(raw))).toEqual(Array.from(publicKey));
  });

  it('内置正式公钥（服务器块交付）可解析出 32 字节裸钥', () => {
    const raw = parseFaultPublicKeyPem(FAULT_REPORT_PUBLIC_KEY_PEM);
    expect(raw.length).toBe(32);
  });

  it('PEM 解析：空/非法输入抛 FaultCryptoError', () => {
    expect(() => parseFaultPublicKeyPem('')).toThrow(FaultCryptoError);
    expect(() => parseFaultPublicKeyPem('not-base64-!!!')).toThrow(FaultCryptoError);
    expect(() => parseFaultPublicKeyPem(bytesToBase64(new Uint8Array(10)))).toThrow(FaultCryptoError);
  });

  it('fail-closed：公钥未配置（null）时 seal 抛错', () => {
    expect(() => sealFaultReport(samplePayload(), null)).toThrow(FaultCryptoError);
    expect(() => sealFaultReport(samplePayload(), '')).toThrow(FaultCryptoError);
  });

  it('加密 → 私钥解密：载荷逐字段一致；信封字段形态符合 v1 规范', () => {
    const { pem, secretKey } = makeRecipientPem();
    const payload = samplePayload();
    const envelope = sealFaultReport(payload, pem, { timestampSec: 1757934000 });

    expect(envelope.version).toBe(1);
    expect(envelope.version).toBe(FAULT_REPORT_ENVELOPE_VERSION);
    expect(envelope.machine_code_hash).toBe(VALID_HASH);
    expect(envelope.timestamp).toBe(1757934000);
    expect(base64ToBytes(envelope.nonce).length).toBe(12);
    expect(base64ToBytes(envelope.ephemeral_public_key).length).toBe(32);
    expect(envelope.app_version).toBe('1.1.46');

    const opened = openFaultReport(envelope, secretKey) as typeof payload;
    expect(opened).toEqual(payload);
  });

  it('salt 派生逐字节钉死（与服务器 derive_salt 同构）', () => {
    // 独立重算：SHA256("huanvae-fault-report/v1" || 00 || u32be(1) || 00 || hash || 00 || u64be(ts))
    const h = sha256(
      Uint8Array.of(
        ...utf8StringToBytes('huanvae-fault-report/v1'),
        0x00,
        0, 0, 0, 1,
        0x00,
        ...utf8StringToBytes(VALID_HASH),
        0x00,
        ...(() => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, 1757934000n, false); return b; })(),
      ),
    );
    expect(Array.from(deriveSalt(1, VALID_HASH, 1757934000))).toEqual(Array.from(h));
  });

  it('解密侧独立重算派生（不经过 seal 内部路径）也能解开 —— 参数钉死防漂移', () => {
    const { pem, secretKey } = makeRecipientPem();
    const payload = samplePayload();
    const ts = 1757934000;
    const envelope = sealFaultReport(payload, pem, { timestampSec: ts });

    const shared = x25519.getSharedSecret(secretKey, base64ToBytes(envelope.ephemeral_public_key));
    const salt = deriveSalt(1, VALID_HASH, ts);
    const key = hkdf(sha256, shared, salt, utf8StringToBytes(HKDF_INFO), 32);
    const aead = chacha20poly1305(key, base64ToBytes(envelope.nonce), salt);
    const plaintext = aead.decrypt(base64ToBytes(envelope.ciphertext));
    expect(JSON.parse(new TextDecoder().decode(plaintext))).toEqual(payload);
  });

  it('每次加密使用新临时密钥与 nonce（同载荷两次密文不同）', () => {
    const { pem, secretKey } = makeRecipientPem();
    const e1 = sealFaultReport(samplePayload(), pem);
    const e2 = sealFaultReport(samplePayload(), pem);
    expect(e1.ciphertext).not.toBe(e2.ciphertext);
    expect(e1.ephemeral_public_key).not.toBe(e2.ephemeral_public_key);
    expect(openFaultReport(e1, secretKey)).toEqual(samplePayload());
    expect(openFaultReport(e2, secretKey)).toEqual(samplePayload());
  });

  it('错误私钥解密失败', () => {
    const { pem } = makeRecipientPem();
    const wrong = x25519.keygen();
    const envelope = sealFaultReport(samplePayload(), pem);
    expect(() => openFaultReport(envelope, wrong.secretKey)).toThrow();
  });

  it('篡改密文一个字节 → 解密失败', () => {
    const { pem, secretKey } = makeRecipientPem();
    const envelope = sealFaultReport(samplePayload(), pem);
    const ct = base64ToBytes(envelope.ciphertext);
    ct[0] ^= 0xff;
    expect(() => openFaultReport({ ...envelope, ciphertext: bytesToBase64(ct) }, secretKey)).toThrow();
  });

  it('篡改 nonce → 解密失败', () => {
    const { pem, secretKey } = makeRecipientPem();
    const envelope = sealFaultReport(samplePayload(), pem);
    const nonce = base64ToBytes(envelope.nonce);
    nonce[0] ^= 0x01;
    expect(() => openFaultReport({ ...envelope, nonce: bytesToBase64(nonce) }, secretKey)).toThrow();
  });

  it('篡改信封字段（version/machine_code_hash/timestamp）→ AAD 绑定解密失败', () => {
    const { pem, secretKey } = makeRecipientPem();
    const envelope = sealFaultReport(samplePayload(), pem);
    expect(() => openFaultReport({ ...envelope, version: 2 }, secretKey)).toThrow();
    expect(() =>
      openFaultReport({ ...envelope, machine_code_hash: 'b'.repeat(64) }, secretKey),
    ).toThrow();
    expect(() => openFaultReport({ ...envelope, timestamp: envelope.timestamp + 1 }, secretKey)).toThrow();
  });

  it('载荷缺少合法 machine_code_hash → seal 拒绝', () => {
    const { pem } = makeRecipientPem();
    const bad = { ...samplePayload(), machine_code_hash: 'short' };
    expect(() => sealFaultReport(bad, pem)).toThrow(FaultCryptoError);
  });
});
