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
; 参考文档：
; - Tauri NSIS Hooks: https://v2.tauri.app/distribute/windows-installer/
; - Windows netsh: https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/netsh-advfirewall
;
; ============================================================================

; ============================================================================
; 安装前钩子 (保留原有功能)
; ============================================================================
!macro NSIS_HOOK_PREINSTALL
  ; 从注册表读取已安装版本的路径
  ; Tauri NSIS 安装器会将安装路径写入注册表的 Uninstall 键
  
  ; 首先尝试读取 perMachine (HKLM) 安装的路径
  ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Huanvae-Chat-App" "InstallLocation"
  
  StrCmp $0 "" 0 preinstall_found_path
  
  ; 尝试读取 currentUser (HKCU) 安装的路径
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Huanvae-Chat-App" "InstallLocation"
  
  StrCmp $0 "" preinstall_not_found preinstall_found_path
  
  preinstall_found_path:
    ; 找到了已安装路径，使用它
    StrCpy $INSTDIR $0
    Goto preinstall_done
    
  preinstall_not_found:
    ; 未找到已安装版本，保持默认路径
    
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
; 卸载前钩子 (可选，此处留空)
; ============================================================================
!macro NSIS_HOOK_PREUNINSTALL
  ; 卸载前无需特殊操作
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
