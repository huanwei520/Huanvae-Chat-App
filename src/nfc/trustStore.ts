/**
 * NFC 信任卡的薄 invoke 包装层
 *
 * 直接调用 Rust 端 `db_nfc_*` 命令，不在前端再缓存（每次扫卡都查 SQLite）。
 * 选择 invoke 直调而非走 src/db/index.ts 是为了避免双层包装；
 * 信任表与会话/消息表的预览防抖通知逻辑无关。
 */

import { invoke } from '@tauri-apps/api/core';
import type { TrustedNfcCard } from './types';

export const trustStore = {
  /** 查询 (uid, payload_hash) 是否已信任 */
  isTrusted: (uid: string, payloadHash: string): Promise<boolean> =>
    invoke('db_nfc_is_trusted', { uid, payloadHash }),

  /** 添加信任记录（覆盖式；createdAt 用 Date.now() 毫秒） */
  addTrusted: (uid: string, payloadHash: string, actionSummary: string): Promise<void> =>
    invoke('db_nfc_add_trusted', {
      uid,
      payloadHash,
      actionSummary,
      createdAt: Date.now(),
    }),

  /** 列出所有信任记录（按 created_at 倒序） */
  listTrusted: (): Promise<TrustedNfcCard[]> => invoke('db_nfc_list_trusted'),

  /** 移除指定信任记录 */
  removeTrusted: (uid: string, payloadHash: string): Promise<void> =>
    invoke('db_nfc_remove_trusted', { uid, payloadHash }),
};
