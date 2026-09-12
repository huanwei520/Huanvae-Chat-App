/**
 * 视频封面本地持久化 —— 前端编排层（读缓存 / 截一次 / 落盘）
 *
 * @module services/videoPoster
 *
 * ## 它根治的是什么
 *
 * 在此之前，视频缩略图的**全部**机制就是 `<video src="…#t=0.1" preload="metadata">`：
 * 靠引擎现拉元数据、seek、把那一帧画出来。那一帧只活在该 `<video>` 元素里，元素一销毁就没了
 * —— 所以每次挂载（切回会话、进「查找记录 → 视频」、杀掉 App 重开）都要重来一遍，
 * 用户看到的就是「先黑再显示 / 每次都重新加载」。全仓此前**没有任何封面产物**可命中。
 *
 * 本模块补上那一环：首次显示时截一帧落盘，之后缩略图直接渲染 `<img>` 读本地文件。
 *
 * ## 与图片本地缓存同一套（「和图片的加载一样」是硬约束）
 *
 * | 环节 | 图片（既有） | 封面（本模块） |
 * |------|-------------|---------------|
 * | 读 | `getCachedFilePath` → 查 `file_mappings` → `stat` 文件 → 不在就删映射返 null | `get_video_poster_path` → 查 `video_posters` → `stat` → 同款三步 |
 * | 时机 | **每次挂载**都问一次（Rust 侧 1~5ms） | 读侧有**会话内解析缓存**：同键第二次问零 IPC，登出/切换账号/重置数据时失效（见下） |
 * | 显示 | 本地路径经 `localPathToDisplaySrc` 转 asset 协议 | **同一个函数** |
 * | 落盘 | `…/file/pictures/` | `…/file/posters/`（同一缓存根的平级目录） |
 * | 键 | `file_hash`（内容哈希） | `posterKey` = **文件身份键**，见下 |
 *
 * **键为什么不是显示 URL**：远程 src 带每次重签都变的 SigV4 参数、以及每会话可变的回环端口；
 * 本地 src 还会随平台在 asset 协议与本地媒体服务器之间切换。拿它当键 = **每次都 miss**，
 * 正好复现要根治的 bug。
 *
 * **🔴 键为什么不是内容哈希（2026-08-16 两层键改的就是这里）**：封面要在**下载之前**就出得来，
 * 而后端接收面已不再下发 `file_hash`、本机的内容哈希是**下载完成后才自算**的 ——
 * 一个只被滚过、从没播过的视频将永远算不出哈希 ⇒ 封面永远存不下来、每次挂载重截，
 * 正是本模块要根治的那个 bug 原样复发。所以键改成两个来源各自稳定唯一的**文件身份键**：
 * 消息面 = `file_uuid`（下载前就有），个人文件面 = 服务端下发的 `file_hash`（该端点未改）。
 * 两个键空间不相交，同一张 `video_posters` 表里混用不会互相误命中。
 * 详见 `src-tauri/src/db/video_posters.rs` 模块头。
 *
 * **会话内解析缓存（2026-09 起，修订「不做进程内 memo」的旧决策）**：旧决策的顾虑是账号
 * 隔离（封面文件按 `data/{user}_{server}/` 分目录，缓存跨账号复用就是串台），且当时判断
 * 「拿不到用户切换这个信号」。真机上把「不做 memo」的代价量出来了：切会话再切回每次都
 * 重付一轮 IPC + stat，自愈解码也刚好落在「切回」那一次挂载上，用户感知为
 * 「切换视频封面时反复重新读取」。现把解析结果记进 `resolvedPosterSrc`（见其注释），
 * **失效挂在既有登出收敛点** `SessionContext.clearSession`（覆盖主动登出 / session 过期 /
 * WS token 刷新失败全部路径）与「重置所有数据」两处 —— 顾虑由「拿不到失效信号」
 * 变成「失效点在既定收敛点上，且有测试钉住」。每次问一次 Rust 的图片侧不受此影响
 * （图片缓存的键与失效语义是另一套，不属本缺陷范围）。
 *
 * ## 🔴 黑帧毒化防护（两道，缺一道都不成立）
 *
 * Android 硬解把帧画进 canvas，在部分机型上得到的是**全黑 / 全透明**。封面是**永久缓存**：
 * 黑帧一旦落盘就每次命中 ⇒ **每次都错，且自己不会恢复**。没有缓存只是每次慢 ——
 * 两种代价不对等，所以这条链路上「宁可不存」永远优于「先存下来再说」。
 *
 * | 道 | 位置 | 做什么 |
 * |---|---|---|
 * | 写入闸门 | {@link captureAndSaveVideoPoster} | 落盘**之前**判 {@link isNearlyBlackFrame}；判黑 ⇒ **不调 `save_video_poster`**，记一次失败、本会话不再重试，下次启动重来 |
 * | 自愈 | {@link loadVideoPosterSrc} | 读到已落盘封面时解码回像素再判一次；判黑 ⇒ 调 `invalidate_video_poster` 删文件 + 删索引并返回 `null` ⇒ 上层退回 `capture` 重截 |
 *
 * 只堵写入口是不够的：用户设备上可能已经存着**旧版本 / 别的构建**写进去的黑帧，
 * 只堵新写它永远好不了。反过来只做自愈也不够：那等于每次都先存一张坏的再删掉。
 *
 * **自愈的额外成本被按「每个落盘路径每会话一次」摊掉**（{@link posterInspected}）：
 * 封面内容按 `posterKey` 定身份、落盘后不再变，同一会话里验第二次没有信息量；
 * 而缓存路径里含 `{user}_{server}`，换账号后是另一条路径 ⇒ 会重新验，不会串台。
 */

