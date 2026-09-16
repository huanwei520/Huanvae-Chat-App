/**
 * 故障记录检测 —— 统一出口
 *
 * @module services/faultReport
 */

export * from './config';
export * from './sanitizer';
export * from './ringBuffer';
export { faultReportInstance } from './instance';
export type { NetworkErrorSummary } from './instance';
export { installFaultCapture, isFaultCaptureInstalled } from './capture';
export { sealFaultReport, openFaultReport, parseFaultPublicKeyPem, FaultCryptoError, HKDF_INFO } from './crypto';
export type { FaultEnvelope } from './crypto';
export * from './staging';
export {
  startFaultRecording,
  stopFaultRecording,
  isFaultRecording,
  compressScreenshot,
  buildAndSealFaultReport,
  submitSealedEnvelope,
  retryStagedReports,
  getFaultReportUiState,
} from './service';
export type { FaultDeviceInfo, FaultScreenshot, FaultReportPayload } from './service';
