//! 局域网传输诊断系统类型定义
//!
//! 所有平台共享的数据结构，包括诊断状态、诊断项、诊断报告等。
//!
//! # 使用示例
//!
//! ```rust
//! use crate::lan_transfer::diagnostics::types::*;
//!
//! let item = DiagItem {
//!     id: "W1".into(),
//!     name: "网络接口".into(),
//!     category: DiagCategory::Network,
//!     // ...
//! };
//! ```

use serde::{Deserialize, Serialize};

// ============================================================================
// 诊断状态
// ============================================================================

/// 诊断状态枚举
///
/// 表示单个检查项的结果状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiagStatus {
    /// 检查通过，功能正常
    Ok,
    /// 警告，可能影响部分功能
    Warning,
    /// 错误，功能无法正常工作
    Error,
    /// 无法检测（权限不足或命令不存在）
    Unknown,
    /// 跳过（不适用于当前环境）
    Skipped,
}

// ============================================================================
// 诊断分类
// ============================================================================

/// 诊断项分类
///
/// 用于对检查项进行分组显示
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagCategory {
    /// 网络接口和连接
    Network,
    /// 防火墙规则
    Firewall,
    /// 系统服务
    Service,
    /// 权限设置
    Permission,
    /// 端口状态
    Port,
}

// ============================================================================
// 诊断项
// ============================================================================

/// 单项诊断结果
///
/// 包含检查项的详细信息、状态和修复建议
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagItem {
    /// 检查项唯一标识（如 W1, L2, M3）
    pub id: String,

    /// 检查项名称（人类可读）
    pub name: String,

    /// 检查项分类
    pub category: DiagCategory,

    /// 检查项描述
    pub description: String,

    /// 检查结果状态
    pub status: DiagStatus,

    /// 详细信息（检查结果的具体说明）
    pub details: String,

    /// 修复建议（人类可读的解决方案）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fix_suggestion: Option<String>,

    /// 修复命令（可直接复制执行）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fix_command: Option<String>,

    /// 修复步骤（GUI 操作指引）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fix_steps: Option<Vec<String>>,

    /// 官方文档链接
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doc_url: Option<String>,
}

// ============================================================================
// 诊断报告
// ============================================================================

/// 完整诊断报告
///
/// 包含所有检查项的结果和汇总信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagReport {
    /// 操作系统名称
    pub os: String,

    /// 操作系统版本
    pub os_version: String,

    /// 诊断执行时间（ISO 8601 格式）
    pub timestamp: String,

    /// 总体状态（所有检查项的综合结果）
    pub overall_status: DiagStatus,

    /// 各项诊断结果列表
    pub items: Vec<DiagItem>,

    /// 快速修复命令汇总（仅包含需要修复的项）
    pub quick_fix_commands: Vec<String>,

    /// 错误数量
    pub error_count: usize,

    /// 警告数量
    pub warning_count: usize,
}

impl DiagReport {
    /// 从诊断项列表创建报告
    pub fn from_items(os: String, os_version: String, items: Vec<DiagItem>) -> Self {
        let error_count = items.iter().filter(|i| i.status == DiagStatus::Error).count();
        let warning_count = items.iter().filter(|i| i.status == DiagStatus::Warning).count();

        let overall_status = if error_count > 0 {
            DiagStatus::Error
        } else if warning_count > 0 {
            DiagStatus::Warning
        } else {
            DiagStatus::Ok
        };

        let quick_fix_commands: Vec<String> = items
            .iter()
            .filter(|i| i.status == DiagStatus::Error || i.status == DiagStatus::Warning)
            .filter_map(|i| i.fix_command.clone())
            .collect();

        Self {
            os,
            os_version,
            timestamp: chrono::Utc::now().to_rfc3339(),
            overall_status,
            items,
            quick_fix_commands,
            error_count,
            warning_count,
        }
    }
}

// ============================================================================
// 诊断器 Trait
// ============================================================================

/// 诊断器 trait
///
/// 各平台实现此 trait 以提供平台特定的诊断逻辑
#[allow(async_fn_in_trait)]
pub trait Diagnostician: Send + Sync {
    /// 执行完整诊断，返回诊断报告
    async fn diagnose(&self) -> DiagReport;
}
