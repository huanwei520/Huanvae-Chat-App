; Huanvae Chat App - NSIS 安装钩子
;
; 职责：
;   1. PREINSTALL：检测并静默卸载旧版本（HKCU + HKLM 双层），并**判定卸载到底成没成**
;   2. POSTINSTALL：注册 HuanvaeGuard Windows Service 并授予 AU SDDL，
;                   使非管理员运行的主程序也能启停服务（sc.exe sdset）
;   3. PREUNINSTALL：关闭主进程 + 停止并删除 HuanvaeGuard 服务
;
; SDDL 设计：默认 SCM 只允许 Admin 启停服务；我们附加 (A;;CCLCSWRPWPLOCRRC;;;AU)
;           让 Authenticated Users 可 Start/Stop，Tauri 进程（非管理员）即可通过
;           sc.exe start/stop 控制服务，匹配主程序生命周期。
;
; ── 提权前提（改这里之前先读完这一段）─────────────────────────────────────
; `sc.exe create` / `sc.exe sdset` 要求对 SCM 的写权限，只授予 Administrators。
; 本钩子在**安装器自己的进程上下文**里跑，而那个进程的提权级别由 Tauri NSIS 模板
; 按 `bundle.windows.nsis.installMode` 决定：
;     perMachine  -> RequestExecutionLevel admin   （本仓当前取值）
;     currentUser -> RequestExecutionLevel user    （旧取值，`sc create` 必失败 5=拒绝访问）
; ⇒ 这段代码的正确性**依赖** tauri.conf.json 里 installMode 保持 perMachine。
;   两边的一致性由 tests/winService.nsisContract.test.ts 机器守着。
;
; ── 🔴 每条 sc.exe 都必须 `Pop $0` 取返回码 ──────────────────────────────
; 历史教训（本文件自己的前科）：这段原来 7 条 nsExec 一条都没取 rc，末尾还无条件
; DetailPrint「HuanvaeGuard 服务已安装」——于是"注册失败"与"注册成功"在安装日志里
; **逐字同形**。用户装完打开 App 只看到一句「服务未运行」，没有任何一处会说出真相。
; 这就是 v1.1.35 之前 Windows 新装用户 VPN 用不了的直接成因之一。
; 新增任何 sc.exe 调用时，要么 `Pop $0` 判它，要么在注释里写清为什么这条的 rc 不算数。
;
; 🔴 这条纪律**不只管 sc.exe** —— PREINSTALL 里跑旧卸载器的那条 `ExecWait` 也曾经
; 不取退出码 + 无条件打印「旧版本已卸载」，是同一个病的第二处发作（已修，见下）。
; 本文件里任何"跑一个外部程序"的调用（nsExec:: / ExecWait / Exec）都适用：
; **要么取返回码并据它分支，要么写清为什么它的返回码不算数。**

; Add/Remove Programs 那条记录的键。与 Tauri NSIS 模板的
; `!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}"` 同址，
; PRODUCTNAME = Huanvae-Chat-App（tauri.conf.json）。提成一处，免得两个调用点各写一遍写岔。
!define HUANVAE_UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Huanvae-Chat-App"

