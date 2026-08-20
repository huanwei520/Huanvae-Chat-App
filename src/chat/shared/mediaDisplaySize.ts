/**
 * 气泡内媒体的显示尺寸（纯函数模块，零依赖）
 *
 * @module chat/shared
 * @location src/chat/shared/mediaDisplaySize.ts
 *
 * 从 `FileMessageContent.tsx` 抽出来的两个纯函数。抽离的理由是可测性：
 * `FileMessageContent.tsx` 顶层拖着 useSession / fileCache / Tauri 一整条链，
 * 只为验一个「200x3000 该算成多大」要配一整套 mock
 * （见 .claude/rules/frontend-test.md「抽 pure function 的决策标准」）。
 *
 * 🔴 这两个函数是**同一条不变量的两半**，必须一起读：
 *   calculateDisplaySize 给的是**上限盒**（宽高都只是上限，不是定值）；
 *   mediaContainerStyle 负责把它翻译成「宽度上限 + max-width:100% + aspect-ratio」。
 * 谁单独用了前者的 height 去写内联绝对高度，缩窄时就会重新出现信箱空隙。
 */

import type { CSSProperties } from 'react';

/**
 * **可读下限**：容器（气泡里显示这张图的那个方框）的短边不允许低于这个像素数。
 * 短边够长 ⇒ 容器比例 = **原图比例**，零黑边；只有短边会跌破它时，容器才钉到
 * 「短边刚好等于下限」的那条比例，差额由黑底信箱带补齐。
 *
 * ## 为什么这一版把「比例阈值」整条删掉，换成一条地板
 *
 * 上一版是 `RATIO_WINDOW = 2.5`（窗口内按原比例、窗口外钉边界 letterbox）。它的**依据①**
 * 原文写的是「**滚动长截图普遍 1:4 以上** ⇒ 落窗口外 letterbox」——
 * 而 huanwei 2026-08-16 的判决点恰好是 `720×2880`（正好 1:4）：
 * 「其下方那个也不应当使用黑底，因为其只是更狭窄」。
 * ⇒ **那条依据与要求方向相反，不是把 2.5 调成 4.x 能救的**：只要判据还是「比例超过多少」，
 * 就还得继续在「哪种内容算长截图」上划线，而他给的判据根本不在比例这个维度上。
 *
 * 他的判据是**「气泡宽度由谁决定」**。落到纯图气泡这一路（宽度由图自己定），
 * 黑底存在的唯一正当理由 = **按真实比例渲染出来会「不可用」**：`100×5000` 塞进最大高度后
 * 宽度只剩几像素，气泡细成一条发丝。⇒ 判据是「按比例渲染后，**短边会不会跌破一个可读下限**」，
 * 与比例是多少无关。（另外两路不归本文件管：图+文组合气泡的黑底来自
 * `.media-bubble-media` 那条媒体带，相册的来自 `.album-cell` —— 两处都保留。）
 *
 * ## 这正是四家成熟 IM 的形状（gen23 调研 IMG-DISPLAY-RESEARCH.md）
 *
 * 四家可核样本里**没有一家有比例阈值**，而四家**都有**这条地板：
 * - Telegram Desktop `history_view_photo.cpp:250-252` —— 等比缩进 `430×430` 上限盒之后
 *   `qMax(scaled.width(), minWidth)` / `qMax(scaled.height(), st::minPhotoSize)`；
 *   `chat.style:162` `minPhotoSize: 100px`。盒被地板撑得与图不同比例时，才轮到裁 / 留白的决策。
 * - Telegram Android：高地板 `dp(120)`；Signal：`min_width 150dp` / `min_height 100dp`。
 * 我们与 Telegram Desktop 同形，只在「盒比例 ≠ 图比例」那一档的填充物上不同：它裁掉 ≤25%
 * 就裁满、超过才留白且填**模糊图**（`media_streaming_utility.h:77-78`）；
 * huanwei 明确要**纯黑且一个像素都不裁**（「塞不满的让其以黑色背景显示图片居中」
 * + `object-fit: contain`）。
 *
 * ## 为什么是 64
 *
 * 1. **上界由判决点钉死**：`720×2880` 在 320 的高度上限下短边 = `320 × 0.25 = 80px`，
 *    而它必须落在**无黑底**那一侧 ⇒ 地板必须 ≤ 80。
 * 2. **本仓已有的可读下限先例**：`chat-menu-sheet.css:174` 把「每格 >= 64px 仍放得下」
 *    当可接受下限 —— 不为这一处另立第二套尺度。
 * 3. **与 Telegram 的地板同量级**：它是 `100px` 配 `430px` 上限盒，按我们的宽度上限折算
 *    `280 × 100 / 430 ≈ 65px`。
 *
 * ⇒ 由这条地板**导出**的有效比例窗口是 `64/320 = 1:5` ～ `280/64 = 4.375:1`。
 * 它**不是第二个魔数**，是 `MIN_READABLE_SIDE` 与上限盒的商；上限盒换成别的值，窗口自己跟着走。
 * 判决点因此分档：`1:4`（短边 80px）在内、`1:5` 正好是边界、`200×3000`（1:15，短边 21px）在外。
 */
const MIN_READABLE_SIDE = 64;

