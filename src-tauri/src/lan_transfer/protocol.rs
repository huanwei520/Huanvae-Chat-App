/*!
 * 局域网传输协议定义
 *
 * 定义设备发现、连接建立、文件传输所需的数据结构
 *
 * 协议概述：
 * 1. 设备通过 mDNS 广播自身信息（服务类型：_huanvae-transfer._tcp.local）
 * 2. 发送方向接收方发送连接请求
 * 3. 接收方确认后建立传输通道
 * 4. 文件分块传输，每块进行 SHA-256 校验
 */

use serde::{Deserialize, Serialize};

// ============================================================================
// 常量定义
// ============================================================================

/// mDNS 服务类型
pub const SERVICE_TYPE: &str = "_huanvae-transfer._tcp.local.";

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
    /// 文件 SHA-256 哈希
    pub sha256: String,
}

/// 传输准备请求
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareUploadRequest {
    /// 会话 ID
    pub session_id: String,
    /// 文件列表
    pub files: Vec<FileMetadata>,
}

/// 传输准备响应
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareUploadResponse {
    /// 会话 ID
    pub session_id: String,
    /// 是否接受
    pub accepted: bool,
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
    /// 块 SHA-256 哈希
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
    /// SHA-256 是否匹配
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
    /// 收到连接请求
    ConnectionRequest { request: ConnectionRequest },
    /// 连接响应
    ConnectionResponse { request_id: String, accepted: bool },
    /// 传输进度更新
    TransferProgress { task: TransferTask },
    /// 传输完成
    TransferCompleted { task_id: String, saved_path: String },
    /// 传输失败
    TransferFailed { task_id: String, error: String },
    /// 服务状态变化
    ServiceStateChanged { is_running: bool },
}

