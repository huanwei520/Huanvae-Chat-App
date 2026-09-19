# v1.1.50 Release CI 三平台断言失败 —— 四根因修复与验证记录

> 任务块：PIPELINE_TASK:x4u0befp（2026-09-18）
> 触发：v1.1.50 Release CI run 35372812578 三条 build 腿同日全红
> 基线：卡面基点 2dc1a05c；本块开工时 main=c72a9672（59a2b89c 修全角标点邻接变量名、
> c72a9672 落 ③④ 修复），本块工作中 main 又前进至 **97251102**（kbj1q7n0 第5轮整改：
> 撤销安卓 ABI 登记式收窄、x86 sidecar 同源补齐回默认四 ABI 口径）——本块已对新顶逐项
> 独立复核并更新 §3，分支 fix/x4u0befp-ci-assert-150 基于工作全程双顶如实记录。

## 0. 四根因一览（与 run 35372812578 现象对照）

| 腿 | 现象 | 根因 | 修复落点 |
|---|---|---|---|
| ① build macos-14 | `line 143: declare: -A: invalid option`、`line 147: EXPECT_ARGS[@]: unbound variable` | 脚本用了 bash 4+ 关联数组，macOS runner /bin/bash=3.2 不支持；且 set -u 下空数组裸展开必崩 | 4a413406：平行索引数组线性查找 + `${arr[@]+"${arr[@]}"}` 空数组守卫 |
| ② build windows-latest（静态腿） | `解析 tauri*.conf.json 失败` | Git Bash 下 `$SRC_TAURI` 是 MSYS 风格路径（`/d/...`），Windows 原生 node.exe 解析成 `D:\d\...` → ENOENT | 4a413406：`cygpath -m` 转混合斜杠（`D:/...`） |
| ②' build windows-latest（产物腿） | `NSIS 包缺 hv-control-daemon*.exe` | v1.1.46 起 tauri.windows.conf.json `externalBin: []`（msvc daemon 件缺位期登记），daemon 从未进包 | c72a9672：恢复 `externalBin: ["binaries/hv-control-daemon"]` + msvc 真件入库 |
| ③ build-android | `必含 sidecar 缺失：lib/x86/libhg_android.so` | x86 sidecar 断点：仓内 jniLibs 三 ABI 无 x86，且发货件 JNI 接线（jni.rs+lib.rs mod）当时属未跟踪 WIP 不在树——树建任意 ABI 零 JNI 导出（本块 i686 实测）；后 97251102 将 WIP 入源并同源重建 x86（EM_386/13 导出）回四 ABI | c72a9672 曾登记式收窄（待追认）→ 97251102 撤销收窄补齐 x86 回默认四 ABI（本块独立复核） |
| ④ generate-manifest | skipped → latest.json/android-latest.json 未生成 | `needs: [build, build-android]`，任一前置红即整段跳过 | ①②③ 修复后自愈（见 §4 断链说明） |

## 1. ① bash 3.2 兼容 + ② conf 解析失败（脚本机械类）

### 1.1 修复前形态与等价核对

- 脚本引入于 503a0898，修复前形态 = 该 commit 版本（`declare -A EXTRA_EXPECT=()` 在 line 143，
  裸 `"${EXPECT_ARGS[@]}"` 在其后）。
- 卡面所记 pre-fix 引用（c19406c9）**不含此脚本**（`git show c19406c9:scripts/...` 报 not in c19406c9），
  实际 pre-fix 取件锚 = 503a0898，特此登记更正。
- ①② 修复在 4a413406（bash3.2 平行数组 + cygpath -m）、59a2b89c（`${SEVENZ}`/`${ext}`/`${CHECKED_ARTIFACTS}`
  全角标点邻接花括号）先行落库；2dc1a05c（rm -rf 吞错）、868599a8（sha_of 可移植）为同脚本相邻修复。
- 本块逐段 diff 503a0898 版 ↔ main 版：全部差异属上述四 commit，断言语义零改动
  （NSIS daemon 必含、四 ABI 口径原文保留）。

### 1.2 复现（bash 3.2.0，源码构建自 ftp.gnu.org/bash-3.2.tar.gz）

