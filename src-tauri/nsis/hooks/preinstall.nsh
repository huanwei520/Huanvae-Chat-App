; Tauri NSIS 预安装钩子
; 功能：检测已安装版本的路径，确保更新时安装到原始位置
;
; Tauri NSIS 模板使用以下变量：
; - PRODUCTNAME: 产品名称 (来自 tauri.conf.json 的 productName)
; - INSTALLMODE: 安装模式 (currentUser, perMachine, both)

!macro PREINSTALL
  ; 从注册表读取已安装版本的路径
  ; Tauri NSIS 安装器会将安装路径写入注册表的 Uninstall 键
  
  ; 首先尝试读取 perMachine (HKLM) 安装的路径
  ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Huanvae-Chat-App" "InstallLocation"
  
  StrCmp $0 "" 0 found_path
  
  ; 尝试读取 currentUser (HKCU) 安装的路径
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Huanvae-Chat-App" "InstallLocation"
  
  StrCmp $0 "" not_found found_path
  
  found_path:
    ; 找到了已安装路径，使用它
    StrCpy $INSTDIR $0
    Goto done
    
  not_found:
    ; 未找到已安装版本，保持默认路径
    
  done:
!macroend

