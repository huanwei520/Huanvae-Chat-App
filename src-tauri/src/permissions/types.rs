//! 媒体权限相关类型定义
//!
//! 定义了跨平台的权限类型、修复命令和权限指南结构

use serde::{Deserialize, Serialize};

/// 媒体权限类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MediaPermissionType {
    /// 摄像头权限
    Camera,
    /// 麦克风权限
    Microphone,
    /// 屏幕共享/录制权限
    ScreenCapture,
}


/// 权限修复命令
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionFixCommand {
    /// 命令描述
    pub description: String,
    /// 要执行的命令
    pub command: String,
    /// 是否需要管理员权限
    pub requires_admin: bool,
    /// 执行后是否需要重启应用
    pub requires_restart: bool,
}

/// 权限修复指南
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionGuide {
    /// 操作系统名称
    pub os: String,
    /// 权限类型中文名称
    pub permission_name: String,
    /// 修复步骤说明
    pub steps: Vec<String>,
    /// 可执行的修复命令列表
    pub fix_commands: Vec<PermissionFixCommand>,
    /// 是否支持一键打开设置
    pub can_open_settings: bool,
    /// 设置页面路径说明
    pub settings_path: String,
    /// 系统设置 URI（如有）
    pub settings_uri: Option<String>,
}

impl Default for PermissionGuide {
    fn default() -> Self {
        Self {
            os: "Unknown".into(),
            permission_name: "未知权限".into(),
            steps: vec!["请手动检查系统权限设置".into()],
            fix_commands: vec![],
            can_open_settings: false,
            settings_path: "系统设置".into(),
            settings_uri: None,
        }
    }
}
