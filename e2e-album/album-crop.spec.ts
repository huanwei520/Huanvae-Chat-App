/**
 * 硬判据：相册格子 / 查找记录九宫格里的每一张媒体，**原图四条边都在**（不裁切）。
 *
 * ## 为什么必须是真实浏览器
 * `object-fit` 在 jsdom 里**没有任何可观测行为**（无布局、无绘制引擎）——
 * vitest 怎么写都绿。同 .claude/rules/frontend-test.md「滚动 / 布局相关行为：
 * vitest 结构性测不出」一族。静态守卫 tests/styles/AlbumMediaObjectFit.test.ts
 * 只拦「有人把 contain 改回 cover」这类**声明层**回退，证明不了语义。
 *
 * ## 判据怎么设计的（逐字对应「原图的四条边都在」）
 * 测试图四角各放一块**唯一颜色**的方块（红 / 绿 / 蓝 / 黄），方块边长选得比
 * `cover` 会裁掉的量还小：
 *   - 9:16 竖图放进正方形格子，cover 上下各裁掉原图 350px；方块 120px ⇒ 四块全没
 *   - 4:3 横图放进正方形格子，cover 左右各裁掉原图 151px；方块 120px ⇒ 四块全没
 * 于是判据是二值的：**contain ⇒ 四色全在；cover ⇒ 四色全无**。
 * 取样方式是把格子截图喂回页面里的 canvas 逐像素扫（data: URL 不会污染 canvas），
 * 不做任何「按 object-fit 反推绘制盒」的自证推导。
 *
 * ## 取中间那一格
 * `.album-grid` 有 border-radius: 12px + overflow: hidden，会削掉**首尾格**的外侧圆角，
 * 连带削掉角落像素。故一律铺 3 格、只测 index=1 那一格 —— 它四个角都是直角，
 * 不需要为了测试去改被测 CSS 的圆角。
 *
 * ## 加载的是真 CSS
 * variables / main / album / search 四份**原文件**整份注入，不做任何裁剪或改写；
 * 唯一的 fixture 自由度是给容器一个固定宽度（内联 style，等价于 AlbumMessage 本来
 * 就用内联 style 写 grid-template-columns），让格子尺寸可复算。
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Playwright 以 ESM 跑 spec，`__dirname` 不存在（vitest 那边相反，见
// .claude/rules/frontend-test.md「静态扫描测试读源码：vitest 下用 __dirname」）。
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readCss = (rel: string) => readFileSync(resolve(REPO, rel), 'utf-8');

const REAL_CSS = [
  'src/styles/variables.css',
  'src/styles/pages/main.css',
  'src/styles/components/album.css',
  'src/styles/search.css',
].map(readCss).join('\n');

/** 四角标记色（纯色，互相之间以及与白底/浅蓝底都拉开足够距离） */
const CORNERS = {
  topLeft: [255, 0, 0],
  topRight: [0, 255, 0],
  bottomLeft: [0, 0, 255],
  bottomRight: [255, 255, 0],
} as const;

/** 角标边长（原图像素）；必须小于 cover 会裁掉的量，见文件头 */
const MARK = 120;

function markedImage(width: number, height: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<rect width="${width}" height="${height}" fill="#ffffff"/>`
    + `<rect x="0" y="0" width="${MARK}" height="${MARK}" fill="#ff0000"/>`
    + `<rect x="${width - MARK}" y="0" width="${MARK}" height="${MARK}" fill="#00ff00"/>`
    + `<rect x="0" y="${height - MARK}" width="${MARK}" height="${MARK}" fill="#0000ff"/>`
    + `<rect x="${width - MARK}" y="${height - MARK}" width="${MARK}" height="${MARK}" fill="#ffff00"/>`
    + '</svg>';
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf-8').toString('base64')}`;
}

const PORTRAIT = markedImage(900, 1600); // 9:16
const LANDSCAPE = markedImage(1200, 900); // 4:3

function albumPage(src: string): string {
  const cell = `<div class="album-cell">`
    + `<div class="file-message image-message" style="width:100%;height:100%">`
    + `<img class="message-image" src="${src}">`
    + '</div></div>';
  return `<body style="margin:0;background:#ffffff">
    <style>${REAL_CSS}</style>
    <div class="message-bubble other"><div class="bubble-content">
      <div class="album-grid" data-testid="album-grid"
           style="grid-template-columns: repeat(3, 1fr); width:480px; max-width:none">
        ${cell}${cell}${cell}
      </div>
    </div></div>
  </body>`;
}

function searchGridPage(src: string): string {
  const cell = '<div class="conv-msg-search-cell">'
    + `<img class="conv-msg-search-cover" src="${src}">`
    + '</div>';
  return `<body style="margin:0;background:#ffffff">
    <style>${REAL_CSS}</style>
    <div class="conv-msg-search-list conv-msg-search-list--grid" style="width:480px">
      ${cell}${cell}${cell}
    </div>
  </body>`;
}

/**
 * 把元素截图喂回页面用 canvas 逐像素扫，返回每个角标色命中的像素数。
 *
 * 不用「按 object-fit 算出绘制盒再断言」——那等于用我自己的推导去验浏览器的实现，
 * 推导写错就同时错两边。这里量的是**真的画出来了什么**。
 */
