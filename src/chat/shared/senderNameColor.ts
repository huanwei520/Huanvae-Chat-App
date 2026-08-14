/**
 * 群聊气泡内「发送者昵称」的配色索引（纯函数）
 *
 * @module chat/shared
 * @location src/chat/shared/senderNameColor.ts
 *
 * telegram 参照图里同一个群的不同发送者，名字是**不同颜色**的（红 / 橙 / 蓝…），
 * 这样一眼能把连着的几组分开。本模块只负责「这个人该用第几号颜色」这一件事：
 * 输入发送者 id，输出 `[0, SENDER_NAME_COLOR_COUNT)` 的整数；具体色值全部在 CSS
 * （`src/styles/components/chat-bubble-meta.css` 的 `--sender-name-N` 一组 token，
 * 深色主题另有一份覆盖），气泡只把索引写进 `data-sender-hue` 属性。
 *
 * 这么切分是为了两件事：
 * 1. **配色跟主题走** —— 色值留在 CSS 才能被 `[data-theme='dark']` 覆盖；写死在 TS 里就锁死了；
 * 2. **索引可单测** —— 纯函数、无 DOM、无 store，稳定性（同一 id 恒同色）能被断言钉住。
 *
 * 🔴 取 id 不取昵称：昵称会被改（群昵称 / 我设的私有备注 / 用户改名），
 * 拿它当输入会让同一个人在改名前后变色，甚至在同一屏里因为备注不同而不一致。
 */

/**
 * 可用配色数量。**必须与 CSS 里 `--sender-name-0 … --sender-name-6` 的条数一致** ——
 * 少一个就会有发送者拿到没有定义的 token（回退成继承色 = 看着像没上色）。
 * 单测 `senderNameColor.test.ts` 里有一条断言直接扫 CSS 数这个数，改一边会红。
 */
export const SENDER_NAME_COLOR_COUNT = 7;

/**
 * 发送者 id → 配色索引。
 *
 * djb2 变体：逐 UTF-16 code unit 累乘 33 相加，每步 `>>> 0` 保持在 32 位无符号区间
 * （不用 `hash * 31 + c` 那种会溢出到浮点、丢低位的写法）。
 * 结果只用来选颜色，不用于安全用途，抗碰撞不是目标 —— 只要**同一 id 恒得同一个数**。
 *
 * 空串 / null / undefined 一律落 0：拿不到 id 时给个稳定颜色，不抛错。
 */
export function senderNameColorIndex(senderId: string | null | undefined): number {
  const id = senderId ?? '';
  if (!id) { return 0; }

  let hash = 5381;
  for (let i = 0; i < id.length; i += 1) {
    hash = (((hash << 5) + hash) + id.charCodeAt(i)) >>> 0;
  }

  return hash % SENDER_NAME_COLOR_COUNT;
}
