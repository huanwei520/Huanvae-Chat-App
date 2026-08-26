/**
 * NFC 指令执行器类型定义
 *
 * NfcAction：白名单解析后的结构化指令（miniapp/open + http/request + group/join）
 * TrustedNfcCard：与 Rust 后端 `nfc_trusted_cards` 表对应的信任记录
 * NfcScanResult：扫卡 + 解析后的完整结果，传给 modal / executor
 */

export type NfcAction =
  | { kind: 'miniapp/open'; miniappId: string }
  | { kind: 'http/request'; url: string; method: 'GET' | 'POST'; body: unknown | null }
  /**
   * 扫码加群落地（`huanvae://group/join?id=<uuid>`）。
   *
   * 这串就是**群二维码里编码的那串** —— 后端 `GET /api/groups/{id}/qr` 的 `payload` 逐字同形
   * （真值源：`backend-docs/groups/群聊管理.md`「获取群二维码」响应示例）。
   * 载体不限于 NFC：贴卡、把二维码内容粘进搜索框，走的都是这一条解析 + 派发。
   */
  | { kind: 'group/join'; groupId: string };

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
