/**
 * mediaDisplaySize —— 气泡内媒体的显示尺寸
 * （A1「不硬撑黑边」2026-08-14 → 单⑭「按 Telegram 方案收窄黑底」2026-08-16）
 *
 * 被测对象 src/chat/shared/mediaDisplaySize.ts，两个纯函数：
 *   calculateDisplaySize  给上限盒：短边够长 ⇒ 容器比例 = 原图比例（零黑边）；
 *                         短边会跌破 MIN_READABLE_SIDE 才钉到那条边界并 letterbox
 *   mediaContainerStyle   把上限盒翻译成「width + max-width:100% + aspect-ratio」
 *
 * 🔴 本文件必须**同时**守住三个方向（缺一个就会把另一个改回去）：
 *   ① 够长那侧不落进「统一的大盒」—— 任意竖版截图都不该再算成 280×320；
 *   ② 判决点 `720×2880`（1:4）必须**零黑边** —— 上一版的 `RATIO_WINDOW=2.5` 把它判成
 *      letterbox，huanwei 2026-08-16 明确说「只是更狭窄」不该有黑底；
 *   ③ 真极端（`200×3000` / `100×5000`）**仍然 letterbox**，且绝不回「细条」
 *      （更早那版把 200×3000 算成 20×300）。
 *   ②③ 方向相反：只验「黑边没了」时，【改对了】与【放宽过头】输出完全同形。
 *
 * 🔴 这一层只能守「算得对不对」。**真实像素上还剩多少黑边、加载完那一帧会不会跳版，
 * jsdom 结构性测不出**（无布局引擎，getBoundingClientRect 恒 0，
 * 见 .claude/rules/frontend-test.md「滚动 / 布局相关行为」）—— 那一半只能靠真机。
 * 另外两条黑底来源（图+文组合气泡的 `.media-bubble-media`、相册的 `.album-cell`）
 * 都是 **CSS 层**、不经本函数，本文件测不到它们，也没有改动它们。
 */

import { describe, it, expect } from 'vitest';
import { calculateDisplaySize, mediaContainerStyle } from '../../src/chat/shared/mediaDisplaySize';

/** 容器比例（保留 3 位小数，抵消 Math.round 的整像素误差） */
const ratioOf = (s: { width: number; height: number }) => Number((s.width / s.height).toFixed(3));
/** 容器短边 —— 可读下限这条判据量的就是它 */
const shortSide = (s: { width: number; height: number }) => Math.min(s.width, s.height);

/**
 * 「零黑边」的判据：容器与画面同比例 ⇒ object-fit: contain 之下一个黑像素都不剩。
 *
 * 🔴 不能写成 `ratioOf(size) === w / h`：容器宽高各被 `Math.round` 取整一次，
 * 3 位小数的比例会因此差在第三位（`800×1200 → 213×320`，`0.666` vs `0.667`），
 * 那是**取整误差**不是黑边。所以两个方向各允许 1px：容器宽必须就是「按容器高
 * 还原出来的画面宽」±1，反之亦然。
 *
 * 判别力（这条判据必须能把 letterbox 判 false，否则它守不住反向乙）：
 *   `200×3000 → 64×320`，还原宽 21.3 ⇒ 差 42.7px ⇒ false；
 *   旧实现给判决点的 `128×320`，还原宽 80 ⇒ 差 48px ⇒ false。
 */
const isZeroLetterbox = (
  s: { width: number; height: number },
  w: number,
  h: number,
) => Math.abs(s.width - (s.height * w) / h) <= 1 && Math.abs(s.height - (s.width * h) / w) <= 1;