import { invoke } from '@tauri-apps/api/core';
import { localPathToDisplaySrc } from './assetUrl';
import { captureVideoFrame, isNearlyBlackFrame, readImagePixels } from './videoPosterCapture';

/**
 * 同时进行的截帧数上限。
 *
 * 「查找记录 → 视频」一屏可能有几十个格子；不限流会同时开几十个离屏 `<video>` 拉元数据，
 * 把带宽和解码器打满（那正是本模块要消灭的成本）。只在**每个视频有史以来第一次**显示时
 * 发生，2 条并发足够把队列消化掉。
 */
const MAX_CONCURRENT_CAPTURES = 2;

/**
 * 会话内各模块级「按条记忆」集合共用的容量上限（条数）。
 *
 * 这些集合都随会话内**见过的不同视频数**线性增长，理论上无界；给个上限防极端长会话
 * （挂机数天、滚动过上千个视频）内存缓涨。512 条对「一屏几十个格子」的真实交互绰绰有余，
 * 而驱逐的最坏代价只是**该条目的事重做一次**：
 *  - `resolvedPosterSrc` 驱逐 ⇒ 该键下次挂载重付一轮 IPC +（路径未验过时）一次自愈解码；
 *  - `posterInspected` 驱逐 ⇒ 该路径下次读取重新解码验一次黑帧；
 *  - `captureFailed` 驱逐 ⇒ 该键下次挂载再试一次截帧。
 * 全部是「多付一次本该摊销的成本」，不改变任何正确性语义；登出/重置数据时整套清空。
 */
const MAX_SESSION_ENTRIES = 512;

/**
 * 往 LRU Map（键 → 显示 src）里记一条：delete+set 提到最新，超限摘最旧。
 * Map 的迭代序 = 插入序，所以「最旧」就是 `keys()` 的第一个 —— 标准 Map-LRU 写法。
 */
function lruRemember(map: Map<string, string>, key: string, value: string): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > MAX_SESSION_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) {
      return;
    }
    map.delete(oldest);
  }
}

/**
 * 往容量上限 Set 里记一条（先进先出驱逐）。用于「做没做过」类标记
 * （验过黑帧的路径 / 截帧失败过的键）—— 它们只关心有没有，不关心最近性。
 */
function cappedAdd(set: Set<string>, key: string): void {
  set.add(key);
  while (set.size > MAX_SESSION_ENTRIES) {
    const oldest = set.values().next().value;
    if (oldest === undefined) {
      return;
    }
    set.delete(oldest);
  }
}

/**
 * 本会话内截帧失败过的 posterKey。
 *
 * 不记住的话，一个截不出帧的视频（取源通路无 CORS 头、引擎不给跨源解码……）会在**每次挂载**
 * 都重开一轮离屏加载 —— 比不做这个功能还费。只记在内存里、不落库：失败常是环境性的
 * （反代还没起来、文件正在下载中），下次启动应该再试一次。
 */
const captureFailed = new Set<string>();

/** 同一 posterKey 的在途截帧任务（多个格子同时首屏时只截一次）。 */
const inflight = new Map<string, Promise<string | null>>();

/**
 * 本会话已经验过「不是黑帧」的封面**落盘路径**。
 *
 * 键用 `local_path` 而不是 `posterKey`：路径里含 `data/{user}_{server}/`，
 * 换账号后同一个 `posterKey` 指向的是另一个人的文件，必须重新验一次。
 * 只记在内存：封面被外部替换（同步、还原备份）后下次启动仍会重验。
 */