; ── 🔴 跑旧卸载器同样必须取退出码，而且必须先把注册表里的引号剥掉 ─────────────
;
; 这一段原来是 `ExecWait '"$0" /S _?=$1'`（**不取 rc**）+ 随后**无条件**
; DetailPrint「旧版本已卸载」——与本文件 POSTINSTALL 那条前科是同一个病：
; 卸载失败与卸载成功在安装日志里逐字同形。
;
; 而且它在改之前**几乎肯定一次也没成功过**：Tauri NSIS 模板把 UninstallString 写成
; **带引号**的（模板原文 `WriteRegStr SHCTX "${UNINSTKEY}" "UninstallString" "$\"$INSTDIR\uninstall.exe$\""`），
; 而 ${GetParent}（FileFunc）是纯字符串操作、不认引号 ⇒ $1 会带一个前导引号，
; 组出来的命令行以两个连续引号开头（`""C:\…\uninstall.exe" /S _?="C:\…`）⇒ 模块名是空串、
; 进程根本起不来；同一个 $1 喂给 RMDir 也必然失败。
; ⇒ 只补 rc 判断而不修引号，等于把一个静默的空操作变成一条**每次升级都报失败**的告警。
; 两条一起修。模板自己的同类代码就是正确写法的一手参照：它从另一个键取**不带引号**的
; 安装目录，且 `ExecWait '$R1' $0` 不再往外加引号。
;
; 「什么算失败」的口径（判据来自 NSIS 官方 ExecWait 语义 + 模板自己的判法）：
;   · 注册表里没有那条记录        → 根本没有旧版本，**不是失败**，整段跳过；
;   · error flag 置位             → 卸载器没能启动。官方原文：给了输出变量时**只有真出错才置
;                                   error flag，且此时那个变量的内容是未定义的** ⇒ 必须先看它，
;                                   再看 rc，顺序反了就会去读一个未定义值；
;   · rc != 0                     → 卸载器自己报的失败（模板把 rc=1 定义为"用户取消"）；
;   · rc == 0 但那条记录还在      → 卸载器说成了、实际没卸掉。这与 POSTINSTALL 里
;                                   「sc start 返回 0 ≠ 服务真起来」是同一条纪律：
;                                   不信自述，回头独立复核一次。复核用的是**同一个读取**
;                                   （单变量前后对照），因为卸载器会删掉自己那条记录。
!macro HUANVAE_UNINSTALL_PREVIOUS ROOT SCOPE
  ReadRegStr $0 ${ROOT} "${HUANVAE_UNINSTKEY}" "UninstallString"
  ${If} $0 != ""
    DetailPrint "检测到${SCOPE}旧版本，正在卸载..."

    ; ① 剥掉模板写进注册表的那对引号。首尾都是引号才剥，避免把真实字符切掉。
    ;    官方 StrCpy 语义（maxlen 为负 = 从末尾截掉 abs(maxlen) 个字符；start_offset 为正 = 从该
    ;    偏移起）⇒ `StrCpy $0 $0 -1 1` 正好去掉首尾各一个字符。
    StrCpy $2 $0 1
    StrCpy $3 $0 "" -1
    ${If} $2 == '"'
    ${AndIf} $3 == '"'
      StrCpy $0 $0 -1 1
    ${EndIf}

    ; ② 取旧安装目录。必须在剥引号之后 —— ${GetParent} 只按反斜杠切串，不处理引号。
    ${GetParent} $0 $1

    ; ③ 组命令行。/S = 静默；_?= 既指定卸载目录，也是让 ExecWait 真能等到卸载结束的唯一办法
    ;    （没有它，卸载器会把自己拷到临时目录再跑，父进程立刻拿到 rc）。
    ;
    ; 🔴 $UpdateMode = 1 时必须把 /UPDATE 一并传给旧卸载器，否则升级一次图标全没了 ──────
    ; 模板 installer.nsi 的 Section Uninstall 里有三处 `${If} $UpdateMode <> 1` 把
    ; 「删桌面/开始菜单 lnk + Unpin 任务栏 + 删 HKCU Run 自启项」整块围起来。旧卸载器是被
    ; **我们这条命令行**拉起的独立进程，它自己 un.onInit 里 `${GetOptions} $CMDLINE "/UPDATE"`
    ; 只认命令行 —— 我们不传，它的 $UpdateMode 就是 0 ⇒ 按"用户在主动卸载"把那三样全删掉。
    ; 而新安装器此时 $UpdateMode = 1，模板里建快捷方式的两处会直接 Return 不重建
    ; ⇒ 「删了不建」，桌面/开始菜单/任务栏/自启项一次升级全部消失，且安装日志里一个字都不会说。
    ; 真机单变量复现见 gen-49 单3（同一份 v1.1.37 字节，只差这一个 token）。
    ;
    ; 🔴 顺序不可换：/UPDATE 必须排在 _?= 之【前】。NSIS 官方手册 3.2.2 原文：
    ;    "_?= sets $INSTDIR ... It must be the last parameter used in the command line"
    ;    —— `_?=` 后面的一切都会被当成目录路径的一部分。写成 `_?=$1 /UPDATE` 时旧卸载器拿到的
    ;    $INSTDIR 变成 "<目录> /UPDATE"、而 $UpdateMode 仍是 0，两个后果一起发生且都不报错。
    ;    上游模板同序（installer.nsi:351 先 /UPDATE、:353 才 _?=），是一手参照。
    ;
    ; $UpdateMode 由模板声明（installer.nsi 的 `Var UpdateMode`）并在 .onInit 里从命令行解析。
    ; 本文件是被 `!include` 进模板的，宏体真正展开的位置在 Section Install 内，远在那条 Var 之后
    ; ⇒ 引用得到。这一点由 makensis 真编译担保，不靠读码推断（见 tests/ 同名守卫的说明）。
    ;
    ; BACKLOG: 本修法只让【今后】的升级不再丢快捷方式，救不了已经中招的存量用户 ——
    ; 他们的 lnk 已被删，而模板卸载段里 `Delete "$INSTDIR\${MAINBINARYNAME}.exe"` 是无条件的、
    ; 不受 $UpdateMode 影响，所以就算现在补建 lnk 也只会得到一个"点了没反应"的图标。
    ; 「要不要为存量用户单独做一次快捷方式迁移/重建」是产品决策，已上报，**本文件不做**。
    ;
    ; BACKLOG（同一决策的另一面，gen-49 单4 新发现，同样不在本次动手范围内）：
    ; 上面这条 /UPDATE 只在**同范围**升级（perMachine → perMachine，v1.1.36 起都是）下是纯收益 ——
    ; 那时旧 lnk 指向的目标路径与新 exe 路径相同，保住它就等于保住了一个能用的图标。
    ; 而**跨范围**升级（≤v1.1.35 的 currentUser 安装 → 现在的 perMachine）下，旧 lnk 指向的是
    ; %LOCALAPPDATA% 那份、而它的 exe 被上面这次卸载无条件删掉了 ⇒ 结果从「没有图标」变成
    ; 「图标还在但点了没反应」，HKCU Run 自启项同理会留下一条指向已删 exe 的死项。
    ; 若要连这一格也管住，最小改法是把条件收成 `${If} $UpdateMode = 1 ${AndIf} $1 == $INSTDIR`
    ; （只在旧安装目录 == 新安装目录时才传 /UPDATE）—— 但那属于上面那条产品决策的同一件事，
    ; 且本仓当前没有能造出跨范围现场的验证载体（gen-49 单3 实测两版同为 perMachine，观测不到）。
    StrCpy $5 '"$0" /S'
    ${If} $UpdateMode = 1
      StrCpy $5 "$5 /UPDATE"
    ${EndIf}
    StrCpy $5 "$5 _?=$1"
    ClearErrors
    ExecWait '$5' $2
    ; 等卸载器释放文件句柄
    Sleep 2000

    ; ④ 判定（顺序不可换，理由见本宏上方注释）
    ${If} ${Errors}
      DetailPrint "${SCOPE}旧版本卸载失败：没能启动旧版本的卸载程序"
    ${ElseIf} $2 != 0
      DetailPrint "${SCOPE}旧版本卸载失败：卸载程序返回 $2"
    ${Else}
      ReadRegStr $4 ${ROOT} "${HUANVAE_UNINSTKEY}" "UninstallString"
      ${If} $4 != ""
        DetailPrint "${SCOPE}旧版本卸载未完成：卸载程序报告成功，但它的卸载记录仍在"
      ${Else}
        ; 🔴 这里**故意**是非递归的 RMDir，不是 RMDir /r —— 别"顺手改回去"。
        ; 旧的用户级安装（NSIS currentUser 模式）INSTDIR = %LOCALAPPDATA%\Huanvae-Chat-App，
        ; 而新版把数据根固定在 %LOCALAPPDATA%\Huanvae-Chat-App\data（见 src-tauri/src/user_data.rs）
        ; —— 也就是说这个目录**就是用户聊天库所在的地方**。递归删会在升级时把
        ; chat_data.db / accounts.json / 文件缓存一起删掉。系统级那一路同理：用户把程序装到
        ; Program Files 以外的可写位置时，数据仍是 portable 布局（就在 $INSTDIR\data）。
        ; 非递归 RMDir 只在目录已经空了时才生效：程序文件由上面的卸载器删，data\ 留下。
        RMDir "$1"
        DetailPrint "${SCOPE}旧版本已卸载"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  ; 用户级安装（旧的 currentUser 模式写在 HKCU）
  !insertmacro HUANVAE_UNINSTALL_PREVIOUS HKCU "用户级"
  ; 机器级安装（perMachine 模式写在 HKLM）
  !insertmacro HUANVAE_UNINSTALL_PREVIOUS HKLM "系统级"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; 安装完成后的操作
  DetailPrint "安装完成"

  ; 安装 HuanvaeGuard Windows Service
  DetailPrint "正在安装 HuanvaeGuard 服务..."

  ; ── 1) 先停 + 删旧条目（两条的 rc 都**故意不判**，见下）────────────────────
  ; 为什么必须先删再建：SCM 里的服务条目记着一个**绝对** binPath。安装位置一变
  ; （典型：老用户从 currentUser 的 %LOCALAPPDATA% 升级到 perMachine 的 Program Files，
  ; 旧程序文件已被上面 PREINSTALL 里的卸载器删掉），旧条目就指向一个已经不存在的 exe；
  ; 此时直接 `sc create` 会撞 1073「指定的服务已存在」而 binPath 原封不动
  ; ⇒ 服务从此永远起不来，且每一步看上去都没报错。
  ; rc 不判的理由：服务本来就不存在时这两条必然失败（1060），那是**正常路径**，
  ; 判它反而会把干净的首次安装报成失败。真正要判的是下面的 create。
  nsExec::ExecToLog 'sc.exe stop HuanvaeGuard'
  Pop $0
  Sleep 2000
  nsExec::ExecToLog 'sc.exe delete HuanvaeGuard'
  Pop $0
  Sleep 1000

  ; ── 2) create —— 必须成功；失败即停止本段并当场说清 ──────────────────────
  nsExec::ExecToLog 'sc.exe create HuanvaeGuard binPath= "$INSTDIR\HuanvaeGuard\huanvaeguard-svc.exe" start= demand DisplayName= "HuanvaeGuard VPN Service"'
  Pop $0
  ${If} $0 == 0
    nsExec::ExecToLog 'sc.exe description HuanvaeGuard "HuanvaeGuard VPN tunnel service for Huanvae Chat"'
    ; 描述只是给服务管理器看的文字，装不上也不影响隧道 ⇒ 唯一一条明确不判 rc 的
    Pop $0

    ; 授予 Authenticated Users 启停权限，非管理员运行的主程序可以控制服务
    ; 末尾 (A;;CCLCSWRPWPLOCRRC;;;AU) 即：允许 AU 组查询/启动/停止/枚举/中断
    nsExec::ExecToLog 'sc.exe sdset HuanvaeGuard D:(A;;CCLCSWRPWPDTLOCRRC;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCLCSWLOCRRC;;;IU)(A;;CCLCSWLOCRRC;;;SU)(A;;CCLCSWRPWPLOCRRC;;;AU)'
    Pop $0
    ${If} $0 != 0
      ; 服务装上了，但非管理员的主程序将无法启停它（退出时也停不掉）。
      ; 不算致命：VPN 页的「修复服务」按钮会提权重来一遍，所以只告警、继续往下走。
      DetailPrint "警告：授予服务启停权限失败（sc sdset 返回 $0），主程序可能无法自动启停服务"
    ${EndIf}

    ; 启动服务（demand 模式，主程序启动时由 Rust 侧自动拉起）
    nsExec::ExecToLog 'sc.exe start HuanvaeGuard'
    Pop $0
    ${If} $0 == 0
      DetailPrint "HuanvaeGuard 服务已注册并启动"
    ${Else}
      DetailPrint "HuanvaeGuard 服务已注册，但启动失败（sc start 返回 $0）"
      MessageBox MB_ICONEXCLAMATION|MB_OK "HuanvaeGuard VPN 服务已注册，但启动失败（错误码 $0）。$\r$\n聊天功能不受影响；VPN 页会显示「已安装未运行」。$\r$\n请在应用的 VPN 页点击「修复服务」重试。" /SD IDOK
    ${EndIf}
  ${Else}
    ; 🔴 这里就是本次故障的原点：以前这条失败是完全静默的。
    DetailPrint "HuanvaeGuard 服务注册失败（sc create 返回 $0）"
    MessageBox MB_ICONEXCLAMATION|MB_OK "HuanvaeGuard VPN 服务注册失败（错误码 $0）。$\r$\n聊天功能不受影响；VPN 页会显示「未安装」。$\r$\n请在应用的 VPN 页点击「安装服务」，并在弹出的「用户账户控制」中点击「是」。" /SD IDOK
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; 卸载前的操作（如停止进程等）
  ; 尝试关闭正在运行的应用
  ; 卸载路径上这三条的 rc **一律不判**：主程序没在跑、服务不存在都会让它们非零，
  ; 而那些都是正常状态；卸载必须无论如何继续走完。Pop 只为保持栈平衡。
  nsExec::ExecToLog 'taskkill /F /IM huanvae-chat-app.exe'
  Pop $0
  Sleep 1000

  ; 停止并删除 HuanvaeGuard 服务
  DetailPrint "正在卸载 HuanvaeGuard 服务..."
  nsExec::ExecToLog 'sc.exe stop HuanvaeGuard'
  Pop $0
  Sleep 2000
  nsExec::ExecToLog 'sc.exe delete HuanvaeGuard'
  Pop $0
  DetailPrint "HuanvaeGuard 服务已卸载"
!macroend
