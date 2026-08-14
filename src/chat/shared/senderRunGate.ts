/**
 * 群聊「连续同一人多条消息」的头像 / 昵称挂载门控（纯逻辑）
 *
 * @module chat/shared
 * @location src/chat/shared/senderRunGate.ts
 *
 * 产品口径（huanwei 2026-08-14 拍板，昵称一条是同日按 telegram 参照图订正的）：
 * - 同一个人**连续**发的若干条合并成一「组」，头像**只挂该组最新那条**（视觉最下面那条）；
 * - 组内其余各条**留出头像位**（`.bubble-avatar--hole`，`visibility:hidden`），保持气泡左缘对齐；
 * - **昵称只显示在该组最旧那条**（视觉最上面那条）—— 与头像**分处一组的两端**，
 *   正是参照图里 telegram 的形态：名字在一组的顶部、头像在一组的底部。
 *
 * ⚠️ 本文件原先写的是「组内一个昵称都不显示」（方案 C 的原始口径）。
 * 2026-08-14 总管按 huanwei 亲手发来的 telegram 参照图裁决：**群聊要显示发送者昵称**，
 * 「不显昵称」只是我们内部的编号约定，与他给的实图冲突时以实图为准。故该句已作废，
 * 改由 {@link senderNameAnchorKeys} 提供「每组只显示一次」的锚点。
 *
 * 断组的**唯一**条件：中间出现了别人的消息。**没有时间窗**，没有任何其它条件。
 *
 * ## 三条边界（与方案文档 §4.1 同口径，不是本文件自己发明的）
 *
 * 1. **撤回的消息断组**：撤回态渲染的是一条居中系统行（`recall-system-row`），既不是 own
 *    也不是 other。不断组会出现「头像跨过一条系统行去贴下面那条」的怪相。
 *    实现上把它的 `senderKey` 记成 `null` —— `null` 与任何发送者都不相等，自然断组，
 *    且它自己永远不会成为头像锚点。
 * 2. **相册（media_group）算一条**：调用方传进来的已经是**折叠后的渲染节点**，一个相册
 *    就是一个节点，本函数不关心它底下有几条消息。
 * 3. **自己发的一样合并**：huanwei 说的是「一个人连续发送多条」，没有区分是不是自己。
 *
 * ## 顺序契约（写错会静默把头像挂到组的另一端）
 *
 * 传入的数组必须是**列表真正渲染的那一组代表节点**、且为 **DESC（新 → 旧）**顺序 ——
 * 与 `GroupChatMessages` 的 `sortedMessages` / `renderNodes` 同源同序。列表是
 * `column-reverse`，DESC 的 index 0 落在视觉最底 ⇒ 「组内最新那条」= 组里 **index 最小**那条
 * = 本函数扫描时**每组第一个遇到的**那个节点。
 *
 * ⚠️ 性能：与 `readReceiptGate` 同一形状 —— 必须在列表 map **之外** O(n) 算一次，
 * 不能每条消息各扫一遍全量（O(n²)）。
 */

/** 门控所需的最小节点形状 */
export interface SenderRunNode {
  /** 该节点在列表里的稳定 key（相册用 `album-<groupId>`，单条用 getStableKey） */
  key: string;
  /**
   * 发送者标识；`null` = 该节点不参与分组也不挂头像（撤回态）。
   * 调用方负责把撤回态映射成 `null`，本函数不认识 `is_recalled` 这个字段。
   */
  senderKey: string | null;
}

/**
 * 在 **DESC（新 → 旧）** 的渲染节点列表里，算出「每一组该挂头像的那个节点」的 key 集合。
 *
 * 不在集合里的节点 = 组内的非最新条 ⇒ 由气泡渲染一个同尺寸的占位孔（留空位不显头像）。
 */
export function avatarAnchorKeys(nodes: readonly (SenderRunNode | undefined)[]): Set<string> {
  const anchors = new Set<string>();
  // 上一个（更新的）节点的发送者；undefined = 还没开始扫
  let previousSender: string | null | undefined;

  for (const node of nodes) {
    if (!node) { continue; }
    if (node.senderKey === null) {
      // 撤回态：自己不挂头像，且把「上一个发送者」清空 ⇒ 它下面那条必然重新起一组
      previousSender = null;
      continue;
    }
    if (node.senderKey !== previousSender) {
      anchors.add(node.key);
    }
    previousSender = node.senderKey;
  }

  return anchors;
}

/**
 * 在同一份 **DESC（新 → 旧）** 节点列表里，算出「每一组该显示昵称的那个节点」的 key 集合。
 *
 * 昵称挂**组内最旧那条**（视觉最上面那条），与 {@link avatarAnchorKeys} 的头像锚点
 * （组内最新 / 视觉最下面）分处一组的两端 —— 这就是 telegram 参照图里的形态。
 * 一人连发 3 条 ⇒ 昵称只出现 1 次，不会出现 3 次。
 *
 * 实现上是同一套扫描，只是**反着走**：DESC 数组倒着遍历就是 ASC（旧 → 新），
 * 于是「每组第一个遇到的」从「组内最新」变成「组内最旧」。分组规则逐字复用上面那套
 * （`senderKey === null` 的撤回行断组、且自己永不成为锚点），两个集合不可能对同一组给出
 * 不一致的分界。
 */
export function senderNameAnchorKeys(nodes: readonly (SenderRunNode | undefined)[]): Set<string> {
  const anchors = new Set<string>();
  // 上一个（更旧的）节点的发送者；undefined = 还没开始扫
  let previousSender: string | null | undefined;

  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i];
    if (!node) { continue; }
    if (node.senderKey === null) {
      // 撤回态：自己不显示昵称，且把「上一个发送者」清空 ⇒ 它上面那条必然重新起一组
      previousSender = null;
      continue;
    }
    if (node.senderKey !== previousSender) {
      anchors.add(node.key);
    }
    previousSender = node.senderKey;
  }

  return anchors;
}
