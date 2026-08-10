/**
 * 边缘侧滑返回（edge swipe back）—— 纯阈值判定逻辑
 *
 * 交互约定与 iOS `UIScreenEdgePanGestureRecognizer` / Android 系统返回手势一致：
 * **只有从屏幕左边缘起手的右滑**才算返回，页面内的纵向滚动与横向列表滑动不受影响。
 *
 * 分工：本模块只回答「该不该」——起手点是否落在边缘带、这一次手势的主轴是横向还是
 * 该让位给纵向滚动、松手时位移/速度是否达标。触摸事件接线、跟手位移、回弹动画在
 * [useEdgeSwipeBack](../hooks/useEdgeSwipeBack.ts)。
 *
 * 拆开的原因：纯函数可零 mock 单测（tests/unit/edgeSwipe.test.ts），而 hook 的触摸
 * 时序只能靠真机验收；把「判定」这层从「接线」里剥出来，判定错误才拦得住。
 */

/** 边缘带宽度（px）：起手点 clientX 落在 [0, 24] 内才认作边缘侧滑。 */
export const EDGE_SWIPE_EDGE_WIDTH = 24;

/** 主轴锁定阈值（px）：位移超过它才判定这次是横向返回还是纵向滚动，之前保持观望。 */
export const EDGE_SWIPE_AXIS_SLOP = 10;

/** 提交所需的最小绝对位移（px）：窄屏下的下限，避免按比例算出来的阈值过小而误触。 */
export const EDGE_SWIPE_MIN_COMMIT_DISTANCE = 64;

/** 提交所需的屏宽占比：拖过屏宽的这个比例即认为用户想返回。 */
export const EDGE_SWIPE_COMMIT_RATIO = 0.28;

/** 快滑（flick）提交的速度阈值（px/ms）。 */
export const EDGE_SWIPE_FLICK_VELOCITY = 0.45;

/** 快滑提交仍要求的最小位移（px）：防止在边缘轻点抖一下就被判成快滑。 */
export const EDGE_SWIPE_FLICK_MIN_DISTANCE = 24;

/**
 * 手势主轴状态。
 * - `pending`   位移还没超过锁定阈值，尚不能判定方向
 * - `horizontal` 判定为向右的横向手势 → 接管为返回手势
 * - `rejected`  判定为纵向/向左/斜向不明 → 本次手势作废，交还给滚动
 */
export type EdgeSwipeAxis = 'pending' | 'horizontal' | 'rejected';

/**
 * 起手点是否落在左边缘带内。
 *
 * @param clientX 触点相对视口左边的横坐标（px）
 * @param edgeWidth 边缘带宽度，默认 {@link EDGE_SWIPE_EDGE_WIDTH}
 */
export function isEdgeSwipeStart(clientX: number, edgeWidth: number = EDGE_SWIPE_EDGE_WIDTH): boolean {
  return clientX >= 0 && clientX <= edgeWidth;
}

/**
 * 判定手势主轴。
 *
 * 两轴位移都还没超过 slop 时返回 `pending`（继续观望，不抢手势）；一旦超过，
 * 只有**向右且横向分量严格大于纵向分量**才接管，其余（向左、纵向为主、45° 平手）
 * 一律 `rejected`，让纵向滚动照常工作。
 *
 * @param dx 相对起手点的横向位移（px，向右为正）
 * @param dy 相对起手点的纵向位移（px，向下为正）
 * @param slop 主轴锁定阈值，默认 {@link EDGE_SWIPE_AXIS_SLOP}
 */
export function resolveEdgeSwipeAxis(
  dx: number,
  dy: number,
  slop: number = EDGE_SWIPE_AXIS_SLOP,
): EdgeSwipeAxis {
  if (Math.abs(dx) < slop && Math.abs(dy) < slop) {
    return 'pending';
  }
  return dx > 0 && dx > Math.abs(dy) ? 'horizontal' : 'rejected';
}

/**
 * 当前视口下「拖够了」所需的位移（px）。
 *
 * 取屏宽比例与绝对下限的较大者：宽屏按比例（手指要走的路程与页面宽度成正比才自然），
 * 窄屏用下限兜住（比例算出来太小会误触）。
 */
export function edgeSwipeCommitDistance(viewportWidth: number): number {
  return Math.max(EDGE_SWIPE_MIN_COMMIT_DISTANCE, viewportWidth * EDGE_SWIPE_COMMIT_RATIO);
}

/** 松手判定的输入。 */
export interface EdgeSwipeReleaseInput {
  /** 松手时相对起手点的横向位移（px，向右为正） */
  dx: number;
  /** 手势历时（ms） */
  elapsedMs: number;
  /** 视口宽度（px） */
  viewportWidth: number;
}

/**
 * 松手时是否提交返回。
 *
 * 两条通道任一命中即提交：
 * 1. **拖够了** —— 位移达到 {@link edgeSwipeCommitDistance}（慢慢拖过大半也算数）
 * 2. **甩出去了** —— 速度达到 {@link EDGE_SWIPE_FLICK_VELOCITY}，且位移至少
 *    {@link EDGE_SWIPE_FLICK_MIN_DISTANCE}（快而短的抖动不算）
 *
 * 都不命中 → 调用方应把页面回弹到原位。
 */
export function shouldCommitEdgeSwipe({ dx, elapsedMs, viewportWidth }: EdgeSwipeReleaseInput): boolean {
  if (dx >= edgeSwipeCommitDistance(viewportWidth)) {
    return true;
  }
  // elapsedMs 为 0（同一毫秒内起手+松手）时速度不可信，只让距离通道判定
  const velocity = elapsedMs > 0 ? dx / elapsedMs : 0;
  return dx >= EDGE_SWIPE_FLICK_MIN_DISTANCE && velocity >= EDGE_SWIPE_FLICK_VELOCITY;
}
