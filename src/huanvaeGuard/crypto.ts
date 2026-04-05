/**
 * X25519 密钥对生成与持久化
 *
 * 使用 tweetnacl 生成 Curve25519 密钥对，
 * 私钥持久化在 localStorage（后续可迁移到系统 keyring）
 */

import nacl from 'tweetnacl';

const STORAGE_KEY = 'hg_keypair';

export interface KeyPair {
  privateKey: string;
  publicKey: string;
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

export function generateKeyPair(): KeyPair {
  const kp = nacl.box.keyPair();
  return {
    privateKey: toBase64(kp.secretKey),
    publicKey: toBase64(kp.publicKey),
  };
}

export function getOrCreateKeyPair(): KeyPair {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as KeyPair;
      if (parsed.privateKey && parsed.publicKey) {
        // 验证可以 decode
        const sk = fromBase64(parsed.privateKey);
        if (sk.length === 32) return parsed;
      }
    } catch { /* regenerate */ }
  }

  const kp = generateKeyPair();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(kp));
  return kp;
}

export function clearKeyPair(): void {
  localStorage.removeItem(STORAGE_KEY);
}
