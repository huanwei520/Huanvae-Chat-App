/**
 * 相册发送编排（纯逻辑，零 React / 零 Tauri 依赖）
 *
 * @module chat/shared
 * @location src/chat/shared/albumSend.ts
 *
 * 相册的每一张仍是独立上传 + 独立消息，靠 media_group 三件套成组。
 * 本模块只管**编排**：分配位次、决定配文挂在哪一项、串行推进、以及
 * **传一半失败了怎么办** —— 这几件事与 UI 无关，抽出来才能真正测到。
 *
 * ## 为什么串行而不是并发
 * 并发上传会让组内各项的到达顺序不可控，而后端按到达顺序分配 seq；
 * 组内 seq 乱序会让接收端的相册在「按 seq 倒序」的列表里被拆到不相邻的位置。
 * 串行虽然慢，但保证组内 seq 单调 —— 相册在对端一定是连续的一块。
 *
 * ## 传一半失败的口径（本模块的核心决策）
 * **不回滚已成功的项**，也**不假装整组成功**：
 * - 已上传成功的项已经在服务端建了消息，对端已经收到了，回滚不了（没有"撤回半组"的端点）
 * - 继续传剩下的项只会让一个**声称 count=N、实际永远只有 M 张**的残组永久留在两端
 * ⇒ 策略是「**失败即停，如实上报**」：停止后续上传，把已成功数 / 总数交给 UI 明说，
 *   让用户自己决定是否把剩下的重发（重发会成为**新的一组**，这比伪造完整组诚实）。
 *
 * 该口径写在这里而不是散在 UI 里，是为了让它可被单测钉死 —— 它是个产品决策，
 * 不是实现细节，改动应当有人看见。
 */

/** 后端允许的组大小上限（与 chat/shared/mediaGroup.ts 的 MEDIA_GROUP_MAX 同源约束） */
export const ALBUM_MAX_ITEMS = 10;
/** 成组下限：少于 2 张不成组，走单发路径（带 caption 的单媒体后端也接受） */
export const ALBUM_MIN_ITEMS = 2;

/** 单项上传计划 */
export interface AlbumUploadPlan<TFile> {
  file: TFile;
  /** 组内位次，0-based */
  index: number;
  /** 组内总数 */
  count: number;
  /** 组标识 */
  groupId: string;
  /**
   * 本项要提交的配文。**只有 index === 0 那项非空**——
   * 后端对其余位次带 caption 直接 400。
   */
  caption?: string;
}

/**
 * 把选中的若干文件排成上传计划
 *
 * @param files 用户选中的文件（顺序即用户看到的顺序，直接作为组内位次）
 * @param groupId 调用方生成的组标识（本模块不产生随机数，便于测试确定性）
 * @param caption 整组配文；空串/undefined 表示不带配文
 * @throws 文件数不在 [ALBUM_MIN_ITEMS, ALBUM_MAX_ITEMS] 时抛错 —— 这是编程错误，
 *         调用方应当在选择阶段就把数量卡住，而不是靠这里兜底
 */
export function planAlbumUpload<TFile>(
  files: readonly TFile[],
  groupId: string,
  caption?: string,
): AlbumUploadPlan<TFile>[] {
  if (files.length < ALBUM_MIN_ITEMS || files.length > ALBUM_MAX_ITEMS) {
    throw new Error(
      `相册张数必须在 ${ALBUM_MIN_ITEMS}..${ALBUM_MAX_ITEMS} 之间，收到 ${files.length}`,
    );
  }
  const count = files.length;
  const trimmed = caption?.trim();
  return files.map((file, index) => ({
    file,
    index,
    count,
    groupId,
    // 配文只挂 index 0；其余位次必须不带（后端约束）
    caption: index === 0 && trimmed ? trimmed : undefined,
  }));
}

/** 单项上传结果 */
export interface AlbumItemOutcome {
  index: number;
  ok: boolean;
  error?: string;
}

/** 整组上传结果 */
export interface AlbumSendResult {
  groupId: string;
  /** 期望总数 */
  total: number;
  /** 实际成功数 */
  succeeded: number;
  /** 逐项结果，按位次升序 */
  outcomes: AlbumItemOutcome[];
  /** 是否整组成功 */
  complete: boolean;
  /** 首个失败的位次；无失败为 null */
  failedAtIndex: number | null;
}

/**
 * 按计划串行执行上传
 *
 * @param plans planAlbumUpload 的产物
 * @param uploadOne 单项上传器（由调用方注入，内部走 useFileUpload）；抛错即视为该项失败
 * @returns 整组结果。**失败即停**：首个失败之后的项不再尝试（见文件头「传一半失败的口径」）
 */
export async function runAlbumUpload<TFile>(
  plans: readonly AlbumUploadPlan<TFile>[],
  uploadOne: (plan: AlbumUploadPlan<TFile>) => Promise<void>,
): Promise<AlbumSendResult> {
  const outcomes: AlbumItemOutcome[] = [];
  let failedAtIndex: number | null = null;

  for (const plan of plans) {
    if (failedAtIndex !== null) {
      break; // 失败即停：不再尝试后续项
    }
    try {
      // eslint-disable-next-line no-await-in-loop -- 串行是刻意的：保证组内 seq 单调，见文件头
      await uploadOne(plan);
      outcomes.push({ index: plan.index, ok: true });
    } catch (err) {
      outcomes.push({
        index: plan.index,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
      failedAtIndex = plan.index;
    }
  }

  const total = plans.length;
  const succeeded = outcomes.filter((o) => o.ok).length;
  return {
    groupId: plans[0]?.groupId ?? '',
    total,
    succeeded,
    outcomes,
    complete: succeeded === total,
    failedAtIndex,
  };
}

/**
 * 传一半失败时给用户看的话
 *
 * 明说「已发出 M / N」而不是笼统的「发送失败」—— 已成功的那 M 张对方**已经收到了**，
 * 说成"失败"会让用户以为对方什么都没看到，从而重发一整组、造成重复。
 */
export function describePartialFailure(result: AlbumSendResult): string {
  if (result.complete) {
    return '';
  }
  return `相册未发完：已发出 ${result.succeeded}/${result.total} 张，对方已能看到这 ${result.succeeded} 张。剩余部分可重新发送（将作为新的一组）。`;
}
