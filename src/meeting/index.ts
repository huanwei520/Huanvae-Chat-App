/**
 * 会议模块入口
 *
 * 独立 Transceiver 架构的 WebRTC 视频会议实现
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
 * ## 安全重协商机制
 *
 * 1. 使用 addTransceiver() 创建独立通道，不复用现有 transceiver
 * 2. 只在 signalingState === 'stable' 时进行协商
 * 3. 新 transceiver 不影响现有的媒体通道
 *
 * ## 发言状态检测
 *
 * 使用 Web Audio API 进行本地音量检测：
 * - AudioContext + AnalyserNode 分析麦克风音量
 * - 音量阈值 30，超过则判定为正在说话
 * - 通过 DataChannel 广播发言状态到所有参与者
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
