/**
 * 账号列表排序 —— 登录页账号选择器「上次登录的账号排第一」
 *
 * 纯函数模块：无 Tauri / React 依赖，可直接单测（tests/unit/accountOrder.test.ts）。
 */

import type { SavedAccount } from '../types/account';

/**
 * 账号排序用的「最近一次登录时刻」（毫秒时间戳，越大越新）
 *
 * 回落 `created_at` 的理由（不是"以防万一"的兜底，是必要的数据迁移处理）：
 * `last_login_at` 是后加字段，**存量 accounts.json 里根本没有这一项**（Rust 侧
 * `serde(default)` → None → 下发 `null`）。这些账号在下一次登录成功之前无从得知真实的
 * 登录时刻，`created_at`（账号保存时刻，也就是上一次手动登录写入的时刻）是唯一可得的
 * 近似值。所有账号各完成一次登录后，该分支自然不再命中。
 *
 * 解析失败记为 0（排最旧）：比较器一旦返回 NaN，Array#sort 的结果就是不确定的。
 */
export function getAccountRecencyKey(account: SavedAccount): number {
  const raw = account.last_login_at ?? account.created_at;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * 按「最近登录」倒序排列账号（上次登录的排第一）
 *
 * 返回新数组，不改动入参；时刻相同的账号保持原有相对顺序（Array#sort 稳定）。
 */
export function sortAccountsByLastLogin(accounts: SavedAccount[]): SavedAccount[] {
  return [...accounts].sort((a, b) => getAccountRecencyKey(b) - getAccountRecencyKey(a));
}
