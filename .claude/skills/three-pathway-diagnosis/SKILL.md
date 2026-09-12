---
name: three-pathway-diagnosis
description: 文件传输三通路只读诊断方法论与本代（gen14）断点结论——通路无关性证明（LAN 纯 P2P vs 上传/聊天链共用 minio upstream 唯一落点）、控制面/数据面分层判读、无声失败放大器、断点层位表五列模板、零改动自证三代与落盘四件套、并发覆盖字节级恢复。下次「文件传输又出问题」分诊，或对 client↔对象存储链路做只读诊断定位断点时，先读本 skill 再动手。
---

# 文件传输三通路只读诊断（gen14 方法论 + 本代断点结论）

> 来源：块 `1788867548355-P1-三通路文件传输只读诊断定位断点` code（第 3 次执行判官 PASS）与 review（PASS）交付 + `docs/file-transfer-diagnosis-gen13/gen14` 报告；2026-09-08 update 步沉淀落盘。
> **行号漂移警告**：下文全部 path:line 为本 skill 落盘时点（2026-09-08）grep 实测并附符号锚；裸行号跨代必漂（实例：`URL_EXPIRED_REFETCH_LIMIT` v3.1 报告记 fileCache.ts:418 → 本 skill 落盘时实测已漂至 :420，内容未变），引用前一律按符号锚重验。
> **产物路径归一警告**：`docs/file-transfer-diagnosis-gen14.md` 曾被两个并行块认领并两次互相覆盖（§7），引用该报告前先确认总监归一结果；两版（本块 v3.1 / 兄弟块 `1788867590114-1` v4）核心结论实质一致。

## 1. 三通路划分与无关性证明（先分诊，再走读）