```
$ /tmp/bash-3.2/bash /tmp/prefix-assert.sh --target-version 1.1.50
EXIT=1
/tmp/prefix-assert.sh: line 143: declare: -A: invalid option
declare: usage: declare [-afFirtx] [-p] [name[=value] ...]
/tmp/prefix-assert.sh: line 147: EXPECT_ARGS[@]: unbound variable
```

与 CI 报错逐字一致（含行号 143/147——bash 3.2 对函数内多行串的行号口径与 CI runner 相同）。

### 1.3 修复后再跑（main 版脚本，bash 3.2.0）

- `bash -n`（bash5 与 bash3.2 双过）；
- bash 3.2 对真实渠道件端到端：NSIS 腿、APK 腿均完整跑完（见 §2.1/§3.3 输出），无 declare/unbound 崩溃；
- `--expect` 平行数组路径（bash 3.2）：
  `--expect lib/arm64-v8a/libhg_android.so=0467414f...` → `✓ 字节核对一致 (0467414f… ← --expect 补钉)`，exit 0。

### 1.4 残留缺口补丁（本块原创，x4u0befp）

核对发现 main 版仍有**扫描模式专属**的同类残留：无参数运行（文档化用法）时，
`NSIS_ALL`…`TARGZ_ALL`、`NSIS_ARTIFACTS`…`TARGZ_ARTIFACTS`、`filter_by_version` 的 `in[@]`
共 14 处裸空数组展开，bash 3.2 + set -u 下 7 连崩（486-492 行）：

```
scripts/assert-artifact-content-v2.sh: line 486: NSIS_ALL[@]: unbound variable
...（487-491 同类）...
scripts/assert-artifact-content-v2.sh: line 492: NSIS_ARTIFACTS[@]: unbound variable
```

CI 不踩（CI 恒传位置参数，扫描块不执行），本地/macOS 手动扫描必踩。补丁 =
同款 `${arr[@]+"${arr[@]}"}` 守卫（与 163 行 EXPECT_ARGS 同模式，非空时逐词语义不变）。
修后：bash 3.2 扫描空 bundle 目录 PASS exit 0；扫描含 1.1.50 NSIS 的目录 bash5/bash3.2 双 PASS，
daemon 字节核对绿；三处位置参数行为锚（坏包 FAIL / 收窄 APK PASS / 好包 PASS）与补丁前逐一一致。

## 2. ②' NSIS 缺 hv-control-daemon

### 2.1 修复前（失败复现）

包：`test-artifacts/release-1.1.50/Huanvae-Chat-App_1.1.50_x64-setup.exe`
（前序块 9/18 15:57 于 winserver-hg C:\appbuild 构建，externalBin 仍为置空态，先于 c72a9672；
sha256 `8874c8da95ca59dc...`）。7z 列表 12 文件，**无 hv-control-daemon.exe**。

```
$ bash scripts/assert-artifact-content-v2.sh --target-version 1.1.50 --skip-static <该包>
EXIT=1
  ✗ FAIL: [NSIS] hv-control-daemon 缺失（随 1.1.49 起必含）—— 安装后远程控制不可用
    期望存在: hv-control-daemon*.exe  实际: 无
```

（bash 3.2 下跑同输出——脚本已不崩，断言本身正确红。）

### 2.2 修复内容（c72a9672 已落，本块核对+验证）

- `src-tauri/tauri.windows.conf.json`：`externalBin: ["binaries/hv-control-daemon"]`（置空态解除）；
- `src-tauri/binaries/hv-control-daemon-x86_64-pc-windows-msvc.exe` 入库（sha256 `6f92bcd839b8ac0d...`）；
- gnu 形态旧件删除（防 L1 glob 首匹配错位）；
- 本块补：release.yml windows matrix 注释（~113-117）由「置空 externalBin」旧态改为恢复后实态。

### 2.3 修复后（真 build 验证，不降级）

winserver-hg 独立目录 `C:\hv-fix-x4u0befp`（卡面 D: 盘该 VM 不存在，用 C:，如实登记），
`git archive fix/x4u0befp-ci-assert-150` 全量源码 → `pnpm install --frozen-lockfile` →
`pnpm build` → `pnpm tauri build --bundles nsis`（ colder build，无目标缓存复用）：