async function countCornerColors(
  page: import('@playwright/test').Page,
  selector: string,
  nth: number,
): Promise<Record<keyof typeof CORNERS, number>> {
  const shot = await page.locator(selector).nth(nth).screenshot();
  const dataUrl = `data:image/png;base64,${shot.toString('base64')}`;

  return page.evaluate(async ({ url, targets }) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) { throw new Error('2d context unavailable'); }
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const TOLERANCE = 60;
    const hits: Record<string, number> = {};
    for (const [name, rgb] of Object.entries(targets)) {
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (
          Math.abs(data[i] - rgb[0]) <= TOLERANCE
          && Math.abs(data[i + 1] - rgb[1]) <= TOLERANCE
          && Math.abs(data[i + 2] - rgb[2]) <= TOLERANCE
          && data[i + 3] > 200
        ) {
          n += 1;
        }
      }
      hits[name] = n;
    }
    return hits as Record<'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight', number>;
  }, { url: dataUrl, targets: CORNERS as unknown as Record<string, number[]> });
}

/** 四个角至少各有 3 个像素被画出来 —— 少于此就是那条边被裁掉了 */
const MIN_PIXELS = 3;

test.describe('相册格子：任取一张，原图四条边都在', () => {
  test('9:16 竖图（报障截图里被切成一条竖带的那种）四角全在', async ({ page }) => {
    await page.setContent(albumPage(PORTRAIT));
    await page.locator('.album-cell img').nth(1).evaluate((el: HTMLImageElement) => el.decode());

    const hits = await countCornerColors(page, '.album-cell', 1);
    expect(hits.topLeft).toBeGreaterThanOrEqual(MIN_PIXELS);
    expect(hits.topRight).toBeGreaterThanOrEqual(MIN_PIXELS);
    expect(hits.bottomLeft).toBeGreaterThanOrEqual(MIN_PIXELS);
    expect(hits.bottomRight).toBeGreaterThanOrEqual(MIN_PIXELS);
  });

  test('4:3 横图（报障截图里末位数字被右边缘吃掉的那种）四角全在', async ({ page }) => {
    await page.setContent(albumPage(LANDSCAPE));
    await page.locator('.album-cell img').nth(1).evaluate((el: HTMLImageElement) => el.decode());

    const hits = await countCornerColors(page, '.album-cell', 1);
    expect(hits.topLeft).toBeGreaterThanOrEqual(MIN_PIXELS);
    expect(hits.topRight).toBeGreaterThanOrEqual(MIN_PIXELS);
    expect(hits.bottomLeft).toBeGreaterThanOrEqual(MIN_PIXELS);
    expect(hits.bottomRight).toBeGreaterThanOrEqual(MIN_PIXELS);
  });

  test('视频封面帧同口径（真实级联算出来的 object-fit）', async ({ page }) => {
    // 封面帧走 <video> 的 poster，像素判据要等解码时序，稳定性不如 <img>；
    // 这里量的是**真实浏览器按真实 CSS 级联**算出来的 object-fit —— 它决定了裁不裁，
    // 与上面两条像素判据是同一条 CSS 规则（album.css 里图片与视频封面写在同一个选择器组）。
    await page.setContent(`<body style="margin:0"><style>${REAL_CSS}</style>
      <div class="album-grid" style="grid-template-columns: repeat(3, 1fr); width:480px; max-width:none">
        <div class="album-cell"><div class="file-message video-message" style="width:100%;height:100%">
          <video class="message-video-thumbnail"></video>
        </div></div>
      </div></body>`);

    const objectFit = await page.locator('video.message-video-thumbnail').evaluate(
      (el) => getComputedStyle(el).objectFit,
    );
    expect(objectFit).toBe('contain');
  });
});

test.describe('查找聊天记录九宫格：每一张都能看到完整的缩略图', () => {
  test('9:16 竖图四角全在', async ({ page }) => {
    await page.setContent(searchGridPage(PORTRAIT));
    await page.locator('.conv-msg-search-cover').nth(1).evaluate((el: HTMLImageElement) => el.decode());

    const hits = await countCornerColors(page, '.conv-msg-search-cell', 1);
    expect(hits.topLeft).toBeGreaterThanOrEqual(MIN_PIXELS);
    expect(hits.topRight).toBeGreaterThanOrEqual(MIN_PIXELS);
    expect(hits.bottomLeft).toBeGreaterThanOrEqual(MIN_PIXELS);
    expect(hits.bottomRight).toBeGreaterThanOrEqual(MIN_PIXELS);
  });

  test('4:3 横图四角全在', async ({ page }) => {
    await page.setContent(searchGridPage(LANDSCAPE));
    await page.locator('.conv-msg-search-cover').nth(1).evaluate((el: HTMLImageElement) => el.decode());

    const hits = await countCornerColors(page, '.conv-msg-search-cell', 1);
    expect(hits.topLeft).toBeGreaterThanOrEqual(MIN_PIXELS);
    expect(hits.topRight).toBeGreaterThanOrEqual(MIN_PIXELS);
    expect(hits.bottomLeft).toBeGreaterThanOrEqual(MIN_PIXELS);
    expect(hits.bottomRight).toBeGreaterThanOrEqual(MIN_PIXELS);
  });
});
