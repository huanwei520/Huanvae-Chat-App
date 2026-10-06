binaries/hv-control-daemon-<target-triple> 随包 daemon 件（tauri bundle.externalBin 按
三元组取件，src-tauri/tauri.conf.json externalBin）。

## 产物来源（唯一合法链路，2026-10-06 起）
1. 标准构建：scripts/build-hv-control-binaries.sh —— 源锚核验（对照
   src-tauri/resources/hv-control-daemon.manifest.json build_anchor 四件）→ 应用
   src-tauri/resources/hv-control-daemon.defect3-fix.patch（或 --no-patch，产出禁止
   直接入位）→ cargo build → macOS 件 adhoc 重签 → 指纹/特征标记复核 → 防错闸 →
   manifest 回填指引。
2. 构建宿主：windows-msvc 件必须在 Windows 宿主原生构建（Linux 交叉 msvc 不受
   支持，libsodium-sys 选库分支错配）；apple-darwin 件在 macOS 宿主构建；详见
   manifest 各 artifact 的 builder 记录。
3. 入位（拷入本目录）后必须复跑 scripts/verify-daemon-build.sh（或 node
   scripts/verify-daemon-build.mjs）且 rc=0；任何 manifest 锚更新须与对应二进制
   同一提交原子落库。
4. 打包链强制：tauri.conf.json beforeBundleCommand 已挂防错闸（node
   scripts/verify-daemon-build.mjs）——manifest 锚哈希/大小/构建特征标记、二进制
   格式 vs 文件名三元组（PE/ELF/Mach-O，含 MSVC/MinGW 节区判别）、externalBin
   接线，任一 FAIL 即中止打包；CI 侧 .github/workflows/release.yml 有同闸独立步。
   缺失时 tauri build fail-fast 为预期行为（绝不静默降级）。

历史教训（DEFECT-3）：本目录曾由各块 ad-hoc 构建手工拷入、README 声称的构建脚本
并不存在，导致 X11 演示形态构建混入 v1.1.53/1.1.54 Windows 分发包（启动即退）。
2026-10-06 起 msvc=f34f5b2e…、apple-darwin=e6193671… 均为含 defect3-fix 补丁的
正确目标构建（manifest 锚定），并在真实 Windows 打包链干跑实证随包件逐字节一致。