```
Finished 1 bundle at: C:\hv-fix-x4u0befp\src-tauri\target\release\bundle\nsis\Huanvae-Chat-App_1.1.50_x64-setup.exe
（13 files，含 hv-control-daemon.exe；签名步骤因本块无 TAURI_SIGNING_PRIVATE_KEY 报错，
 属 updater .sig 生成，NSIS 本体已完成为前提事实，与内容断言无关）
```

验证件 sha256 `0a5863bb04e29d2f...`（VM 侧与本机两次独立计算一致；非发货件，落
`x4u0befp/out/`，不上传不进渠道）。7z 解包核对：

```
$ cmp hv-control-daemon.exe <repo>/src-tauri/binaries/hv-control-daemon-x86_64-pc-windows-msvc.exe
→ 无输出（逐字节一致）
$ sha256sum 两件 → 6f92bcd839b8ac0dbcd36169749284954e071e0b0751111c162bd207d50515b4（同值）
$ file → PE32+ executable (console) x86-64, for MS Windows（msvc 形态）
```

断言（bash5 与 bash3.2 双跑）：

```
✓ [NSIS] hv-control-daemon 字节核对一致 (6f92bcd8… ← 仓内落点(src-tauri/binaries/hv-control-daemon-x86_64-pc-windows-msvc.exe))
产物内容清单断言 v2：PASS
```

## 3. ③ APK 缺 lib/x86/libhg_android.so —— 断点实证、收窄始末与最终补齐

### 3.1 sidecar 链路（四 ABI 口径的物理来源）

`libhg_android.so` **不是 CI 现构建**，是仓内预构建件：
`src-tauri/tauri-plugin-hg-guard/android/src/main/jniLibs/<abi>/libhg_android.so` 经 Gradle
jniLibs 约定进 APK。c72a9672 时点仓内只有三 ABI（arm64-v8a / armeabi-v7a / x86_64），
**x86 目录自 55825f75/67089b8f 起从未存在**。CI 的 `i686-linux-android` rust target
（release.yml ~472）只服务 App 自身 lib（`lib/x86/libhuanvae_chat_app_lib.so` 在包），与 guard
sidecar 无关——「CI 装了 i686」与「APK 有 x86 sidecar」之间本就无生产链路。

### 3.2 x86 断点实证（android 构建宿主真重建，本块原创，c72a9672 态）

对 /work/HuanvaeGuard **当时树**（白名单 rsync 同款流程 → 构建宿主 NDK 27.2）：

```
$ cargo build --release -p hg-android --target i686-linux-android
BUILD_RC=0
SO_SIZE=336324          （0.32 MB）
JNI_EXPORTS=0           （nm -D --defined-only | grep -c 'Java_' = 0）
```

对照在库发货三 ABI（jniLibs 现件）：arm64=3652984 B / v7a=2416068 B / x86_64=4174016 B，
每件 **13 个 JNI 导出**（`Java_dev_huanvae_guard_HgNative_*`）。根因：发货件的 JNI 接线
（client/android/src/jni.rs + lib.rs 的 mod 接线）在 67089b8f 构建时属**未跟踪 WIP**，从未入库
——当时树 `git ls-files client/android/src/` 仅 lib.rs、vpn.rs，lib.rs 仅 `pub mod vpn;`。
⇒ 从当时树重建任意 ABI 的 .so 都零 JNI 导出，Kotlin 桥 `System.loadLibrary("hg_android")`
后调用即 `UnsatisfiedLinkError`——这就是 x86 断点的实体，也是 c72a9672 选择
登记式收窄而非硬凑 x86 的依据（宁缺勿假）。

### 3.3 收窄态验证（c72a9672，本块独立复核）

release.yml build-android L1 步 `ARTIFACT_GUARD_ABIS: arm64-v8a armeabi-v7a x86_64`。
修复前（默认四 ABI 口径，实包 1.1.50 APK sha256 `ae7971fe...`，前序块 9/18 15:22 构建，
jniLibs 与现仓同源）：