describe('calculateDisplaySize —— 短边够长：容器比例 = 原图比例，零黑边', () => {
  it('16:9 横图：卡到宽度上限，高度按比例', () => {
    expect(calculateDisplaySize(1280, 720)).toEqual({ width: 280, height: 158 });
  });

  it('🔴 竖版手机截图不再被撑成统一的 280×320（1080×2400，ar=0.45）', () => {
    const size = calculateDisplaySize(1080, 2400);

    expect(size).toEqual({ width: 144, height: 320 });
    // 反向断言：一旦又变回 280 宽，就说明「高度截断把容器比例改成了盒子比例」回来了
    expect(size.width).not.toBe(280);
    // 容器比例必须就是原图比例 ⇒ object-fit: contain 之下一个黑像素都不剩
    expect(isZeroLetterbox(size, 1080, 2400)).toBe(true);
  });

  it('🔴 换一张竖版截图不会落到同一个盒子里（iPhone 1179×2556 与上一条结果不同）', () => {
    const a = calculateDisplaySize(1080, 2400);
    const b = calculateDisplaySize(1179, 2556);

    expect(b).toEqual({ width: 148, height: 320 });
    // 「统一的大小」的判据就是这一条：两张不同比例的竖图必须给出不同的容器
    expect(b).not.toEqual(a);
  });

  it('🔴 判决点：720×2880（1:4）零黑边 —— 上一版 RATIO_WINDOW=2.5 在这里给 128×320', () => {
    const size = calculateDisplaySize(720, 2880);

    expect(size).toEqual({ width: 80, height: 320 });
    // 容器比例 === 画面比例 ⇒ contain 之下没有任何信箱带
    expect(isZeroLetterbox(size, 720, 2880)).toBe(true);
    // 上一版把它钉到 1/2.5 边界 ⇒ 128 宽 + 48px 黑。这条盯死那个回归
    expect(size.width).not.toBe(128);
    // 它之所以在「零黑边」这侧，是因为短边 80px 高于可读下限 64px（余量 16px，不是擦边）
    expect(shortSide(size)).toBeGreaterThan(64);
  });

  it('🔴 回归基线：800×1200（2:3）本来就无黑底，必须保持', () => {
    const size = calculateDisplaySize(800, 1200);

    expect(size).toEqual({ width: 213, height: 320 });
    expect(isZeroLetterbox(size, 800, 1200)).toBe(true);
  });

  it('近方形（1000×1000）零黑边，且不被撑成 280×320', () => {
    const size = calculateDisplaySize(1000, 1000);

    expect(size).toEqual({ width: 280, height: 280 });
    expect(ratioOf(size)).toBe(1);
  });

  it('🔴 3:1 全景（3840×1080）现在也零黑边 —— 旧窗口（2.5:1）把它判成 letterbox', () => {
    const size = calculateDisplaySize(3840, 1080);

    expect(size).toEqual({ width: 280, height: 79 });
    expect(isZeroLetterbox(size, 3840, 1080)).toBe(true);
    // 旧实现钉到 2.5:1 ⇒ 280×112；宽高比回到 2.5 就是旧窗口回来了
    expect(ratioOf(size)).not.toBe(2.5);
  });

  it('ar = 2.5（1000×400）按原比例（旧窗口的上边界，现在只是普通一档）', () => {
    const size = calculateDisplaySize(1000, 400);

    expect(size).toEqual({ width: 280, height: 112 });
    expect(ratioOf(size)).toBe(2.5);
  });

  it('ar = 0.4（400×1000）按原比例（旧窗口的下边界，现在只是普通一档）', () => {
    const size = calculateDisplaySize(400, 1000);

    expect(size).toEqual({ width: 128, height: 320 });
    expect(ratioOf(size)).toBe(0.4);
  });

  it('高度上限是 320：1:2 竖图（500×1000）按原比例缩到 160×320', () => {
    const size = calculateDisplaySize(500, 1000);

    expect(size).toEqual({ width: 160, height: 320 });
    expect(size.height).toBe(320);
  });

  it('比原始尺寸小于上限时不放大', () => {
    expect(calculateDisplaySize(120, 90)).toEqual({ width: 120, height: 90 });
  });

  it('尺寸缺失（<= 0）→ 退到上限盒本身', () => {
    expect(calculateDisplaySize(0, 0)).toEqual({ width: 280, height: 320 });
    expect(calculateDisplaySize(-1, 100)).toEqual({ width: 280, height: 320 });
  });

  it('自定义上限被尊重', () => {
    expect(calculateDisplaySize(1000, 1000, 100, 100)).toEqual({ width: 100, height: 100 });
  });
});

