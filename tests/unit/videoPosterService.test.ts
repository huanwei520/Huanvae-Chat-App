/**
 * 视频封面编排层（src/services/videoPoster.ts）的行为契约
 *
 * 覆盖验收里那两条：**缓存命中 ⇒ 不发起截帧**（在组件层测，见
 * tests/components/VideoThumbnailPoster.test.tsx）、**未命中 ⇒ 只截一次后写入**（本文件）。
 *
 * 截帧本体（`services/videoPosterCapture.ts` 的**取像素**部分）在这里被 mock 掉：jsdom 的
 * `<video>` 不解码、不 seek，`canvas.toBlob` 也没实现 —— 那一层属于结构性盲区，只能靠真机验，
 * 见该模块头与 .claude/rules/frontend-test.md。本文件测的是**编排**：
 * 键是什么、去不去重、失败会不会无限重试、并发上限有没有生效、**黑帧会不会被写进缓存**。
 *
 * 🔴 **黑帧那两条测的是真判据，不是 mock**：下面的 `vi.mock` 用
 * `importOriginal()` 展开原模块，**只覆盖两个碰 DOM 的函数**
 * （`captureVideoFrame` / `readImagePixels`），
 * `isNearlyBlackFrame` / `analyzeFrameLuma` 保持**原实现**。
 * 于是「喂一个纯黑像素缓冲进去 ⇒ 不落盘」是端到端跑过真闸门的断言。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CapturedFrame } from '../../src/services/videoPosterCapture';

const core = vi.hoisted(() => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((p: string) => `asset://localhost/${p}`),
  Channel: class {},
}));
vi.mock('@tauri-apps/api/core', () => core);

const capture = vi.hoisted(() => ({
  captureVideoFrame: vi.fn(),
  readImagePixels: vi.fn(),
}));
vi.mock('../../src/services/videoPosterCapture', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/videoPosterCapture')>()),
  ...capture,
}));

const { loadVideoPosterSrc, captureAndSaveVideoPoster } = await import(
  '../../src/services/videoPoster'
);

/** 一个**有内容**的帧：白像素 ⇒ 真判据一定放行（与"黑帧"用例形成正反两面） */
function litFrame(bytes: number[]): CapturedFrame {
  return {
    bytes: new Uint8Array(bytes),
    pixels: new Uint8ClampedArray([255, 255, 255, 255]),
  };
}

/** 一个**纯黑 / 全透明**的帧：全 0 缓冲，正是 Android 硬解失效时拿到的形态 */
function blackFrame(bytes: number[], pixelCount = 64): CapturedFrame {
  return {
    bytes: new Uint8Array(bytes),
    pixels: new Uint8ClampedArray(pixelCount * 4), // 全 0 = RGB 0 且 alpha 0
  };
}

/**
 * 把当前排队的 microtask 全部放干。
 *
 * 信号量的"名额转交"要连跳几个 microtask（releaseSlot → 唤醒 acquireSlot 里的 await →
 * acquireSlot 这个 async 函数返回 → 调用处的 await 恢复），跳数是实现细节。
 * 用一次 `setTimeout(0)`（宏任务）等，比数 `await Promise.resolve()` 的次数稳，
 * 也不会因为把 async 包装层去掉一层就假红。
 */
