fn main() {
    // 配置 Windows 应用程序清单，要求管理员权限运行
    let mut windows = tauri_build::WindowsAttributes::new();
    windows = windows.app_manifest(include_str!("manifest.xml"));
    
    let attrs = tauri_build::Attributes::new().windows_attributes(windows);
    tauri_build::try_build(attrs).expect("failed to run build script");
}