describe('calculateDisplaySize —— 短边跌破可读下限：letterbox，且绝不回细条', () => {
  it('🔴 超高长截图（200×3000，1:15）letterbox，短边正好钉在可读下限 64', () => {
    const size = calculateDisplaySize(200, 3000);

    expect(size).toEqual({ width: 64, height: 320 });
    // 容器比例 ≠ 画面比例 ⇒ 这一档确实还在补黑（反向乙：没有放宽过头）
    expect(isZeroLetterbox(size, 200, 3000)).toBe(false);
    // 更早那版「先卡宽再卡高」在这里给 20×300 —— 高度掉出 320 就是它回来了
    expect(size.height).toBe(320);
    // 地板的定义就是这条：钉边界之后短边恰好等于下限，不多补一个像素
    expect(shortSide(size)).toBe(64);
  });

  it('🔴 总管举的极端例（100×5000，1:50）仍然 letterbox', () => {
    const size = calculateDisplaySize(100, 5000);

    expect(size).toEqual({ width: 64, height: 320 });
    expect(isZeroLetterbox(size, 100, 5000)).toBe(false);
  });

  it('🔴 600×9000 同样钉到可读下限，而不是上一版的 280×320 统一大盒', () => {
    const size = calculateDisplaySize(600, 9000);

    expect(size).toEqual({ width: 64, height: 320 });
    expect(size.width).not.toBe(280);
  });

  it('超宽极端（3000×200，ar=15）钉到 4.375:1，短边 = 64', () => {
    const size = calculateDisplaySize(3000, 200);

    expect(size).toEqual({ width: 280, height: 64 });
    expect(isZeroLetterbox(size, 3000, 200)).toBe(false);
    expect(shortSide(size)).toBe(64);
  });

  it('边界两侧连续：ar 从 0.200 迈到 0.195 时容器尺寸不跳变', () => {
    const inside = calculateDisplaySize(200, 1000);   // ar = 0.200 = 64/320，正好在界上
    const outside = calculateDisplaySize(195, 1000);  // ar = 0.195，界外

    expect(inside).toEqual({ width: 64, height: 320 });
    expect(outside).toEqual(inside);
  });

  it('🔴「永不放大」优先于地板：20×300 letterbox 到 60×300，不被撑到 64 宽', () => {
    // 地板钉的是**比例**不是像素；本身就比上限盒小的图只按比例补黑，绝不放大
    expect(calculateDisplaySize(20, 300)).toEqual({ width: 60, height: 300 });
  });
});

describe('calculateDisplaySize —— 触发档不是写死的比例，而是由可读下限 ÷ 上限盒导出', () => {
  it('🔴 同一张图（150×1000，ar=0.15）在 320 高上限下 letterbox，在 640 高上限下零黑边', () => {
    const tight = calculateDisplaySize(150, 1000, 280, 320);
    const roomy = calculateDisplaySize(150, 1000, 280, 640);

    // 320 高：短边只有 48px < 64 ⇒ 钉到 0.2 补黑
    expect(tight).toEqual({ width: 64, height: 320 });
    expect(isZeroLetterbox(tight, 150, 1000)).toBe(false);

    // 640 高：同一比例的短边有 96px ⇒ 够长，按原比例，零黑边
    expect(roomy).toEqual({ width: 96, height: 640 });
    expect(isZeroLetterbox(roomy, 150, 1000)).toBe(true);

    // 判据本身：如果触发档是写死的比例阈值，这两个结果的「有没有黑边」会一模一样
    expect(ratioOf(tight)).not.toBe(ratioOf(roomy));
  });

  it('🔴 上限盒比地板还小时窗口不倒置：40×40 的方图仍是 40×40（不是 25×40）', () => {
    // 少了 `Math.min(MIN_READABLE_SIDE, maxWidth, maxHeight)` 那层夹取，
    // minBoxRatio(1.6) > maxBoxRatio(0.625) ⇒ clamp 退化成恒返回上界 ⇒ 方图被压成 25×40
    expect(calculateDisplaySize(1000, 1000, 40, 40)).toEqual({ width: 40, height: 40 });
  });
});

describe('mediaContainerStyle', () => {
  it('🔴 用相对量承担收缩：给 max-width 100% + aspect-ratio，绝不写内联绝对 height', () => {
    const style = mediaContainerStyle({ width: 280, height: 158 });

    expect(style.width).toBe(280);
    expect(style.maxWidth).toBe('100%');
    expect(style.aspectRatio).toBe('280 / 158');
    // 反向断言（防「两行并存」蒙混）：写死高度会让窄屏收缩时高度不跟着走 → 又出现信箱空隙
    expect(style.height).toBeUndefined();
  });

  it('短边够长时容器比例就是画面比例（判决点 720×2880 ⇒ contain 之下无黑边）', () => {
    const size = calculateDisplaySize(720, 2880);

    expect(mediaContainerStyle(size).aspectRatio).toBe('80 / 320');
  });

  it('跌破下限那一档比例才与画面不同（靠 object-fit contain 补黑边）', () => {
    const size = calculateDisplaySize(600, 9000);

    expect(mediaContainerStyle(size).aspectRatio).toBe('64 / 320');
  });
});
