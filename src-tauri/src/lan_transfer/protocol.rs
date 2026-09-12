/*!
 * 局域网传输协议定义
 *
 * 定义设备发现、连接建立、文件传输所需的数据结构
 *
 * 协议概述：
 * 1. 设备通过 mDNS 广播自身信息（服务类型：_huanvae-transfer._tcp.local）
 * 2. 发送方向接收方发送连接请求
 * 3. 接收方确认后建立传输通道
 * 4. 文件分块传输，整文件以 SHA-256 校验完整性（分块偏移由 /api/upload?offset= 校验）
 */

use serde::{Deserialize, Serialize};

// ============================================================================
// 常量定义
// ============================================================================

/// mDNS 服务类型
/// 注意：RFC 6763 规定服务类型名主体部分不能超过 15 字节
/// "hvae-xfer" = 9 字符，符合规范
pub const SERVICE_TYPE: &str = "_hvae-xfer._tcp.local.";

/// 服务端口
pub const SERVICE_PORT: u16 = 53317;

/// 文件块大小：1MB
pub const CHUNK_SIZE: usize = 1024 * 1024;

/// 协议版本
pub const PROTOCOL_VERSION: &str = "1.0";

// ============================================================================
// 设备信息
// ============================================================================

/// 设备信息（本机）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    /// 设备唯一标识（基于 MAC 地址生成）
    pub device_id: String,
    /// 设备名称（计算机名）
    pub device_name: String,
    /// 用户 ID
    pub user_id: String,
    /// 用户昵称
    pub user_nickname: String,
    /// IP 地址
    pub ip_address: String,
    /// 服务端口
    pub port: u16,
    /// 协议版本
    pub version: String,
    /// 操作系统
    pub os: String,
}

/// 发现的设备信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredDevice {
    /// 设备唯一标识
    pub device_id: String,
    /// 设备名称
    pub device_name: String,
    /// 用户 ID
    pub user_id: String,
    /// 用户昵称
    pub user_nickname: String,
    /// IP 地址
    pub ip_address: String,
    /// 服务端口
    pub port: u16,
    /// 发现时间
    pub discovered_at: String,
    /// 最后活跃时间
    pub last_seen: String,
}

// ============================================================================
// 连接请求（旧版，已废弃，仅保留类型定义供编译通过）
// ============================================================================

/// 连接请求（已废弃，使用 PeerConnectionRequest 替代）
#[allow(dead_code, deprecated)]
#[deprecated(note = "使用 PeerConnectionRequest 替代")]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionRequest {
    /// 请求 ID
    pub request_id: String,
    /// 请求方设备信息
    pub from_device: DiscoveredDevice,
    /// 请求时间
    pub requested_at: String,
    /// 请求状态
    pub status: ConnectionStatus,
}

/// 连接状态（已废弃）
#[allow(dead_code)]
#[deprecated(note = "使用 PeerConnectionStatus 替代")]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionStatus {
    /// 待确认
    Pending,
    /// 已接受
    Accepted,
    /// 已拒绝
    Rejected,
    /// 已过期
    Expired,
}

/// 连接响应（已废弃）
#[allow(dead_code)]
#[deprecated(note = "使用 PeerConnection 替代")]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionResponse {
    /// 请求 ID
    pub request_id: String,
    /// 是否接受
    pub accepted: bool,
    /// 响应方设备信息
    pub from_device: DeviceInfo,
}

// ============================================================================
// 点对点连接（Peer Connection）
// ============================================================================

/// 点对点连接状态
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PeerConnectionStatus {
    /// 已连接
    Connected,
    /// 已断开
    Disconnected,
}

/// 点对点连接（建立连接后可双向传输文件）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerConnection {
    /// 连接 ID
    pub connection_id: String,
    /// 对端设备信息
    pub peer_device: DiscoveredDevice,
    /// 连接建立时间
    pub established_at: String,
    /// 连接状态
    pub status: PeerConnectionStatus,
    /// 是否为发起方
    pub is_initiator: bool,
}

/// 连接请求（用于建立点对点连接）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerConnectionRequest {
    /// 连接 ID
    pub connection_id: String,
    /// 请求方设备信息
    pub from_device: DiscoveredDevice,
    /// 请求时间
    pub requested_at: String,
}

/// 连接响应（点对点连接）
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerConnectionResponse {
    /// 连接 ID
    pub connection_id: String,
    /// 是否接受
    pub accepted: bool,
    /// 响应方设备信息（接受时提供）
    pub from_device: Option<DiscoveredDevice>,
}

// ============================================================================
// 文件传输
// ============================================================================

