/**
 * 会议内远程控制——dev 门控（设计 §8.2：仅 `VITE_DEV_CONTROL=1` 构建暴露入口）
 *
 * 生产/常规构建该变量未定义 → isDevControl() 恒 false，全部控制面分支为死代码被
 * vite 摇树，生产路径零改变（先例：services/e2eMode.ts 的构建期注入门控同款）。
 * 注释注：此处不得出现「E2E 基址注入」那个 env 变量名的字面量——e2e-mode-routing
 * 契约测试静态扫描全 src/ 该字面量（防绕过 isE2E() 直读 env），注释命中即误报 FAIL
 * （2025-09-08 音频设备卡代为去字面量修正，语义不变）。
 * 本模块只允许被控制域文件 import（wsHandlers / WebSocketContext / MeetingPage /
 * main.tsx / App.tsx 五个接线点）。
 *
 * @module remote-control/devGate
 */

/** 是否处于 dev 控制面模式（构建期注入 VITE_DEV_CONTROL=1 才为 true） */
export function isDevControl(): boolean {
  return import.meta.env.VITE_DEV_CONTROL === '1';
}

/**
 * 会议内远程控制正式功能开关（真实用户入口：会议 tile 右键菜单申请/授权 +
 * /remote-control 独立控制窗 + 主 WS 控制信令上行/分发）。
 *
 * 缺口修复（2026-09-13 发布块 cwsecdh0）：此前整个控制域仅 isDevControl() 门控，
 * 常规构建无任何入口，正式版本承诺的远控功能不可达。现将「正式功能入口」与
 * 「dev 自动化面」（自动开会议窗/autologin/seed 演示数据/模拟按钮）拆分：
 * 正式入口改由本开关门控，常规构建恒可用；构建期注入 VITE_DISABLE_REMOTE_CONTROL=1
 * 可显式关闭（供需要阉割该功能的定制构建），常规构建不定义该变量 → 恒 true。
 */
export function isRemoteControlEnabled(): boolean {
  return import.meta.env.VITE_DISABLE_REMOTE_CONTROL !== '1';
}
