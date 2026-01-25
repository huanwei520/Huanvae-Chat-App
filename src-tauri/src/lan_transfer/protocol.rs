/*!
 * 局域网传输协议定义
 *
 * 定义设备发现、连接建立、文件传输所需的数据结构
 *
 * 协议概述：
 * 1. 设备通过 mDNS 广播自身信息（服务类型：_huanvae-transfer._tcp.local）
 * 2. 发送方向接收方发送连接请求
 * 3. 接收方确认后建立传输通道
 * 4. 文件分块传输，每块进行 CRC32 校验（高性能跨平台）
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
// 连接请求
// ============================================================================

/// 连接请求
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

/// 连接状态
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

/// 连接响应
#[allow(dead_code)]
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
    /// 文件哈希 (CRC32，8字符十六进制)
    /// 用于传输完整性验证，采用高性能 crc32fast 库
    pub sha256: String,  // 字段名保持不变以兼容现有协议
}

// ============================================================================
// 传输请求（文件传输前的确认）
// ============================================================================

/// 传输请求（发送文件前需要对方确认）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferRequest {
    /// 请求 ID
    pub request_id: String,
    /// 请求方设备信息
    pub from_device: DiscoveredDevice,
    /// 要传输的文件列表
    pub files: Vec<FileMetadata>,
    /// 总大小（字节）
    pub total_size: u64,
    /// 请求时间
    pub requested_at: String,
    /// 请求状态
    pub status: TransferRequestStatus,
}

/// 传输请求状态
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TransferRequestStatus {
    /// 等待确认
    Pending,
    /// 已接受
    Accepted,
    /// 已拒绝
    Rejected,
    /// 已过期
    Expired,
}

/// 传输请求响应
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferRequestResponse {
    /// 请求 ID
    pub request_id: String,
    /// 是否接受
    pub accepted: bool,
    /// 拒绝原因（如果有）
    pub reject_reason: Option<String>,
    /// 保存目录
    pub save_directory: Option<String>,
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
    /// 文件哈希（CRC32，用于校验是否是同一个文件）
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

    // ========== 旧版连接事件（保留兼容） ==========
    /// 收到连接请求（旧版，保留兼容）
    ConnectionRequest { request: ConnectionRequest },
    /// 连接响应（旧版，保留兼容）
    ConnectionResponse { request_id: String, accepted: bool },

    // ========== 文件传输事件 ==========
    /// 收到传输请求（文件传输前的确认）
    TransferRequestReceived { request: TransferRequest },
    /// 传输请求响应
    TransferRequestResponse {
        request_id: String,
        accepted: bool,
        reject_reason: Option<String>,
    },
    /// 单文件传输进度更新
    TransferProgress { task: TransferTask },
    /// 批量传输进度更新
    BatchProgress { progress: BatchTransferProgress },
    /// 传输完成
    TransferCompleted { task_id: String, saved_path: String },
    /// 批量传输完成
    BatchTransferCompleted {
        session_id: String,
        total_files: u32,
        save_directory: String,
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

