/**
 * 群内私有备注显示名（D7）
 *
 * 优先级：我设的私有备注 → 群昵称/原显示名（fallback）。
 * fallback 由调用方传入（通常已是「群昵称 → 用户昵称」折叠后的展示名）。
 * 备注为空/空白时回退到 fallback。
 */
export function groupMemberDisplayName(remark: string | undefined, fallback: string): string {
  const r = remark?.trim();
  return r ? r : fallback;
}