/**
 * 计算显示**上限盒**（宽高都只是上限，不是定值）
 *
 * @param originalWidth - 原始宽度
 * @param originalHeight - 原始高度
 * @param maxWidth - 宽度上限（默认 280）
 * @param maxHeight - 高度上限（默认 320）
 * @returns 容器的目标宽高（真正落地的宽度还会被 `max-width: 100%` 按可用宽收缩）
 *
 * ## 🔴 一条规则（huanwei 2026-08-16：「其余的都按比例显示完整图片」，
 * 「除了极端比例不对的图片用黑底来协助显示外」，`720×2880`「只是更狭窄」不该有黑底）
 *
 * 记 `ar = W/H`，窗口两端都由 `MIN_READABLE_SIDE` 与上限盒导出（见其块注释）：
 * - **短边够长**（`floor/maxHeight ≤ ar ≤ maxWidth/floor`，默认上限盒下 = `0.2 ≤ ar ≤ 4.375`）：
 *   容器比例 = **原图比例** ⇒ 零黑边；
 * - **短边会跌破可读下限**：容器比例钉到「短边刚好等于下限」的那条边界，
 *   差额由 `object-fit: contain` + 黑底补齐 —— 正是他允许的那一档。
 *
 * 两支合成同一段算术：先求「以目标比例 `r` **恰好装下原图**的自然盒」，再等比缩进上限盒，
 * 且 `scale ≤ 1`（永不放大）。够长那支 `r === ar` ⇒ 自然盒就是原图本身，这段退化成
 * 「等比缩到同时满足 `宽 ≤ maxWidth` 且 `高 ≤ maxHeight`」。
 *
 * ⚠️ `scale ≤ 1` 与地板的先后顺序是有意的：地板只钉**比例**、不钉**像素**，所以本身就比
 * 上限盒小的图（`20×300`）只按比例 letterbox 到 `60×300`，**不会被放大到 64 宽** ——
 * 「永不放大」这条不变量优先于地板。
 *
 * ### 🔴 为什么不能简单回退到「先卡宽再卡高」（那是这一版之前的两条规则之一）
 *
 * 上一版是「只截高、宽度不动」，它自己是为了修更早那版「先卡宽、再卡高」——
 * 后者会把 200×3000 算成 **20×300 的细条**（不是被裁，是被算小了）。
 * 本版必须**同时**满足两头：窗口内不再落进统一盒（`1080×2400` → 144×320 而不是 280×320），
 * 且窗口外也不回细条（`200×3000` → **128×320**，画面 21×320 居中，黑边比上一版的
 * 280×320 少一半）。两个方向在 tests/unit/mediaDisplaySize.test.ts 各有用例。
 *
 * ⚠️ 返回值**不再**内联成容器的绝对宽高，调用方一律用
 * `{ width, maxWidth: '100%', aspectRatio }` —— 绝对宽度在窄屏上会溢出气泡、
 * 被 `.bubble-content { overflow: hidden }` 裁掉角（这正是他那张真机图里的缺角）。
 * 用 `aspectRatio` 承担高度后，宽度收缩时高度自己跟着收，仍然「加载完不跳版」。
 */
export function calculateDisplaySize(
  originalWidth: number,
  originalHeight: number,
  maxWidth = 280,
  maxHeight = 320,
): { width: number; height: number } {
  if (originalWidth <= 0 || originalHeight <= 0) {
    return { width: maxWidth, height: maxHeight };
  }

  const aspectRatio = originalWidth / originalHeight;

  // 可读下限导出的比例窗口 —— 不是独立常量：上限盒一变，两端自己跟着变。
  // `floor` 再对上限盒取一次 min，保证 `minBoxRatio ≤ 1 ≤ maxBoxRatio`；否则调用方给一个
  // 比地板还小的上限盒时窗口会左右倒置，clamp 退化成「恒返回上界」而不是钉边界。
  const floor = Math.min(MIN_READABLE_SIDE, maxWidth, maxHeight);
  const minBoxRatio = floor / maxHeight;
  const maxBoxRatio = maxWidth / floor;
  // 容器比例：短边够长就取原图比例（零黑边），会跌破下限才钉到那条边界（letterbox 只留这一档）
  const boxRatio = Math.min(Math.max(aspectRatio, minBoxRatio), maxBoxRatio);

  // 以 boxRatio 恰好装下原图的「自然盒」：图比盒窄就由高定宽，否则宽度就是原宽。
  // 短边够长时 boxRatio === aspectRatio ⇒ 自然盒 === 原图，两支在此汇合。
  const naturalWidth = aspectRatio >= boxRatio ? originalWidth : originalHeight * boxRatio;
  const naturalHeight = naturalWidth / boxRatio;

  // 等比缩进上限盒；`1` 那一项保证永不放大（小图仍按原尺寸显示）
  const scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight, 1);

  return {
    width: Math.round(naturalWidth * scale),
    height: Math.round(naturalHeight * scale),
  };
}

/**
 * 气泡态媒体容器的样式：宽度给**上限**、高度交给 `aspect-ratio`。
 *
 * 三处调用点（图片 / 视频 / 在途占位）必须**共用这一个函数** —— 上一版三处各写一遍
 * `{ width: displaySize.width, height: displaySize.height }`，改的时候漏了一处
 * 症状是「只有那一种消息还缺角」，与没改完全同形。
 */
export function mediaContainerStyle(displaySize: { width: number; height: number }): CSSProperties {
  return {
    width: displaySize.width,
    // 窄屏（可用宽 < 280）上按可用宽收缩，而不是溢出后被气泡裁掉角
    maxWidth: '100%',
    // 高度由比例导出：宽度一收缩高度跟着收，四角始终完整可见
    aspectRatio: `${displaySize.width} / ${displaySize.height}`,
  };
}
