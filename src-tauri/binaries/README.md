# Editor Sidecar — Node.js + code-server

本目录存放 HuanVae Editor 所需的 **Node.js sidecar 二进制**。code-server 的
JS 源码位于 `../resources/code-server/`。两者共同构成编辑器的运行环境。

体积较大（~300MB binaries + ~325MB resources），已加入 `.gitignore`，
每台开发机需首次构建前手动准备。

## 架构

```
src-tauri/
├── binaries/                                    # Tauri externalBin (sidecar)
│   ├── node-x86_64-unknown-linux-gnu            # Node.js v22 Linux x64 (~115MB)
│   ├── node-aarch64-apple-darwin                # Node.js v22 macOS ARM64 (~104MB)
│   └── node-x86_64-pc-windows-msvc.exe          # Node.js v22 Windows x64 (~80MB)
└── resources/
    └── code-server/                             # Tauri bundle.resources (~325MB)
        ├── out/node/entry.js                    # code-server 入口
        ├── lib/vscode/                          # VS Code 远程服务端
        ├── node_modules/                        # 依赖
        └── package.json
```

运行时流程：
1. Tauri 通过 `Command.sidecar('binaries/node', [entryJs, ...args])` 启动 Node.js
2. `entryJs` 通过 `resolveResource('code-server/out/node/entry.js')` 获取
3. code-server 在 `127.0.0.1:{random_port}` 上启动，iframe 嵌入显示

## 开发环境配置

### Linux/macOS

```bash
# 1. 下载 Node.js v22 二进制
# Linux x64:
wget https://nodejs.org/dist/v22.14.0/node-v22.14.0-linux-x64.tar.xz
tar xf node-v22.14.0-linux-x64.tar.xz --strip-components=2 node-v22.14.0-linux-x64/bin/node
mv node src-tauri/binaries/node-x86_64-unknown-linux-gnu

# macOS ARM64:
wget https://nodejs.org/dist/v22.14.0/node-v22.14.0-darwin-arm64.tar.xz
tar xf node-v22.14.0-darwin-arm64.tar.xz --strip-components=2 node-v22.14.0-darwin-arm64/bin/node
mv node src-tauri/binaries/node-aarch64-apple-darwin

# 2. 下载 code-server npm 包
wget https://registry.npmjs.org/code-server/-/code-server-4.96.4.tgz
mkdir -p src-tauri/resources/code-server
tar xzf code-server-4.96.4.tgz --strip-components=1 -C src-tauri/resources/code-server/

# 3. 安装依赖
#    code-server 自身依赖
cd src-tauri/resources/code-server && npm install --production --ignore-scripts --legacy-peer-deps
#    VS Code 远端服务器依赖（lib/vscode 是单独一层 node_modules，必须分别安装）
#    --legacy-peer-deps 用于绕开 @xterm/* peer dep 版本冲突
cd lib/vscode && npm install --production --ignore-scripts --legacy-peer-deps

# 4. 验证
src-tauri/binaries/node-x86_64-unknown-linux-gnu src-tauri/resources/code-server/out/node/entry.js --version
```

### Windows

```powershell
# 1. 下载 Node.js v22
Invoke-WebRequest -Uri "https://nodejs.org/dist/v22.14.0/node-v22.14.0-win-x64.zip" -OutFile node.zip
Expand-Archive node.zip -DestinationPath .
Copy-Item "node-v22.14.0-win-x64\node.exe" "src-tauri\binaries\node-x86_64-pc-windows-msvc.exe"

# 2-3. 同 Linux（code-server 是纯 JS，跨平台通用）

# 4. Windows 必备：替换 argon2 原生模块
#    Linux 上编译的 argon2.node 在 Windows 不可用，需下载 Windows 预编译版本
Invoke-WebRequest -Uri "https://github.com/ranisalt/node-argon2/releases/download/v0.31.2/argon2-v0.31.2-napi-v3-win32-x64-unknown.tar.gz" -OutFile argon2-win64.tar.gz
tar xzf argon2-win64.tar.gz -C "src-tauri\resources\code-server\node_modules\argon2\lib\binding"

# 5. 验证
& "src-tauri\binaries\node-x86_64-pc-windows-msvc.exe" "src-tauri\resources\code-server\out\node\entry.js" --version

# 6. Windows 可选：补 winregistry.node 预编译文件
#    @vscode/windows-registry 是 node-gyp 自编译模块，--ignore-scripts 会跳过；
#    若没有它，code-server 主页会回 500：Cannot find module '../build/Release/winregistry.node'
#
#    最快的办法：从已装的 VS Code/Cursor/Trae 等同源编辑器里直接拷一份（N-API 模块跨 Node 版本兼容）：
$dst = "src-tauri\resources\code-server\lib\vscode\node_modules\@vscode\windows-registry\build\Release"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
# 任选其一作为源：
#   "$env:LOCALAPPDATA\Programs\Microsoft VS Code\resources\app\node_modules\@vscode\windows-registry\build\Release\winregistry.node"
#   "$env:LOCALAPPDATA\Programs\cursor\resources\app\node_modules\@vscode\windows-registry\build\Release\winregistry.node"
Copy-Item "<path-to-winregistry.node>" "$dst\winregistry.node"
```

## 验证

```powershell
# 1. 命令行版本号
& "src-tauri\binaries\node-x86_64-pc-windows-msvc.exe" "src-tauri\resources\code-server\out\node\entry.js" --version
# 期望: 4.96.4 <commit-hash> with Code 1.96.4

# 2. 全链路验证（不启动 Tauri，端到端测 sidecar + HTTP + 浏览器）
powershell -File scripts\dev\test-code-server.ps1 -OpenBrowser
# 期望: 终端打印 "code-server ready: http://127.0.0.1:13199/" + "/healthz probe: 200 OK"
#       浏览器自动打开并显示 VS Code 工作台
```

## Bundled Extensions

`.vsix` 扩展文件存放在 `../resources/bundled-extensions/`，通过 `tauri.conf.json` 的
`bundle.resources` 配置打包进应用。运行时通过 `resolveResource('bundled-extensions/*.vsix')`
获取绝对路径，调用 code-server CLI `--install-extension` 安装。

当前打包的扩展：
- `huanvae-claude-chat-0.1.0.vsix` — Claude Code 聊天界面插件（自动安装）

新增扩展步骤：
1. 将 `.vsix` 放入 `../resources/bundled-extensions/`
2. 在 `src/editor/sidecar.ts` 的 `BUNDLED_EXTENSIONS` 数组中添加条目

## 已知限制

- **终端功能**：依赖 `node-pty` 等原生模块（`@vscode/spdlog`、`kerberos`、`@vscode/windows-process-tree` 等），
  需额外安装平台预编译 .node 文件；上面的 `--ignore-scripts` 跳过了它们的 build 阶段。
  编辑器/文件浏览/扩展管理/语法高亮不受影响
- **`code-server-ipc.sock` warning**：Windows 不支持 Unix domain socket，code-server 启动时会
  打印一条 `Could not create socket at ...` warning，纯属无害信息，可忽略
- **仅覆盖 x86_64 + macOS ARM64**：其他架构需自行构建
