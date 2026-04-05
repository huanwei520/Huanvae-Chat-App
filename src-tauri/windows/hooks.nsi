; Huanvae Chat App - NSIS 安装钩子
; 自定义升级流程：在安装前先卸载旧版本

!macro NSIS_HOOK_PREINSTALL
  ; 读取旧版本的卸载程序路径 (HKCU - 用户级安装)
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Huanvae-Chat-App" "UninstallString"
  
  ${If} $0 != ""
    ; 存在旧版本，执行静默卸载
    DetailPrint "检测到旧版本，正在卸载..."
    
    ; 提取卸载程序目录
    ${GetParent} $0 $1
    
    ; 静默卸载旧版本 (/S = 静默模式, _?= 指定安装目录避免重启)
    ExecWait '"$0" /S _?=$1'
    
    ; 等待卸载完成和文件释放
    Sleep 2000
    
    ; 清理残留文件（如果存在）
    RMDir /r "$1"
    
    DetailPrint "旧版本已卸载"
  ${EndIf}
  
  ; 也检查 HKLM（机器级安装）
  ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Huanvae-Chat-App" "UninstallString"
  
  ${If} $0 != ""
    DetailPrint "检测到系统级旧版本，正在卸载..."
    
    ${GetParent} $0 $1
    ExecWait '"$0" /S _?=$1'
    Sleep 2000
    RMDir /r "$1"
    
    DetailPrint "系统级旧版本已卸载"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; 安装完成后的操作
  DetailPrint "安装完成"

  ; 安装 HuanvaeGuard Windows Service（auto 模式，开机自动启动）
  DetailPrint "正在安装 HuanvaeGuard 服务..."
  nsExec::ExecToLog 'sc.exe create HuanvaeGuard binPath= "$INSTDIR\HuanvaeGuard\huanvaeguard-svc.exe" start= auto DisplayName= "HuanvaeGuard VPN Service"'
  nsExec::ExecToLog 'sc.exe description HuanvaeGuard "HuanvaeGuard VPN tunnel service for Huanvae Chat"'
  ; 立即启动服务
  nsExec::ExecToLog 'sc.exe start HuanvaeGuard'
  DetailPrint "HuanvaeGuard 服务已安装并启动"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; 卸载前的操作（如停止进程等）
  ; 尝试关闭正在运行的应用
  nsExec::ExecToLog 'taskkill /F /IM huanvae-chat-app.exe'
  Sleep 1000

  ; 停止并删除 HuanvaeGuard 服务
  DetailPrint "正在卸载 HuanvaeGuard 服务..."
  nsExec::ExecToLog 'sc.exe stop HuanvaeGuard'
  Sleep 2000
  nsExec::ExecToLog 'sc.exe delete HuanvaeGuard'
  DetailPrint "HuanvaeGuard 服务已卸载"
!macroend