/// 文件元信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMetadata {
    /// 文件 ID
    pub file_id: String,
    /// 文件名
    pub file_name: String,
    /// 文件大小（字节）
    pub file_size: u64,
    /// 文件 MIME 类型
    pub mime_type: String,
    /// 文件哈希 (SHA-256，64 字符十六进制)
    /// 用于传输完整性验证（D-04：字段名保持 sha256 以兼容现有协议，
    /// 内容自 2026-02 起为真实 SHA-256；8 字符十六进制为旧版 CRC32 legacy 值）
    pub sha256: String,
}

// ============================================================================
// 断点续传
// ============================================================================

/// 断点续传信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeInfo {
    /// 文件 ID
    pub file_id: String,
    /// 文件哈希（SHA-256，用于校验是否是同一个文件；
    /// 旧版断点文件中 8 位十六进制为 CRC32 legacy 值，不可比时不因哈希拒绝续传）
    /// 字段名保持 file_sha256 以兼容现有协议
    pub file_sha256: String,
    /// 本地临时文件路径
    pub temp_file_path: String,
    /// 已传输字节数
    pub transferred_bytes: u64,
    /// 已接收块的哈希列表（用于校验）
    pub chunk_hashes: Vec<String>,
    /// 最后更新时间
    pub last_updated: String,
}

// ============================================================================
// 传输会话（多文件）
// ============================================================================

/// 传输会话（支持多文件）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferSession {
    /// 会话 ID
    pub session_id: String,
    /// 关联的连接 ID（点对点连接模式）
    #[serde(default)]
    pub connection_id: String,
    /// 关联的传输请求 ID（旧模式，保留兼容）
    pub request_id: String,
    /// 文件传输状态列表
    pub files: Vec<FileTransferState>,
    /// 原始文件路径列表（发送方使用）
    #[serde(default)]
    pub file_paths: Vec<String>,
    /// 会话状态
    pub status: SessionStatus,
    /// 创建时间
    pub created_at: String,
    /// 目标设备
    pub target_device: DiscoveredDevice,
    /// 传输方向
    pub direction: TransferDirection,
}

/// 文件传输状态
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTransferState {
    /// 文件元信息
    pub file: FileMetadata,
    /// 传输状态
    pub status: TransferStatus,
    /// 已传输字节数
    pub transferred_bytes: u64,
    /// 断点续传信息（如果有）
    pub resume_info: Option<ResumeInfo>,
}

/// 会话状态
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    /// 等待开始
    Pending,
    /// 传输中
    Transferring,
    /// 已暂停
    Paused,
    /// 已完成
    Completed,
    /// 失败
    Failed,
    /// 已取消
    Cancelled,
}

// ============================================================================
// 批量传输进度
// ============================================================================

/// 单文件进度信息（用于前端显示文件列表）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileProgressInfo {
    /// 文件 ID
    pub file_id: String,
    /// 文件名
    pub file_name: String,
    /// 文件大小（字节）
    pub file_size: u64,
    /// 已传输字节数
    pub transferred_bytes: u64,
    /// 传输状态
    pub status: TransferStatus,
}

/// 批次中失败文件的描述（batch_transfer_completed.failed_files 元素，D-15）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FailedFileInfo {
    /// 文件 ID
    pub file_id: String,
    /// 文件名
    pub file_name: String,
    /// 失败原因
    pub error: String,
}

/// 批量传输进度
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchTransferProgress {
    /// 会话 ID
    pub session_id: String,
    /// 总文件数
    pub total_files: u32,
    /// 已完成文件数
    pub completed_files: u32,
    /// 总字节数
    pub total_bytes: u64,
    /// 已传输字节数
    pub transferred_bytes: u64,
    /// 传输速度（字节/秒）
    pub speed: u64,
    /// 当前正在传输的文件
    pub current_file: Option<FileMetadata>,
    /// 预计剩余时间（秒）
    pub eta_seconds: Option<u64>,
    /// 每个文件的进度信息
    #[serde(default)]
    pub files: Vec<FileProgressInfo>,
    /// 传输方向（"send" | "receive"，D-01/D-22：serde default 保证向后兼容）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub direction: Option<TransferDirection>,
    /// 对端设备 ID（发送侧 = 目标设备；接收侧 = 发起方）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub peer_device_id: Option<String>,
    /// 对端设备名
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub peer_device_name: Option<String>,
}

/// 根据文件终态集合推导整批 outcome（纯函数，发送端/接收端共用，D-15）。
///
/// 规则：全部完成 → completed；全部失败 → failed；全部取消 → cancelled；
/// 其余混合情况（含部分失败）→ partial。
pub fn compute_batch_outcome(statuses: &[TransferStatus]) -> &'static str {
    let total = statuses.len();
    let completed = statuses.iter().filter(|s| **s == TransferStatus::Completed).count();
    let failed = statuses.iter().filter(|s| **s == TransferStatus::Failed).count();
    let cancelled = statuses.iter().filter(|s| **s == TransferStatus::Cancelled).count();

    if total == 0 || completed == total {
        "completed"
    } else if failed == total {
        "failed"
    } else if cancelled == total {
        "cancelled"
    } else {
        "partial"
    }
}

