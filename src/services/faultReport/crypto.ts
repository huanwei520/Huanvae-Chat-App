/**
 * 故障报告 ECIES 加密封装（X25519 + HKDF-SHA256 + ChaCha20-Poly1305 / RFC 8439）
 *
 * 【信封规范 v1】（与服务器端 examples/fault_report 逐字节互操作，字段名逐字一致）：
 *
 *   envelope = {
 *     version:              1,                                // 整数，服务器支持列表 [1]
 *     machine_code_hash:    "<sha256 hex 小写 64 字符>",
 *     timestamp:            <epoch 秒, number>,               // 服务器容忍 ±86400s 窗口
 *     nonce:                "<base64 标准, 12 字节随机>",      // IETF ChaCha20-Poly1305
 *     ephemeral_public_key: "<base64 标准, 32 字节裸 X25519 公钥>",
 *     ciphertext:           "<base64 标准, 密文||16 字节 Poly1305 tag>",
 *     app_version?:         "<明文索引字段，非秘密，≤64 字符>"
 *   }
 *
 *   派生（与服务器 crypto.rs / reference_encrypt.py 三方一致）：
 *     ikm   = X25519(ephemeral_sk, recipient_pk)
 *     salt  = SHA-256("huanvae-fault-report/v1" || 0x00 || version_u32_be || 0x00 ||
 *                     machine_code_hash_ascii   || 0x00 || timestamp_u64_be)
 *     key   = HKDF-SHA256(salt, ikm, info="huanvae/fault-report/v1/ecies/chacha20poly1305", 32)
 *     AAD   = salt（32 字节派生盐本身）
 *
 *   明文 = UTF-8(JSON({description, logs, screenshots:[{name,mime,data}], ...诊断字段}))
 *
 * 【私钥边界】本模块只做公钥加密；接收方私钥只在服务器侧（/vault.env 变量引用），
 * 绝不入仓、绝不出现在本仓库任何文件中。单测使用的临时密钥对仅存在于测试进程。
 *
 * 【fail-closed】FAULT_REPORT_PUBLIC_KEY_PEM === null（正式公钥未交付）时 seal 抛错，
 * 绝不以任何自造/占位密钥顶替正式公钥。
 *
 * @module services/faultReport/crypto
 */

import { x25519 } from '@noble/curves/ed25519.js';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8StringToBytes, bytesToBase64, base64ToBytes } from './bytes';
import { FAULT_REPORT_ENVELOPE_VERSION } from './config';

/** HKDF info 常量（协议固定字节，与服务器 HKDF_INFO 一致） */
export const HKDF_INFO = 'huanvae/fault-report/v1/ecies/chacha20poly1305';
/** 盐派生前缀常量（与服务器 SALT_PREFIX 一致） */
export const SALT_PREFIX = 'huanvae-fault-report/v1';
/** AEAD nonce 长度（IETF 12 字节） */
export const NONCE_LEN = 12;

export class FaultCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FaultCryptoError';
  }
}

export interface FaultEnvelope {
  version: number;
  machine_code_hash: string;
  /** epoch 秒 */
  timestamp: number;
  nonce: string;
  ephemeral_public_key: string;
  ciphertext: string;
  app_version?: string;
}

/**
 * 解析接收方 X25519 公钥 PEM。
 * 兼容三种形态（服务器块交付形态为 SPKI PEM）：
 * - "-----BEGIN PUBLIC KEY-----"（SPKI DER，44 字节：12 字节头 + 32 字节钥）
 * - "-----BEGIN X25519 PUBLIC KEY-----"（裸 32 字节 base64）
 * - 裸 base64（32 或 44 字节）
 */
export function parseFaultPublicKeyPem(pem: string): Uint8Array {
  if (!pem || pem.trim().length === 0) {
    throw new FaultCryptoError('公钥未配置（正式公钥待服务器块交付，fail-closed）');
  }
  const body = pem
    .replace(/-----BEGIN [A-Z0-9 ]+-----/g, '')
    .replace(/-----END [A-Z0-9 ]+-----/g, '')
    .replace(/\s+/g, '');
  let der: Uint8Array;
  try {
    der = base64ToBytes(body);
  } catch {
    throw new FaultCryptoError('公钥 PEM base64 解码失败');
  }
  if (der.length === 32) {
    return der;
  }
  if (der.length === 44) {
    // SPKI DER：固定 12 字节头 + 32 字节裸公钥（尾部 32 字节）
    return der.slice(der.length - 32);
  }
  throw new FaultCryptoError(`公钥长度不合法：期望 32/44 字节，得到 ${der.length}`);
}

/**
 * 盐派生（同时用作 AEAD AAD），与服务器 derive_salt 逐字节一致：
 * SHA-256(SALT_PREFIX || 0x00 || version_u32_be || 0x00 || hash_ascii || 0x00 || timestamp_u64_be)
 */
