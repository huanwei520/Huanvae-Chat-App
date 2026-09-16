/**
 * 字节/编码工具（故障上报模块内部用）
 *
 * @module services/faultReport/bytes
 */

export function utf8StringToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function bytesToString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** 无依赖 base64 编码（兼容 jsdom / webview / worker） */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      B64_ALPHABET[(n >> 18) & 63] +
      B64_ALPHABET[(n >> 12) & 63] +
      B64_ALPHABET[(n >> 6) & 63] +
      B64_ALPHABET[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += `${B64_ALPHABET[(n >> 18) & 63]}${B64_ALPHABET[(n >> 12) & 63]}==`;
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += `${B64_ALPHABET[(n >> 18) & 63]}${B64_ALPHABET[(n >> 12) & 63]}${B64_ALPHABET[(n >> 6) & 63]}=`;
  }
  return out;
}

/** base64 解码（严格：非法字符抛错） */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/=+$/, '');
  const lookup = new Int8Array(128).fill(-1);
  for (let i = 0; i < B64_ALPHABET.length; i++) {
    lookup[B64_ALPHABET.charCodeAt(i)] = i;
  }
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    const idx = ch.charCodeAt(0) < 128 ? lookup[ch.charCodeAt(0)] : -1;
    if (idx < 0) {
      throw new Error(`invalid base64 character: ${JSON.stringify(ch)}`);
    }
    buffer = (buffer << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  if (bits >= 6) {
    throw new Error('invalid base64 length');
  }
  return new Uint8Array(out);
}
