/**
 * 会议模块入口
 *
 * 独立 Transceiver 架构 + Perfect Negotiation 的 WebRTC mesh 视频会议实现
 *
 * ## 架构说明
 *
 * 每个 PeerConnection 为三种媒体类型各设立独立的 transceiver：
 * | 媒体类型 | Transceiver | 方向 |
 * |---------|-------------|------|
 * | 麦克风   | mic         | sendrecv |
 * | 摄像头   | camera      | sendrecv |
 * | 屏幕共享 | screen      | sendrecv |
 *
 * ## 协商机制（Perfect Negotiation）
 *
 * 1. 用 participant id 字典序定极性：id 大者 polite、小者 impolite（发起方），每对恰一极
 * 2. 所有重协商经 `onnegotiationneeded → makeOffer`；offer/answer 走 perfect-negotiation
 *    守卫（polite 隐式 rollback）；ICE candidate 经 pending 队列缓冲
 * 3. 媒体轨道分类经定向 `media_type` 信令（mid 是 per-pc 的）；粗粒度媒体态经 `media_state`
 *    / `media_state_changed` 让 UI 与 track 解耦
 * 4. WS 异常关闭指数退避重连（rejoin 拿新 token/ICE + 全量重建 pc）
 *
 * ## 发言状态检测
 *
 * 使用 Web Audio API 进行本地音量检测：
 * - AudioContext + AnalyserNode 分析麦克风音量
 * - 音量阈值 30，超过则判定为正在说话
 * - 经单侧 DataChannel（impolite 侧建）广播发言状态到所有参与者
 * - UI 显示绿色边框脉冲动画指示发言者
 *
 * ## 模块导出
 *
 * - `useWebRTC`: 核心 Hook，管理 WebRTC 连接和媒体流
 * - `MeetingPage`: 会议页面组件
 * - `MeetingEntryModal`: 会议入口弹窗
 * - API 函数和类型定义
 */

// API 和类型
export * from './api';

// Hook
export { useWebRTC, type RemoteParticipant, type MeetingState, type MediaDeviceState, type UseWebRTCReturn } from './useWebRTC';

// 页面组件
export { default as MeetingPage } from './MeetingPage';

// 子组件
export { MeetingEntryModal } from './components/MeetingEntryModal';