export function deriveSalt(version: number, machineCodeHash: string, timestampSec: number): Uint8Array {
  const parts: Uint8Array[] = [
    utf8StringToBytes(SALT_PREFIX),
    new Uint8Array([0x00]),
    u32be(version),
    new Uint8Array([0x00]),
    utf8StringToBytes(machineCodeHash),
    new Uint8Array([0x00]),
    u64be(timestampSec),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    buf.set(p, off);
    off += p.length;
  }
  return sha256(buf);
}

function u32be(v: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v, false);
  return b;
}

function u64be(v: number): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(v), false);
  return b;
}

function randomNonce12(): Uint8Array {
  const nonce = new Uint8Array(NONCE_LEN);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(nonce);
  } else {
    throw new FaultCryptoError('缺少 crypto.getRandomValues，无法安全生成 nonce');
  }
  return nonce;
}

/**
 * 将载荷对象一次性整体加密为信封。
 *
 * @param payload 可 JSON 序列化的载荷（description/logs/screenshots + 诊断字段整体打包）
 * @param publicKeyPem 接收方公钥 PEM；null/空 = 未配置（抛错，fail-closed）
 * @param opts.timestampSec 覆盖时间戳（秒；缺省取当前时间）—— 供确定性单测
 * @param opts.ephemeralSecretKey 覆盖临时私钥 —— 仅供单测复现（32 字节），运行时不传
 */
export function sealFaultReport(
  payload: unknown,
  publicKeyPem: string | null,
  opts?: { timestampSec?: number; ephemeralSecretKey?: Uint8Array },
): FaultEnvelope {
  if (!publicKeyPem || publicKeyPem.trim().length === 0) {
    throw new FaultCryptoError('公钥未配置（正式公钥待服务器块交付，fail-closed）');
  }

  const recipientPk = parseFaultPublicKeyPem(publicKeyPem);

  const ephemeral = opts?.ephemeralSecretKey
    ? { secretKey: opts.ephemeralSecretKey, publicKey: x25519.getPublicKey(opts.ephemeralSecretKey) }
    : x25519.keygen();
  const shared = x25519.getSharedSecret(ephemeral.secretKey, recipientPk);

  const nonce = randomNonce12();
  const timestamp = opts?.timestampSec ?? Math.floor(Date.now() / 1000);
  const machineCodeHash = extractMachineCodeHash(payload);
  const ephemeralPkB64 = bytesToBase64(ephemeral.publicKey);

  const salt = deriveSalt(FAULT_REPORT_ENVELOPE_VERSION, machineCodeHash, timestamp);
  const key = hkdf(sha256, shared, salt, utf8StringToBytes(HKDF_INFO), 32);

  const plaintext = utf8StringToBytes(JSON.stringify(payload));
  const aead = chacha20poly1305(key, nonce, salt);
  const sealed = aead.encrypt(plaintext);

  const appVersion = extractAppVersion(payload);
  return {
    version: FAULT_REPORT_ENVELOPE_VERSION,
    machine_code_hash: machineCodeHash,
    timestamp,
    nonce: bytesToBase64(nonce),
    ephemeral_public_key: ephemeralPkB64,
    ciphertext: bytesToBase64(sealed),
    ...(appVersion ? { app_version: appVersion } : {}),
  };
}

/**
 * 用对应私钥解密信封还原载荷 —— 仅供单测做往返/互操作验证，
 * 运行时 App 内不存在私钥，此路径不可达。
 */
export function openFaultReport(envelope: FaultEnvelope, recipientSecretKey: Uint8Array): unknown {
  const ephemeralPk = base64ToBytes(envelope.ephemeral_public_key);
  const nonce = base64ToBytes(envelope.nonce);
  const ciphertext = base64ToBytes(envelope.ciphertext);

  const shared = x25519.getSharedSecret(recipientSecretKey, ephemeralPk);
  const salt = deriveSalt(envelope.version, envelope.machine_code_hash, envelope.timestamp);
  const key = hkdf(sha256, shared, salt, utf8StringToBytes(HKDF_INFO), 32);
  const aead = chacha20poly1305(key, nonce, salt);
  const plaintext = aead.decrypt(ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext));
}

/** 从已组好的载荷里提取 machine_code_hash（载荷顶层字段，缺省视为非法） */
function extractMachineCodeHash(payload: unknown): string {
  if (payload && typeof payload === 'object' && 'machine_code_hash' in (payload as Record<string, unknown>)) {
    const v = (payload as Record<string, unknown>)['machine_code_hash'];
    if (typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)) {
      return v;
    }
  }
  throw new FaultCryptoError('载荷缺少合法 machine_code_hash（64 位小写 hex）');
}

/** 提取载荷顶层 app_version（可选明文索引字段） */
function extractAppVersion(payload: unknown): string | null {
  if (payload && typeof payload === 'object' && 'app_version' in (payload as Record<string, unknown>)) {
    const v = (payload as Record<string, unknown>)['app_version'];
    if (typeof v === 'string' && v.length > 0 && v.length <= 64) {
      return v;
    }
  }
  return null;
}