const posterInspected = new Set<string>();

/**
 * 会话内**解析结果**缓存：`posterKey → 可直接喂 <img> 的显示 src`。
 *
 * ## 它根治什么（huanwei 反馈：切换视频封面时反复重新读取）
 *
 * 上面那句「不做进程内 memo」的代价在真机上被量出来了：切会话再切回 / 列表滚动让缩略图
 * 销毁重建，**每次挂载**都打一轮 `get_video_poster_path`（IPC + SQLite + stat），
 * 而且自愈解码刚好落在「切回」那一次挂载上（该落盘路径本会话第一次被读到）。
 * 切换是高频动作，这笔账每次都重付 ⇒ 用户感知为「封面反复重新读取」。
 *
 * 于是把解析结果也记下来：同一 `posterKey` 本会话内第二次问，直接回上次的显示 src ——
 * 零 IPC、零解码、零 stat，`<VideoThumbnail>` 借 {@link peekCachedPosterSrc} 在**首帧渲染**
 * 就同步出封面（连 pending 占位都不出现）。`captureAndSaveVideoPoster` 截完落盘也写入这里，
 * 所以「会话内刚截好的封面」切回时同样直接命中。
 *
 * ## 账号隔离（当初不做 memo 的那个顾虑，怎么解的）
 *
 * 封面文件按 `data/{user}_{server}/` 分账号分目录，缓存跨账号复用就是串台。
 * 解法是把失效挂在**既有的登出收敛点**上：`SessionContext.clearSession` 在清其它会话级
 * 缓存的同一条地方调 {@link clearVideoPosterSessionCache}，覆盖主动登出 / session 过期 /
 * WS token 刷新失败全部路径；「设置 → 重置所有数据」（`db_clear_all_data`，索引被清）
 * 成功后也清一次。两个失效点由 tests/components/VideoPosterSwitchCache.test.tsx 静态钉住。
 *
 * 只缓存**成功解析**的 src；null（没存过 / 被判黑作废）不进缓存 —— 否则「本次会话稍后
 * 才截好的封面」会被一张旧 null 挡在门外，读侧从此自锁。黑帧作废路径会显式
 * {@link clearVideoPosterSessionCache} 对应条目，自愈不被缓存挡住。
 *
 * 容量有上限（LRU，{@link MAX_SESSION_ENTRIES}）：命中经 {@link peekCachedPosterSrc} /
 * {@link loadVideoPosterSrc} 都会刷新新近度，超限摘最旧 —— 防极端长会话无界缓涨，
 * 驱逐的最坏代价只是该键重付一轮读链路（见 MAX_SESSION_ENTRIES 注释）。
 */
const resolvedPosterSrc = new Map<string, string>();

/**
 * 只读查询：这个视频在本会话内是否已解析过封面。
 *
 * 给 `useVideoPoster` 在**挂载首帧**同步判定用 —— 命中时初态就是 `poster`，
 * 不进 pending、不发 IPC。不解析、不回源，纯 Map 读。
 *
 * 命中同时刷新 LRU 新近度（命中即「使用」）：否则一个久被反复查看的键可能只因
 * 入场早而被纯插入序的驱逐误伤，切回时重付一轮 IPC + 解码 —— 正是本缓存要消灭的事。
 */
export function peekCachedPosterSrc(posterKey: string): string | null {
  const cached = resolvedPosterSrc.get(posterKey);
  if (cached === undefined) {
    return null;
  }
  lruRemember(resolvedPosterSrc, posterKey, cached);
  return cached;
}

/**
 * 清空会话内封面解析缓存。**登出 / 切换账号 / 重置所有数据时必须调**（见模块级注释）：
 * 封面文件按账号分目录，缓存跨账号复用 = 把上一个账号的封面路径递给下一个账号的 `<img>`。
 */
export function clearVideoPosterSessionCache(): void {
  resolvedPosterSrc.clear();
}

// ---- 并发信号量 ----------------------------------------------------------
let running = 0;
const waiting: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (running < MAX_CONCURRENT_CAPTURES) {
    running += 1;
    return;
  }
  await new Promise<void>((resolve) => {
    waiting.push(resolve);
  });
  // 名额由 releaseSlot 直接转交（running 不变），此处不再自增
}

function releaseSlot(): void {
  const next = waiting.shift();
  if (next) {
    next();
    return;
  }
  running -= 1;
}
// -------------------------------------------------------------------------

