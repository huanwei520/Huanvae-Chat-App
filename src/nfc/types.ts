/**
 * NFC 指令执行器类型定义
 *
 * NfcAction：白名单解析后的结构化指令（v1 仅 miniapp/open + http/request）
 * TrustedNfcCard：与 Rust 后端 `nfc_trusted_cards` 表对应的信任记录
 * NfcScanResult：扫卡 + 解析后的完整结果，传给 modal / executor
 */

export type NfcAction =
  | { kind: 'miniapp/open'; miniappId: string }
  | { kind: 'http/request'; url: string; method: 'GET' | 'POST'; body: unknown | null };

export interface TrustedNfcCard {
  uid: string;
  payload_hash: string;
  action_summary: string;
  created_at: number;
}

export interface NfcScanResult {
  /** tag.id bytes 转 hex（小写无前缀） */
  uid: string;
  /** 解码后的完整 URI，如 huanvae://miniapp/open?id=xxx */
  rawUri: string;
  /** SHA-256 hex of 整个 NDEF payload bytes（含 prefix code byte） */
  payloadHash: string;
  /** 白名单解析后的结构化指令 */
  action: NfcAction;
}