```
✗ FAIL: [APK] 必含 sidecar 缺失：lib/x86/libhg_android.so（ABI 列表口径：arm64-v8a armeabi-v7a x86 x86_64）
```

收窄口径下同包：三 ABI 全绿 PASS（bash 3.2 与 bash 5 双跑 exit 0）——收窄机制本身验证成立。

### 3.4 最终态：撤销收窄、x86 同源补齐（97251102，本块独立复核全绿）

本块工作中 main 前进至 97251102（kbj1q7n0 第5轮）：把 67089b8f 同刻的 WIP 源
（HuanvaeGuard autostash 26795e0：jni.rs/control.rs + lib.rs mod 接线）入源，NDK r27 同源
重建 x86 入 jniLibs，撤销 ARTIFACT_GUARD_ABIS env 回默认四 ABI。本块逐项独立复核：

```
$ git show 97251102:.../jniLibs/x86/libhg_android.so | sha256sum
→ be0f133b6be12df2cb55b66d7ff2e02e3d1a46a5dbf56b6b67357315d920b192（与 commit 自述一致）
$ file → ELF 32-bit LSB shared object, Intel 80386（EM_386）
$ nm -D --defined-only | grep -c 'Java_' → 13（导出名与在库 arm64 件逐一对应）
```

真实四 ABI 新包（第5轮 22:37 构建，`test-artifacts/release-1.1.50/huanvae-chat-app-1.1.50-and-debug-4abi.apk`
sha256 `4a6be8a26768b8cb...`）：

```
$ unzip -l <4abi.apk> | grep libhg_android
  lib/arm64-v8a/libhg_android.so  3652984
  lib/armeabi-v7a/libhg_android.so 2416068
  lib/x86/libhg_android.so        4211972
  lib/x86_64/libhg_android.so     4174016
$ unzip -o … lib/x86/libhg_android.so && cmp → 与 97251102 仓内件逐字节一致
$ bash scripts/assert-artifact-content-v2.sh --target-version 1.1.50 --skip-static <4abi.apk>
  ✓ 四 ABI 全在包非空 → 产物内容清单断言 v2：PASS（exit 0，默认口径无 env）
```

## 4. ⑤ latest.json / android-latest.json 缺失 → App 更新弹窗无源（因果链）

```
build（windows 腿 L1 断言红）＋ build-android（L1 断言红）
        │  （两 job 均 FAIL；tauri-action 的资产上传在断言步之前，故安装包/sig 已上 Release，
        │    但清单从未生成）
        ▼
generate-manifest: needs: [build, build-android] → 前置红 ⇒ 整 job skipped
        ▼
latest.json / android-latest.json 未构建、未传 R2、未附 Release
        ▼
客户端更新检查两源全空：
  · R2 优先源 https://store.huanvae.cn/update/huanvae-chat/latest.json → 404（本次从未刷新）
    （android-latest.json 同理）
  · GitHub 备用源 /releases/latest/download/latest.json → 404（generate-manifest skipped，资产缺失）
        ▼
tauri updater / service.android.ts 拿不到版本清单 ⇒ 检查更新失败 ⇒ 升级弹窗无源，不出
```

即：v1.1.50 用户侧「无更新提示」不是客户端 bug，是清单生成 job 被断言失败连带跳过的必然结果。
①②③ 修复后三腿绿 → generate-manifest 恢复执行 → 两清单恢复供给。

**重发口径**（按任务卡边界，本块不执行）：v1.1.50 已随 tag 流出，重发/重打 tag 需 owner 裁决后
另行执行；本块修复落发布后代码态（分支 `fix/x4u0befp-ci-assert-150`），生效于下一版 CI 门禁
与产物。tag v1.1.50 现指向 c72a9672（含全部修复）这一事实一并列报，由 owner 一并裁决。

## 5. 门禁回归

见交付记录：前端 typecheck / lint / vitest、src-tauri cargo check、`bash -n`（bash5+bash3.2 双跑）
—— 改动面：scripts/assert-artifact-content-v2.sh（扫描模式守卫）、.github/workflows/release.yml
（windows matrix 注释段）、docs/、SKILL.md；均不触碰运行时代码。