/// 是否为旧版 CRC32 哈希（8 位十六进制）。
/// 新协议为 SHA-256（64 位十六进制）；续传兼容判定用（D-04）。
pub fn is_legacy_crc32_hash(hash: &str) -> bool {
    hash.len() == 8 && hash.chars().all(|c| c.is_ascii_hexdigit())
}

/// 计算数据的 SHA-256 十六进制字符串（流式与一次性结果一致的便捷封装）
/// （生产路径直接用 hasher 增量计算；本函数供测试与便捷调用）
#[allow(dead_code)]
pub fn sha256_hex(data: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

// ============================================================================
// 文件传输 API
// ============================================================================

/// 传输准备请求（支持断点续传）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareUploadRequest {
    /// 会话 ID
    pub session_id: String,
    /// 文件元信息
    pub file: FileMetadata,
    /// 是否尝试断点续传
    pub resume: bool,
    /// 目标文件路径（Android 直接写入公共目录时使用）
    /// 如果提供，则跳过临时文件，直接写入此路径
    #[serde(default)]
    pub target_path: Option<String>,
}

/// 传输准备响应（支持断点续传）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareUploadResponse {
    /// 会话 ID
    pub session_id: String,
    /// 是否接受
    pub accepted: bool,
    /// 断点续传偏移量（0 表示从头开始）
    pub resume_offset: u64,
    /// 拒绝原因（如果有）
    pub reject_reason: Option<String>,
    /// 保存目录
    pub save_directory: Option<String>,
}

/// 块传输信息
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkInfo {
    /// 文件 ID
    pub file_id: String,
    /// 块索引
    pub chunk_index: u64,
    /// 块大小
    pub chunk_size: usize,
    /// 块哈希 (CRC32，8字符十六进制)
    pub chunk_hash: String,
    /// 起始偏移
    pub offset: u64,
}

/// 块传输响应
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkResponse {
    /// 是否成功接收
    pub success: bool,
    /// 下一个期望的偏移量
    pub next_offset: u64,
    /// 错误信息
    pub error: Option<String>,
}

/// 传输完成请求
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishUploadRequest {
    /// 会话 ID
    pub session_id: String,
    /// 文件 ID
    pub file_id: String,
}

/// 传输完成响应
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishUploadResponse {
    /// 是否成功
    pub success: bool,
    /// 哈希是否匹配 (CRC32)
    /// 字段名保持 sha256_match 以兼容现有协议
    pub sha256_match: bool,
    /// 保存路径
    pub saved_path: Option<String>,
    /// 错误信息
    pub error: Option<String>,
}

// ============================================================================
// 批量传输准备 API（多文件传输）
// ============================================================================

/// 批量传输准备请求
///
/// 在传输多个文件前，发送方先调用此 API 通知接收方即将传输的所有文件列表
/// 接收方创建会话并预分配资源，后续的 prepare-upload 请求会添加到此会话
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchPrepareRequest {
    /// 会话 ID（由发送方生成）
    pub session_id: String,
    /// 文件列表
    pub files: Vec<FileMetadata>,
    /// 总字节数
    pub total_size: u64,
    /// 发送方设备信息
    pub from_device: DiscoveredDevice,
}

/// 批量传输准备响应
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchPrepareResponse {
    /// 会话 ID
    pub session_id: String,
    /// 是否接受
    pub accepted: bool,
    /// 文件数量
    pub file_count: u32,
    /// 拒绝原因（如果有）
    pub reject_reason: Option<String>,
}

// ============================================================================
// 传输任务
// ============================================================================

/// 传输任务
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferTask {
    /// 任务 ID
    pub task_id: String,
    /// 会话 ID
    pub session_id: String,
    /// 文件信息
    pub file: FileMetadata,
    /// 传输方向
    pub direction: TransferDirection,
    /// 目标设备
    pub target_device: DiscoveredDevice,
    /// 传输状态
    pub status: TransferStatus,
    /// 已传输字节数
    pub transferred_bytes: u64,
    /// 传输速度（字节/秒）
    pub speed: u64,
    /// 开始时间
    pub started_at: String,
    /// 预计剩余时间（秒）
    pub eta_seconds: Option<u64>,
}

/// 传输方向
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TransferDirection {
    /// 发送
    Send,
    /// 接收
    Receive,
}

/// 传输状态
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TransferStatus {
    /// 等待中
    Pending,
    /// 传输中
    Transferring,
    /// 已暂停
    Paused,
    /// 已完成
    Completed,
    /// 失败
    Failed,
    /// 已取消
    Cancelled,
}

// ============================================================================
// 事件通知
// ============================================================================

