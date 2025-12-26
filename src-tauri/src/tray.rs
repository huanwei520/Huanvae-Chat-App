//! 系统托盘模块
//!
//! 实现类似 QQ/微信 的系统托盘功能：
//! - 关闭窗口时隐藏到托盘，后台静默运行
//! - 托盘图标右键菜单：显示主窗口、退出
//! - 双击/单击托盘图标显示主窗口
//!
//! ## Tauri 2.x API
//! - `TrayIconBuilder`：创建托盘图标
//! - `Menu`/`MenuItem`：创建托盘菜单
//! - `on_menu_event`：处理菜单点击事件
//! - `on_tray_icon_event`：处理托盘图标点击事件

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, Manager,
};

/// 初始化系统托盘
///
/// 创建托盘图标和菜单，设置事件处理
pub fn setup_tray(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let app_handle = app.handle();

    // 创建托盘菜单项
    let show_item = MenuItem::with_id(app_handle, "show", "显示主窗口", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app_handle, "quit", "退出", true, None::<&str>)?;

    // 创建托盘菜单
    let menu = Menu::with_items(app_handle, &[&show_item, &quit_item])?;

    // 获取应用图标（使用默认窗口图标）
    let icon = app_handle
        .default_window_icon()
        .cloned()
        .ok_or("无法获取应用图标")?;

    // 创建托盘图标
    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .tooltip("Huanvae Chat")
        .show_menu_on_left_click(false) // 左键不弹出菜单，用于显示窗口
        .on_tray_icon_event(|tray, event| {
            // 单击托盘图标显示主窗口
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app_handle)?;

    Ok(())
}

