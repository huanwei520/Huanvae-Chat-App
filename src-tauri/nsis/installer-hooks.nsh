; ============================================================================
; Huanvae Chat - NSIS 安装器钩子
; ============================================================================
;
; 功能：自动配置防火墙规则，使局域网文件传输功能无需手动配置
;
; 添加的规则：
; - mDNS (UDP 5353) - 用于设备发现
; - 传输端口 (TCP 53317) - 用于文件传输
; - 应用程序规则 - 允许应用所有网络访问
;
; 更新流程：
; 1. 终止主进程和 WebView2 子进程
; 2. 运行旧版卸载程序（静默模式）
; 3. 在原目录安装新版本
;
; 参考文档：
; - Tauri NSIS Hooks: https://v2.tauri.app/distribute/windows-installer/
; - Windows netsh: https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/netsh-advfirewall
;
; ============================================================================

; ============================================================================
; 安装前钩子 - 关闭应用 + 运行卸载程序 + 读取安装路径
; ============================================================================
!macro NSIS_HOOK_PREINSTALL
  ; ========== 第一步：关闭正在运行的应用程序 ==========
  ; 使用 taskkill 命令终止正在运行的应用，避免 "无法写入" 错误
  ; /F = 强制终止, /IM = 按进程名匹配
  
  ; 终止主进程（小写形式，Tauri 实际生成的进程名）
  nsExec::Exec 'taskkill /F /IM "huanvae-chat-app.exe"'
  Pop $0
  
  ; 终止主进程（大写形式）
  nsExec::Exec 'taskkill /F /IM "Huanvae-Chat-App.exe"'
  Pop $0
  
  ; 等待主进程退出
  Sleep 500
  
  ; ========== 终止 WebView2 子进程 ==========
  ; WebView2 子进程可能不会随主进程自动退出，需要单独终止
  ; 使用 WMIC/PowerShell 只终止与 Huanvae 相关的 WebView2 进程
  ; 避免影响其他使用 WebView2 的应用
  
  ; 方法1：使用 WMIC 终止包含 huanvae 的 WebView2 进程
  nsExec::Exec 'cmd /c wmic process where "name=''msedgewebview2.exe'' and commandline like ''%huanvae%''" call terminate >nul 2>&1'
  Pop $0
  
  ; 方法2：使用 PowerShell 作为备用（更精确）
  nsExec::Exec 'cmd /c powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object {$_.Name -eq ''msedgewebview2.exe'' -and $_.CommandLine -like ''*huanvae*''} | ForEach-Object {Stop-Process -Id $_.ProcessId -Force -EA 0}" >nul 2>&1'
  Pop $0
  
  ; 等待所有进程完全退出
  Sleep 1500
  
  ; ========== 第二步：从注册表读取已安装版本的路径 ==========
  ; 需要先获取安装路径，才能找到卸载程序
  
  ; 首先尝试读取 perMachine (HKLM) 安装的路径
  ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Huanvae-Chat-App" "InstallLocation"
  
  StrCmp $0 "" 0 preinstall_found_path
  
  ; 尝试读取 currentUser (HKCU) 安装的路径
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Huanvae-Chat-App" "InstallLocation"
  
  StrCmp $0 "" preinstall_not_found preinstall_found_path
  
  preinstall_found_path:
    ; 找到了已安装路径，保存到变量
    StrCpy $1 $0
    
    ; ========== 第三步：运行旧版卸载程序（静默模式）==========
    ; 这可以彻底清理旧版 exe 文件，避免文件锁定问题
    ; /S = 静默模式，不显示界面
    ; 用户数据在 AppData 目录，不会被删除
    
    IfFileExists "$1\uninstall.exe" 0 preinstall_skip_uninstall
      DetailPrint "正在卸载旧版本..."
      ; 静默运行卸载程序，等待完成
      ExecWait '"$1\uninstall.exe" /S' $2
      ; 等待卸载完成，确保所有文件句柄释放
      Sleep 2000
      DetailPrint "旧版本卸载完成"
    
    preinstall_skip_uninstall:
    ; 使用已安装路径作为安装目录（保持位置一致）
    StrCpy $INSTDIR $1
    Goto preinstall_done
    
  preinstall_not_found:
    ; 未找到已安装版本，这是全新安装
    DetailPrint "未检测到已安装版本，执行全新安装"
    
  preinstall_done:
!macroend

; ============================================================================
; 安装后钩子 - 添加防火墙规则
; ============================================================================
!macro NSIS_HOOK_POSTINSTALL
  ; 定义规则名称常量
  !define RULE_MDNS "Huanvae Chat mDNS"
  !define RULE_TRANSFER "Huanvae Chat LAN Transfer"
  !define RULE_APP "Huanvae Chat App"

  ; ========== 添加 mDNS 防火墙规则 (UDP 5353) ==========
  ; mDNS 用于局域网设备发现，使用多播 DNS 协议
  ; 使用 nsExec 静默执行，不显示命令行窗口
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="${RULE_MDNS}" dir=in action=allow protocol=UDP localport=5353 profile=private,public enable=yes description="Huanvae Chat 局域网设备发现 (mDNS)"'
  Pop $0
  
  ; ========== 添加传输端口防火墙规则 (TCP 53317) ==========
  ; TCP 53317 用于文件传输 HTTP 服务
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="${RULE_TRANSFER}" dir=in action=allow protocol=TCP localport=53317 profile=private,public enable=yes description="Huanvae Chat 局域网文件传输"'
  Pop $0

  ; ========== 添加应用程序防火墙规则 ==========
  ; 为应用程序本身添加规则，确保所有入站连接被允许
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="${RULE_APP}" dir=in action=allow program="$INSTDIR\Huanvae-Chat-App.exe" profile=private,public enable=yes description="Huanvae Chat 应用程序"'
  Pop $0

  ; 清理定义
  !undef RULE_MDNS
  !undef RULE_TRANSFER
  !undef RULE_APP
!macroend

; ============================================================================
; 卸载前钩子 - 关闭应用程序
; ============================================================================
!macro NSIS_HOOK_PREUNINSTALL
  ; 卸载前也需要关闭应用程序，避免文件被占用
  
  ; 终止主进程
  nsExec::Exec 'taskkill /F /IM "huanvae-chat-app.exe"'
  Pop $0
  nsExec::Exec 'taskkill /F /IM "Huanvae-Chat-App.exe"'
  Pop $0
  
  ; 终止 WebView2 子进程
  nsExec::Exec 'cmd /c wmic process where "name=''msedgewebview2.exe'' and commandline like ''%huanvae%''" call terminate >nul 2>&1'
  Pop $0
  
  ; 等待进程退出
  Sleep 1000
!macroend

; ============================================================================
; 卸载后钩子 - 清理防火墙规则
; ============================================================================
!macro NSIS_HOOK_POSTUNINSTALL
  ; 定义规则名称常量
  !define RULE_MDNS "Huanvae Chat mDNS"
  !define RULE_TRANSFER "Huanvae Chat LAN Transfer"
  !define RULE_APP "Huanvae Chat App"

  ; ========== 删除 mDNS 防火墙规则 ==========
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${RULE_MDNS}"'
  Pop $0

  ; ========== 删除传输端口防火墙规则 ==========
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${RULE_TRANSFER}"'
  Pop $0

  ; ========== 删除应用程序防火墙规则 ==========
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${RULE_APP}"'
  Pop $0

  ; 清理定义
  !undef RULE_MDNS
  !undef RULE_TRANSFER
  !undef RULE_APP
!macroend