/// 局域网传输事件（用于前端通知）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LanTransferEvent {
    /// 发现新设备
    DeviceDiscovered { device: DiscoveredDevice },
    /// 设备离线
    DeviceLeft { device_id: String },

    // ========== 点对点连接事件 ==========
    /// 收到连接请求（点对点连接）
    PeerConnectionRequest { request: PeerConnectionRequest },
    /// 连接已建立（双方都会收到）
    PeerConnectionEstablished { connection: PeerConnection },
    /// 连接已关闭
    PeerConnectionClosed { connection_id: String },

    // ========== 旧版连接事件（已废弃，将在下个版本移除） ==========
    /// 收到连接请求（已废弃，使用 PeerConnectionRequest 事件替代）
    #[allow(deprecated)]
    ConnectionRequest {
        #[allow(deprecated)]
        request: ConnectionRequest,
    },
    /// 连接响应（已废弃，使用 PeerConnectionEstablished 事件替代）
    ConnectionResponse { request_id: String, accepted: bool },

    // ========== 文件传输事件 ==========
    /// 单文件传输进度更新
    TransferProgress { task: TransferTask },
    /// 批量传输进度更新
    BatchProgress { progress: BatchTransferProgress },
    /// 传输完成
    TransferCompleted { task_id: String, saved_path: String },
    /// 批量传输完成
    /// D-15：outcome 显式化终态（completed/cancelled/failed/partial），
    /// failed_files 列出失败文件；两者 serde default 保证旧事件可反序列化
    BatchTransferCompleted {
        session_id: String,
        total_files: u32,
        save_directory: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        outcome: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        failed_files: Option<Vec<FailedFileInfo>>,
    },
    /// 传输失败
    TransferFailed { task_id: String, error: String },
    /// 服务状态变化
    ServiceStateChanged { is_running: bool },

    // ========== 哈希计算进度事件 ==========
    /// 文件哈希计算进度（大文件预处理时显示）
    HashingProgress {
        /// 文件名
        file_name: String,
        /// 文件大小（字节）
        file_size: u64,
        /// 已处理字节数
        processed_bytes: u64,
        /// 当前文件索引（从 1 开始）
        current_file: u32,
        /// 总文件数
        total_files: u32,
    },
}


// ============================================================================
// 单元测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// D-04：SHA-256 已知向量（NIST FIPS 180-4 示例）+ 流式/一次性一致性
    #[test]
    fn sha256_known_vectors() {
        // SHA-256(b"abc") =
        // ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        // SHA-256(b"") = e3b0c442...（空输入，覆盖 0 字节文件的 finish 校验路径）
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        // 流式喂入（分两块）与一次性结果一致——传输侧增量更新的正确性依据
        use sha2::Digest;
        let mut h = sha2::Sha256::new();
        h.update(b"ab");
        h.update(b"c");
        assert_eq!(hex::encode(h.finalize()), sha256_hex(b"abc"));
        // 超过一个块大小的输入（CHUNK_SIZE 边界）
        let big = vec![0xABu8; CHUNK_SIZE + 7];
        let mut h = sha2::Sha256::new();
        h.update(&big[..CHUNK_SIZE]);
        h.update(&big[CHUNK_SIZE..]);
        assert_eq!(hex::encode(h.finalize()), sha256_hex(&big));
    }

    /// D-04：legacy CRC32 哈希识别（8 位十六进制）
    #[test]
    fn legacy_crc32_hash_detection() {
        assert!(is_legacy_crc32_hash("deadbeef"));
        assert!(is_legacy_crc32_hash("00000000"));
        assert!(!is_legacy_crc32_hash(""), "空串不是 legacy 哈希");
        assert!(!is_legacy_crc32_hash("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"), "SHA-256 不是 legacy");
        assert!(!is_legacy_crc32_hash("deadbeeff"), "9 位不是 legacy");
        assert!(!is_legacy_crc32_hash("zzzzzzzz"), "非十六进制不是 legacy");
    }

    /// D-15：outcome 推导规则
    #[test]
    fn batch_outcome_derivation() {
        use TransferStatus::*;
        assert_eq!(compute_batch_outcome(&[]), "completed", "空会话视为完成");
        assert_eq!(compute_batch_outcome(&[Completed, Completed]), "completed");
        assert_eq!(compute_batch_outcome(&[Failed, Failed]), "failed");
        assert_eq!(compute_batch_outcome(&[Cancelled, Cancelled]), "cancelled");
        // 部分失败 → partial（D-15 核心场景）
        assert_eq!(compute_batch_outcome(&[Completed, Failed]), "partial");
        // 完成 + 取消混合 → partial
        assert_eq!(compute_batch_outcome(&[Completed, Cancelled]), "partial");
        // 失败 + 取消混合 → partial
        assert_eq!(compute_batch_outcome(&[Failed, Cancelled]), "partial");
    }
}