/**
 * 读本地已存的封面（不截帧），并顺手做**自愈**：读到的封面若是黑帧 ⇒ 作废该条目、返回 null。
 *
 * @returns 可直接喂 `<img src>` 的显示 src；没存过 / 文件已被删 / **已被毒化** 返回 null
 */
export async function loadVideoPosterSrc(posterKey: string): Promise<string | null> {
  if (!posterKey) {
    return null;
  }
  // 会话内解析过 ⇒ 直接回上次的显示 src：零 IPC、零解码、零 stat。
  // 只缓存成功结果，null 不进缓存（否则「稍后才截好」的封面会被旧 null 挡住，见缓存注释）。
  const cached = resolvedPosterSrc.get(posterKey);
  if (cached !== undefined) {
    return cached;
  }
  let localPath: string | null;
  try {
    localPath = await invoke<string | null>('get_video_poster_path', { fileKey: posterKey });
  } catch (e) {
    console.warn('[videoPoster] 读取封面索引失败:', e);
    return null;
  }
  if (!localPath) {
    return null;
  }
  const displaySrc = localPathToDisplaySrc(localPath);

  // 自愈第一道：这条路径本会话验过就不再重复解码（理由见 posterInspected 注释）
  if (posterInspected.has(localPath)) {
    lruRemember(resolvedPosterSrc, posterKey, displaySrc);
    return displaySrc;
  }
  const pixels = await readImagePixels(displaySrc);
  // 读不出像素 ≠ 它是坏的（偶发解码失败 / 平台不支持），此时保持现状，绝不删缓存
  if (pixels && isNearlyBlackFrame(pixels)) {
    console.warn('[videoPoster] 已落盘封面是黑帧，作废并重取:', posterKey);
    // 作废的同时清掉进程内缓存 —— 不许它此后继续吐被作废的地址
    resolvedPosterSrc.delete(posterKey);
    try {
      await invoke('invalidate_video_poster', { fileKey: posterKey });
    } catch (e) {
      console.warn('[videoPoster] 作废黑帧封面失败:', e);
    }
    return null;
  }
  cappedAdd(posterInspected, localPath);
  lruRemember(resolvedPosterSrc, posterKey, displaySrc);
  return displaySrc;
}

/**
 * 截一帧并落盘，返回落盘后的显示 src。
 *
 * 同一 posterKey 并发调用只会真正截一次（在途任务共享）；本会话内失败过的直接返回 null，
 * 理由见 `captureFailed` 的注释。
 *
 * @param posterKey 视频的稳定身份（同时是封面的键）
 * @param videoSrc 已经过取源收口点解析的**裸**可显示视频 src
 */
// 本函数**不**声明 async：它自己一句 await 都没有（真正的等待全在下面那个 IIFE 里），
// 写成 async 只会白包一层 Promise，且触发 eslint 的 require-await。
export function captureAndSaveVideoPoster(
  posterKey: string,
  videoSrc: string,
): Promise<string | null> {
  if (!posterKey || !videoSrc || captureFailed.has(posterKey)) {
    return Promise.resolve(null);
  }
  const pending = inflight.get(posterKey);
  if (pending) {
    return pending;
  }

  const task = (async (): Promise<string | null> => {
    await acquireSlot();
    try {
      const frame = await captureVideoFrame(videoSrc);
      // 🔴 写入闸门：黑帧**不落盘**，直接快速失败。不许"写进去但标个 flag"——
      // 那还是把坏值固化了，下次照样命中。记一次失败 ⇒ 本会话不再重试，下次启动重来。
      if (isNearlyBlackFrame(frame.pixels)) {
        cappedAdd(captureFailed, posterKey);
        console.warn('[videoPoster] 截到的是黑帧，拒绝写入封面缓存:', posterKey);
        return null;
      }
      const localPath = await invoke<string>('save_video_poster', {
        fileKey: posterKey,
        // Tauri 的命令参数走 JSON，Uint8Array 要转成普通数组才序列化得出去
        bytes: Array.from(frame.bytes),
      });
      const displaySrc = localPathToDisplaySrc(localPath);
      // 刚截好的直接入进程内缓存：本会话内切走再切回，读侧不再为它重付一轮 IPC
      lruRemember(resolvedPosterSrc, posterKey, displaySrc);
      return displaySrc;
    } catch (e) {
      cappedAdd(captureFailed, posterKey);
      console.warn('[videoPoster] 截取/保存封面失败:', posterKey, e);
      return null;
    } finally {
      releaseSlot();
      inflight.delete(posterKey);
    }
  })();

  inflight.set(posterKey, task);
  return task;
}
