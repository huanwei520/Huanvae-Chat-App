; ============================================================================
; Huanvae Chat - NSIS 安装器钩子
; ============================================================================
;
; 功能：
; 1. 自动配置防火墙规则，使局域网文件传输功能无需手动配置
; 2. 更新时自动卸载旧版本，避免文件锁定问题
;
; 防火墙规则：
; - mDNS (UDP 5353) - 用于设备发现
; - 传输端口 (TCP 53317) - 用于文件传输
; - 应用程序规则 - 允许应用所有网络访问
;
; 更新流程（卸载优先策略）：
; 1. 从注册表读取已安装路径
; 2. 运行旧版卸载程序（静默模式）
;    - 卸载程序的 PREUNINSTALL 钩子会终止主进程及所有 WebView2 子进程
;    - 使用 taskkill /T 进程树终止，确保不遗漏子进程
; 3. 在原目录安装新版本
; 4. 重新添加防火墙规则
;
; 用户数据：
; - 存储在 AppData 目录，卸载/更新不受影响
;
; 参考文档：
; - Tauri NSIS Hooks: https://v2.tauri.app/distribute/windows-installer/
; - Windows netsh: https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/netsh-advfirewall
; - taskkill /T: https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/taskkill
;
; ============================================================================

; ============================================================================
; 安装前钩子 - 先卸载旧版本，再安装新版本
; ============================================================================
; 
; 更新策略：卸载优先
; - 不手动终止进程，让卸载程序统一处理
; - 卸载程序会触发 PREUNINSTALL 钩子，正确关闭所有进程（包括 WebView2）
; - 卸载完成后再安装，避免文件锁定问题
; - 用户数据在 AppData 目录，不受影响
;
; ============================================================================
!macro NSIS_HOOK_PREINSTALL
  ; ========== 第一步：从注册表读取已安装版本的路径 ==========
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
    
    ; ========== 第二步：运行旧版卸载程序（静默模式）==========
    ; 卸载程序会自动：
    ;   1. 触发 PREUNINSTALL 钩子，终止主进程和所有 WebView2 子进程
    ;   2. 删除程序文件
    ;   3. 触发 POSTUNINSTALL 钩子，清理防火墙规则
    ; 
    ; /S = 静默模式，不显示界面
    ; 用户数据在 AppData 目录，不会被删除
    
    IfFileExists "$1\uninstall.exe" 0 preinstall_skip_uninstall
      DetailPrint "检测到已安装版本，正在卸载..."
      
      ; 静默运行卸载程序，等待完成
      ; 卸载程序的 PREUNINSTALL 会负责终止所有进程
      ;
      ; 关键参数 _?=$1：
      ;   NSIS 卸载程序默认会复制自己到临时目录再执行，
      ;   这会导致原进程立即退出，ExecWait 无法正确等待。
      ;   添加 _?= 参数可以阻止复制到临时目录，使 ExecWait 正确等待卸载完成。
      ;   参考: https://nsis.sourceforge.io/When_I_use_ExecWait_uninstaller.exe_it_doesn't_wait_for_the_uninstaller
      ;
      ; 参数说明：
      ;   /S = 静默模式，不显示界面
      ;   _?=$1 = 指定安装目录，阻止复制到临时目录（必须是最后一个参数）
      ;
      ExecWait '"$1\uninstall.exe" /S _?=$1' $2
      
      ; 等待文件句柄释放
      Sleep 1000
      
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
; 卸载前钩子 - 关闭应用程序及所有子进程
; ============================================================================
; 
; 使用 taskkill /T 参数终止进程树，确保：
; - 主进程被终止
; - 所有 WebView2 子进程（GPU、网络、渲染等）被一并终止
; - 不会遗漏任何子进程导致文件锁定
;
; ============================================================================
!macro NSIS_HOOK_PREUNINSTALL
  ; ========== 终止主进程及其所有子进程 ==========
  ; /F = 强制终止
  ; /T = 终止进程树（包括所有子进程）
  ; /IM = 按进程名匹配
  
  ; 终止主进程及所有子进程（小写形式）
  nsExec::Exec 'taskkill /F /T /IM "huanvae-chat-app.exe"'
  Pop $0
  
  ; 终止主进程及所有子进程（大写形式）
  nsExec::Exec 'taskkill /F /T /IM "Huanvae-Chat-App.exe"'
  Pop $0
  
  ; 等待进程退出
  Sleep 500
  
  ; ========== 备用方案：确保 WebView2 进程被清理 ==========
  ; 如果进程树终止未能覆盖所有 WebView2 进程，使用命令行匹配作为备用
  ; 只终止与 Huanvae 相关的 WebView2 进程，不影响其他应用
  
  nsExec::Exec 'cmd /c wmic process where "name=''msedgewebview2.exe'' and commandline like ''%huanvae%''" call terminate >nul 2>&1'
  Pop $0
  
  ; 最终等待，确保所有进程完全退出
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