| 通路 | 范围 | 边界事实（符号锚） | 归因含义 |
|---|---|---|---|
| a · 局域网互传 | src/lanTransfer/** + src-tauri/src/lan_transfer/** | 纯 P2P：发现 mDNS `_hvae-xfer._tcp.local.`（protocol.rs:22 `SERVICE_TYPE`）、数据 TCP :53317（protocol.rs:25 `SERVICE_PORT`） | 不经 edge nginx/MinIO → 服务端故障不解释 LAN 症状，反之亦然 |
| b · 个人文件上传 | useFileUpload.ts + FilesModal.tsx | presign（控制面）→ 预签名 URL host 改写（useFileUpload.ts:509 `optimizePresignedUrl(part_url…)`）→ 分片 PUT 直打对象面（:329 `xhr.open('PUT', proxiedUrl)`）→ confirm | presign 活 + PUT 死 = 控制面/数据面分层判定的典型样本 |
| c · 聊天附件/图片 | fileCache/useFileCache/FileMessageContent/MediaPreviewPage/secureProxy | 下载 GET 同走 host 改写（fileCache.ts:284）→ 与 b 同一唯一落点 | 与 b 共享对象数据面，症状合并归因 |

- **方法论点 1（无关性证明）**：判「某通路与某故障无关」必须枚举该通路全部对外依赖消费点、证明其不触及故障面——靠常量级证据，不靠直觉（本代：LAN 消费点全部只用两个 P2P 常量，服务端数据面 504 与 LAN 症状互不解释）。
- **方法论点 2（单一落点锚定）**：b/c 的 GET/PUT 经 host 改写后唯一落点 = nginx `proxy_pass http://minio_api`（全模板仅 :401/:441 两处）→ `upstream minio_api → server minio:9000`（nginx.conf.template:119/:122，服务端仓 `/work/Huanvae-Chat-Rust`）。落点唯一 ⇒ 聊天图片裂图/文件下载失败/头像不显示/上传失败多症状收敛到单断点，大幅缩小排查面。

## 2. 五步执行法（只读诊断卡标准动作序列）

1. **先读基线、声明增量**：上代报告 + 缺陷基线（如 `.lan-transfer-diagnosis.md`）全文走读；报告头部 §0B 用三张表声明增量关系——K（确认：上代结论本轮独立复验仍成立）/ N（新发现）/ X（修正：层位收敛或勘误），每条增量必须本轮实跑证据，禁止抄录。
2. **client 侧走读先行**：任务点名文件全覆盖；每断言锚 path:line 且全部本轮 grep/sed 实测重标（防转录漂移——gen14 v2 曾把 UploadProgress 组件路径与图片重试次数写错，实为 `src/chat/shared/` 与 `IMAGE_MAX_RETRIES = 2`）。
3. **服务端只读复验（冻结令下）**：命令白名单 ls / `sed -n` / grep；生产端探测「采信 + 窗口标注」（何时何块实测）零网络不重放；仓内锚点逐条复验命中后才可引用。
4. **产出断点层位表**：五列结构（症状 → 断点层位 → 证据 path:line → 修复方案草案 → 是否涉冻结令/待裁决）；层位受控词表：client UI / client hook / tauri 后端 / 网络（LAN）/ 服务端（数据面）/ 服务端（控制面）/ 环境（真机）；症状给 Z 编号便于跨代引用。
5. **只读验证套件全量实跑留档**：cargo check --lib、cargo test --lib lan_transfer、`npx tsc --noEmit`、`npx vitest run`（传输相关 + 全量）；每条命令给原文 + 完整输出 + exit code，日志 /tmp 留档；验证产物只落 .gitignore 路径（target/、node 缓存）保 porcelain 零变化。

## 3. 七个判定模式

| # | 模式 | 要点 |
|---|---|---|
| P1 | 控制面/数据面分层判读 | 控制面（`/api/storage/*` 毫秒级 401=链路存活、`/ws/status` 200）✓ ＋ 数据面（`/user-file/`、`/group-file/` 504、`/avatars/` 挂起）✗ ＋ 随机路径毫秒级 404 ⇒ **upstream 特异性故障**（非全站断网、非代码回归） |
| P2 | 排除服务端代码回归 | 测试副本日志零存储相关 ERROR + MinIO 客户端初始化成功（bucket 就绪）+ 部署文档形态自洽（compose-minio 已退役 vs upstream 仍指 minio:9000，服务端仓 CLAUDE.md:720）⇒ 指向**基础设施层**而非代码 |
| P3 | 双层归因 | 根因（服务端 504，待裁决）× 放大器（client N1，可修）**分开列、分开归属**——防「修了 client 以为修好根因」，也防「等服务端修复掩盖 UI 缺陷」 |
| P4 | 无声失败放大器 | 服务端故障经 UI 缺陷放大成「进度条消失、无任何提示」——诊断先问：症状是故障本身，还是故障 × 反馈缺陷的乘积（机理见 §6 四环证据链） |
| P5 | 健康盲区 | /health 由 nginx 接入层短路回 200、请求不达后端（nginx.conf.template:142 `location /health` + client 侧注释 discovery.ts:42）⇒「App 显示服务正常」≠ 存储面健康；深层依赖探测（SR2）落地前勿信单一健康端点，直接对对象路径做带计时探测 |
| P6 | 诚实报错甄别 | `secure proxy not ready`（secureProxy.ts:116 `PROXY_READY_TIMEOUT_MS = 2000` fail-fast + :154 拒绝不安全直连回退）是**设计行为**，勿当传输 bug 修；若 owner 日志见该签名指向 ensure_secure_proxy 启动链 |
| P7 | 超时特征读数 | 504 + 恰 30s = nginx 标准 upstream 超时形态（请求发出时刻 vs 响应 Date 头推算），可反推故障在 upstream 而非 client |

## 4. 零改动自证三代 + 落盘四件套（只读卡的清白证明）

| 层级 | 手法 | 覆盖缺口 |
|---|---|---|
| L1 · porcelain 级 | 开工第一动作落 `git status --porcelain` 全文基线，收口复跑 diff 为空 | 防「无基线可证零改动」；仅到文件条目粒度 |
| L2 · 哈希级 | 全部已 M 跟踪文件 sha256 **多时点快照**（T0 开工/T1 编辑前/T2 收口/final 交付前）两两 diff 为空，快照文件自身哈希全同作完整性自证 | 覆盖「porcelain 无法排除对已 M 文件再改一行」 |
| L3 · 三区全量级 | porcelain 条目递归展开**全量文件哈希**，T0/T1 双采后三区判定：A 冻结区逐字节一致 / B 本块授权写入区 / C 并行活进程区（按目录名块号归因） | 再覆盖「?? 未跟踪文件无覆盖证明」与「并行活日志误归因」 |

配套两件套：
- **落盘四件套**（对核心交付文件）：`ls -la` + `stat`（size/inode/type/mtime）+ `git status --porcelain <path>`（跟踪状态）+ `sha256sum`（**仓内终版哈希，绝不能只给 /tmp 备份哈希**）。
- **哈希钉死**：报告全文以 shell cat 直拷（非手打转录）逐字节内嵌进仓外交付附录；声明「判时盘上哈希 ≠ 钉死值 ⇒ 为他人覆盖所致」，附冲突链时间线供归责。
- 证据形态通用机械（完整输出全文嵌入/穷举三重奏/零写命令清单/跨层引用自含性）见 `.claude/CLAUDE.md`「🔴 证据包形态学」等节，本 skill 不重复。

## 5. 本代（gen14）断点结论速览（2026-09-08 时点；转述自两层 PASS 交付，生产探测经 gen15 采信）

| # | 结论 | 依据 |
|---|---|---|
| C1 | b/c 断点收敛：**服务端对象数据面**（生产 edge nginx → minio:9000 upstream）。gen15 实测 `/user-file/`、`/group-file/` 双节点 504（各 30s upstream 超时）、`/avatars/` 40s 挂起，同刻控制面全健康 | gen15 §4.4-4.5（10:44-10:48Z 生产实测，冻结令下采信不重放）+ §1 单一落点锚定 |
| C2 | client 上传/接收**代码层无根因级缺陷**；有 1 个反馈放大器（N1）+ 低优先级缺陷（N2）；接收端错误 UI 完备（N3 通过） | §6 |
| C3 | LAN（通路 a）与 C1 **无关**（纯 P2P）；断点维持两嫌疑：① owner 运行旧版 v1.1.38（HEAD `a209c92`〔git commit 短 sha，验证命令 `git -C /work/Huanvae-Chat-App log --oneline -1`〕不含修复层）②修复层真机验证 9/9 零执行 | §1 无关性证明 + gen13 C3 |
| C4 | 1.1.39 工作树静态健康且实测：cargo check exit 0、cargo test --lib lan_transfer **47/47**、tsc 0 错、传输 vitest **75/75**、17 个传输链文件 `git diff --stat` 与 gen13 逐字一致（+3748/−834 内容零漂移） | code 交付 §8（11:52Z）+ review 交付 §2.5（12:19-12:27Z）独立复现 |
| C5 | 全量 vitest **4172/4172 全绿** exit 0——gen13 窗口 2 条失败已被并行块修掉，发布阻塞解除 | 同上 |

**最高概率画像**：本次「文件传输又出问题」= Z1+Z2+Z4（服务端 MinIO 数据面死）× Z3（client 无声放大）；LAN（Z6）是独立第二战线（旧版 + 真机零验证），与前者互不解释。

**Z1-Z10 索引**（全表见 gen14 报告 §5）：Z1 聊天内发图/发文件失败·服务端数据面 / Z2 接收裂图与下载失败·服务端数据面 / Z3 个人文件页上传无声失败·双层（根因数据面 × 放大器 client）/ Z4 头像不显示·服务端数据面 / Z5 「服务正常」假象·健康盲区 / Z6 LAN 症状·旧版+真机零验证 / Z7 LAN 双端同版仍复现·环境未定 / Z8 LAN 调试面板永远检测中·已修非现症 / Z9 LAN 窗口旧身份与建窗失败无提示·client / Z10 secure proxy not ready·诚实报错（P6）。

**修复裁决归属**：
- SR1-SR3（服务端，冻结令，**待总监裁决**）：SR1 恢复生产 minio:9000（容器/upstream 指向/凭据对齐三选一）；SR2 /health 增深层依赖探测端点；SR3 修复后按 gen15 附 A 命令集只读回归（`/user-file/` 由 504 变 403/405 语义）。
- CR1-CR3（client，不涉冻结令仍须报批）：CR1 N1 失败反馈接线（**最高价值小改**：error 态保留渲染窗口 + `success:false` 时 `showToast(result.error)`，toast 机制现成）；CR2 api.ts 身份刷新 + 建窗失败 UI 反馈；CR3 1.1.39 双端同版发布 + `docs/lan-transfer-realdevice-checklist.md` 真机清单回填（vitest 阻塞已解除）。

## 6. N1 无声失败四环证据链（client 侧可修部分，2026-09-08 grep 实测）

1. useFileUpload.ts:584-585——catch 内 `pushProgress({ status: 'error', statusDetail … })` + `setUploading(false)` 先于 `return { success:false … }`（React 批处理同帧生效；符号锚 `status: 'error'`）；
2. FilesModal.tsx:879——UploadProgress 渲染条件 `uploading && uploadingFile && progress` 立即失效，组件内本有的错误文案（src/chat/shared/UploadProgress.tsx:70/:110，转述上游实测）**连一帧都渲染不出**；
3. FilesModal.tsx:751——对 result 只有 `if (result.success)` **无 else**；
4. FilesModal.tsx:807——catch 只 `console.error`；:458 现成 showToast 机制未接线。
→ MinIO 504 期间在个人文件页上传 = 分片 PUT 超时/504 → 重试穷尽 → **无声失败**。修法 = CR1。

**接收端对照（N3，核验通过）**：FileMessageContent.tsx:128 `IMAGE_MAX_RETRIES = 2` 自动重试达上限 → :299-300「加载失败/点击重试」错误态（:281 `showError = error || imgLoadFailed`）；视频 :471 加载失败占位；全屏预览 MediaPreviewPage.tsx:119 区分「该文件已从服务器删除」/ :129 `加载失败: {error}` 错误串如实透出——504 期间接收端为**可见失败，无吞错**。下载链 URL 过期自愈：fileCache.ts:420 `URL_EXPIRED_REFETCH_LIMIT = 2` + :579 过期重取分支。

## 7. 并发覆盖恢复配方（产物路径被兄弟块覆盖时）

1. **权威版本仓外钉死**：报告全文 shell cat 直拷内嵌 deliverable 附录 + sha256 钉死，交付声明「判时盘上哈希 ≠ 钉死值 ⇒ 为覆盖所致，非本块交付不实」；
2. **字节级恢复**：从上轮 deliverable 附录提取 → sha256 验证 = 会话开工留存值 → 重放编辑 → 落盘复测哈希与被覆盖前逐字节一致；
3. **冲突存证上报总监**：覆盖件快照（哈希/行数/头部自报块号）+ 双方时刻表；**盘上文件不能作为「我的交付仍完好」的证据**。
（实例：本块 12:07:10Z 被兄弟块 `1788867590114-1` 覆盖 → 12:12:18Z 字节级恢复（恢复件 sha256 = 开工留存值验证通过）；update 步又证实 12:16:38Z 终检后再次被覆盖为兄弟块 v4——同一产物路径被管道授予两块的冲突已两度上报总监归一。）

## 8. 域内证据红线（诊断卡交付五条，条条有 REJECT 实录）

1. 高噪声并行环境下，**基线先行**是零改动声明的存在前提（第 1 轮 REJECT：「git status 非零且无基线可证零改动」）；
2. 行号/路径**本轮实测重标**，禁沿用上代或凭记忆（v2 转录失真触发重做）；
3. 「可复跑」标准 = 判官复制粘贴命令原文能得到同样输出（完整输出 + exit code，禁计数摘要、禁不可执行伪命令）；
4. 零改动证明粒度要**超过质疑者想象的粒度**：porcelain 条目级 → 哈希字节级 → 三区全量级（第 3 轮 REJECT 整改点①实录）；
5. 绝对化措辞（空/零/永远）必须与自留物证逐字对齐（「stash 空」vs 基线录有 1 条旧 stash——review 记瑕疵实录）；只读块遇服务端 mtime 变动**先归因再下结论**（命令白名单 + 会话日志可检索是清白的预留材料）。

## 9. 来源与哈希声明（三声明：形态 · 验证命令 · 验证域）

- 来源：本块 code/deliverable.md（第 3 次执行 PASS）、review/deliverable.md（PASS，judge.jsonl 行 3/4）、gen13/gen14 报告、gen15 报告（生产探测采信，`docs/server-readonly-health-gen15.md`）。
- `2d3c731e…`（全值 `2d3c731ee4a28ae76f4211bfd85ad82835419565e1e532fe9b3d76531aa3eb27`）：**文件内容 sha256**（非 git 对象，勿用 git cat-file 校验）＝本块 v3.1 权威版（code 交付附录 A 逐字节内嵌）；验证命令 `sha256sum /work/Huanvae-Chat-App/docs/file-transfer-diagnosis-gen14.md`；验证域 = worksite 仓；⚠ 该路径现被兄弟块 v4 覆盖，复算得 v4 哈希属预期（冲突归一见 §7）；**引上游 code/review 交付实测，本 update 层无 bash 未复算**。
- `a209c92`：**git commit 短 sha**（worksite 仓 HEAD，v1.1.38）；验证命令 `git -C /work/Huanvae-Chat-App log --oneline -1`；验证域 = worksite 仓 git 对象库。
- 其余上游哈希（7e570621/116e1028/ed66aaa6/6f04ea85/4544c584/da96185f/1c0eb4aa）均为**文件内容 sha256**、仅存于上游交付与 /tmp 留档语境，本 skill 不作钉死声称，验证走对应上游交付清单（code 附录 C/E、review 头部）。