function flush(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** 一个可以从外面 resolve/reject 的 Promise（用来把截帧挂住，观察并发/去重） */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * 每个用例用**独立**的 fileHash。
 *
 * 模块内的「本会话失败过就不再重试」集合与「在途任务表」都按 fileHash 记，且**故意**没有
 * 对外的重置口（那会是只为测试存在的生产代码）。用例间用不同的键即天然隔离。
 */
let hashSeq = 0;
const nextHash = (tag: string) => `hash-${tag}-${(hashSeq += 1)}`;

beforeEach(() => {
  core.invoke.mockReset();
  capture.captureVideoFrame.mockReset();
  capture.readImagePixels.mockReset();
  // 默认：读不出像素 ⇒ 自愈判据保持现状（不删缓存），与既有用例的语义一致
  capture.readImagePixels.mockResolvedValue(null);
  core.convertFileSrc.mockImplementation((p: string) => `asset://localhost/${p}`);
});

describe('loadVideoPosterSrc：只读本地索引，键是 fileHash', () => {
  it('命中：按 fileHash 查，落盘路径经同一条 asset 显示通道转成 src', async () => {
    const fileHash = nextHash('hit');
    core.invoke.mockResolvedValue('/data/u_s/file/posters/x.jpg');

    const src = await loadVideoPosterSrc(fileHash);

    expect(core.invoke).toHaveBeenCalledWith('get_video_poster_path', { fileHash });
    expect(core.convertFileSrc).toHaveBeenCalledWith('/data/u_s/file/posters/x.jpg');
    expect(src).toBe('asset://localhost//data/u_s/file/posters/x.jpg');
  });

  it('未命中：Rust 返回 null ⇒ null，且不去碰显示通道', async () => {
    core.invoke.mockResolvedValue(null);
    expect(await loadVideoPosterSrc(nextHash('miss'))).toBeNull();
    expect(core.convertFileSrc).not.toHaveBeenCalled();
  });

  it('Rust 侧报错不外抛（缩略图该退回 <video>，不是整棵树崩掉）', async () => {
    core.invoke.mockRejectedValue(new Error('数据库未初始化'));
    expect(await loadVideoPosterSrc(nextHash('err'))).toBeNull();
  });

  it('空 fileHash 直接返回 null，不发 IPC', async () => {
    expect(await loadVideoPosterSrc('')).toBeNull();
    expect(core.invoke).not.toHaveBeenCalled();
  });
});

describe('captureAndSaveVideoPoster：截一次 → 落盘 → 返回本地 src', () => {
  it('把截出来的字节交给 save_video_poster，键仍是 fileHash', async () => {
    const fileHash = nextHash('save');
    capture.captureVideoFrame.mockResolvedValue(litFrame([1, 2, 3]));
    core.invoke.mockResolvedValue('/data/u_s/file/posters/y.jpg');

    const src = await captureAndSaveVideoPoster(fileHash, 'http://127.0.0.1:1/v.mp4');

    expect(capture.captureVideoFrame).toHaveBeenCalledWith('http://127.0.0.1:1/v.mp4');
    expect(core.invoke).toHaveBeenCalledWith('save_video_poster', {
      fileHash,
      bytes: [1, 2, 3],
    });
    expect(src).toBe('asset://localhost//data/u_s/file/posters/y.jpg');
  });

  it('同一 fileHash 并发调用只真截一次（多个格子同屏也只有一份工作）', async () => {
    const fileHash = nextHash('dedupe');
    const d = deferred<CapturedFrame>();
    capture.captureVideoFrame.mockReturnValue(d.promise);
    core.invoke.mockResolvedValue('/p/z.jpg');

    const a = captureAndSaveVideoPoster(fileHash, 'src://v');
    const b = captureAndSaveVideoPoster(fileHash, 'src://v');
    d.resolve(litFrame([9]));

    expect(await a).toBe('asset://localhost//p/z.jpg');
    expect(await b).toBe('asset://localhost//p/z.jpg');
    expect(capture.captureVideoFrame).toHaveBeenCalledTimes(1);
    // 落盘也只做一次
    expect(core.invoke.mock.calls.filter((c) => c[0] === 'save_video_poster')).toHaveLength(1);
  });

  it('截帧失败 ⇒ 返回 null，且本会话内不再对同一个视频重试', async () => {
    const fileHash = nextHash('fail');
    capture.captureVideoFrame.mockRejectedValue(new Error('视频加载失败'));

    expect(await captureAndSaveVideoPoster(fileHash, 'src://v')).toBeNull();
    expect(capture.captureVideoFrame).toHaveBeenCalledTimes(1);

    // 第二次挂载（列表滚回来）不能再开一轮离屏加载 —— 否则比不做这个功能还费
    expect(await captureAndSaveVideoPoster(fileHash, 'src://v')).toBeNull();
    expect(capture.captureVideoFrame).toHaveBeenCalledTimes(1);
  });

  it('落盘失败也算失败（返回 null，不把半成品当成功）', async () => {
    const fileHash = nextHash('savefail');
    capture.captureVideoFrame.mockResolvedValue(litFrame([1]));
    core.invoke.mockRejectedValue(new Error('未登录，无法保存视频封面'));

    expect(await captureAndSaveVideoPoster(fileHash, 'src://v')).toBeNull();
  });

  it('缺 fileHash 或缺 src ⇒ 不截帧（没有键就没法索引，截了也存不住）', async () => {
    expect(await captureAndSaveVideoPoster('', 'src://v')).toBeNull();
    expect(await captureAndSaveVideoPoster(nextHash('nosrc'), '')).toBeNull();
    expect(capture.captureVideoFrame).not.toHaveBeenCalled();
  });

  it('并发上限 2：4 个不同视频同时首屏，同一时刻最多 2 个在截', async () => {
    const hashes = [0, 1, 2, 3].map(() => nextHash('conc'));
    const gates = hashes.map(() => deferred<CapturedFrame>());
    let started = 0;
    capture.captureVideoFrame.mockImplementation(() => {
      const g = gates[started];
      started += 1;
      return g.promise;
    });
    core.invoke.mockResolvedValue('/p/c.jpg');

    const tasks = hashes.map((h) => captureAndSaveVideoPoster(h, 'src://v'));
    await flush();

    // 信号量把后两个挡在门外
    expect(capture.captureVideoFrame).toHaveBeenCalledTimes(2);

    // 放行第一个，名额转交给排队中的第三个
    gates[0].resolve(litFrame([1]));
    await tasks[0];
    await flush();
    expect(capture.captureVideoFrame).toHaveBeenCalledTimes(3);

    gates[1].resolve(litFrame([1]));
    gates[2].resolve(litFrame([1]));
    await Promise.all([tasks[1], tasks[2]]);
    await flush();
    expect(capture.captureVideoFrame).toHaveBeenCalledTimes(4);

    gates[3].resolve(litFrame([1]));
    await Promise.all(tasks);
  });
});

/**
 * 🔴 黑帧毒化防护（总管点名的硬项）
 *
 * 这两组用例里，判据 `isNearlyBlackFrame` 是**原实现**（见文件头 mock 说明），
 * 喂进去的是真的全 0 RGBA 缓冲 —— 所以它们证明的是真闸门，不是"mock 说它是黑的"。
 */
describe('写入闸门：黑帧绝不落盘（缓存了黑帧 = 每次都错，且自己不会恢复）', () => {
  it('纯黑帧 ⇒ 不调 save_video_poster、返回 null', async () => {
    const fileHash = nextHash('black');
    capture.captureVideoFrame.mockResolvedValue(blackFrame([1, 2, 3]));
    core.invoke.mockResolvedValue('/p/should-not-be-written.jpg');

    expect(await captureAndSaveVideoPoster(fileHash, 'src://v')).toBeNull();

    // 反向断言：一次都不许写。用「有没有这条 invoke」判，而不是 invoke 总次数 ——
    // 后者会被将来新增的无关 IPC 蒙混过去。
    expect(core.invoke.mock.calls.filter((c) => c[0] === 'save_video_poster')).toHaveLength(0);
  });

  it('黑帧走的是快速失败：本会话不再重试（下次启动才重来）', async () => {
    const fileHash = nextHash('blackretry');
    capture.captureVideoFrame.mockResolvedValue(blackFrame([7]));

    expect(await captureAndSaveVideoPoster(fileHash, 'src://v')).toBeNull();
    expect(await captureAndSaveVideoPoster(fileHash, 'src://v')).toBeNull();
    expect(capture.captureVideoFrame).toHaveBeenCalledTimes(1);
  });

  it('正对照：同一条路径上，有内容的帧照常落盘（证明闸门不是恒拒）', async () => {
    const fileHash = nextHash('blacklit');
    capture.captureVideoFrame.mockResolvedValue(litFrame([4, 5]));
    core.invoke.mockResolvedValue('/p/ok.jpg');

    expect(await captureAndSaveVideoPoster(fileHash, 'src://v')).toBe('asset://localhost//p/ok.jpg');
    expect(core.invoke).toHaveBeenCalledWith('save_video_poster', { fileHash, bytes: [4, 5] });
  });
});

describe('自愈：已落盘的黑帧要能自己好，不能只堵写入口', () => {
  it('读到的封面是黑帧 ⇒ 作废该条目并返回 null（上层退回重截）', async () => {
    const fileHash = nextHash('healblack');
    core.invoke.mockImplementation(async (cmd: string) =>
      (cmd === 'get_video_poster_path' ? '/data/u_s/file/posters/poisoned.jpg' : null));
    capture.readImagePixels.mockResolvedValue(new Uint8ClampedArray(64 * 4));

    expect(await loadVideoPosterSrc(fileHash)).toBeNull();
    expect(core.invoke).toHaveBeenCalledWith('invalidate_video_poster', { fileHash });
  });

  it('封面正常 ⇒ 不作废、照常返回 src（证明自愈不是恒删）', async () => {
    const fileHash = nextHash('healok');
    core.invoke.mockImplementation(async (cmd: string) =>
      (cmd === 'get_video_poster_path' ? '/data/u_s/file/posters/good.jpg' : null));
    capture.readImagePixels.mockResolvedValue(new Uint8ClampedArray([255, 255, 255, 255]));

    expect(await loadVideoPosterSrc(fileHash)).toBe('asset://localhost//data/u_s/file/posters/good.jpg');
    expect(core.invoke.mock.calls.filter((c) => c[0] === 'invalidate_video_poster')).toHaveLength(0);
  });

  it('读不出像素 ⇒ 保持现状，绝不删掉一张可能是好的封面', async () => {
    const fileHash = nextHash('healunreadable');
    core.invoke.mockImplementation(async (cmd: string) =>
      (cmd === 'get_video_poster_path' ? '/data/u_s/file/posters/unreadable.jpg' : null));
    capture.readImagePixels.mockResolvedValue(null);

    expect(await loadVideoPosterSrc(fileHash)).toBe('asset://localhost//data/u_s/file/posters/unreadable.jpg');
    expect(core.invoke.mock.calls.filter((c) => c[0] === 'invalidate_video_poster')).toHaveLength(0);
  });

  it('同一落盘路径本会话只解码验一次（自愈不该每次挂载都重解码一张图）', async () => {
    const fileHash = nextHash('healonce');
    core.invoke.mockImplementation(async (cmd: string) =>
      (cmd === 'get_video_poster_path' ? '/data/u_s/file/posters/once.jpg' : null));
    capture.readImagePixels.mockResolvedValue(new Uint8ClampedArray([255, 255, 255, 255]));

    await loadVideoPosterSrc(fileHash);
    await loadVideoPosterSrc(fileHash);

    expect(capture.readImagePixels).toHaveBeenCalledTimes(1);
  });
});
