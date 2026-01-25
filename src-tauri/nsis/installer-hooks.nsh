; Huanvae Chat App NSIS 安装钩子
; 在安装前关闭运行中的应用程序，避免 "exe 无法写入" 错误

!macro NSIS_HOOK_PREINSTALL
  ; 关闭运行中的主程序
  nsExec::ExecToLog 'taskkill /F /IM huanvae-chat-app.exe'
  
  ; 等待进程完全退出
  Sleep 1000
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; 安装后的操作（可选）
!macroend
