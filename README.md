# Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## macOS 上第一次打开需要多做一步

在 macOS 上第一次打开本应用时，系统会弹出一个提示：

> **"Huanvae-Chat-App" 已损坏，无法打开。你应该将它移到废纸篓。**

**应用并没有损坏，下载也没有出错。** 这是 macOS 对**未经 Apple 公证**的应用的统一提示。
Apple 的公证服务需要付费的开发者账号，本应用目前**还没有做这项公证**，所以 macOS 不认识它的来源，
就用了这句比较吓人的措辞。我们知道这句提示会让人以为文件坏了，所以在这里说清楚。

### 怎么打开

1. 先把 **Huanvae-Chat-App.app** 拖进「应用程序」文件夹（和平常装软件一样）。
2. 打开「终端」（启动台 → 其他 → 终端，或用聚焦搜索「终端」）。
3. 把下面这行**原样粘贴**进终端，按回车：

   ```sh
   xattr -dr com.apple.quarantine /Applications/Huanvae-Chat-App.app
   ```

   如果你没放进「应用程序」文件夹，把上面这个路径换成 app 实际所在的位置。
   一个省事的办法：先输入 `xattr -dr com.apple.quarantine ` 并留一个空格，
   然后把 app 图标直接拖进终端窗口，路径会自动补上。

4. 正常双击打开应用即可。

这行命令做的事很简单：macOS 会给所有从网上下载的文件盖一个「来自互联网」的标记，
上面那句提示就是这个标记触发的。这行命令**只是把这个标记去掉**，不改动应用本身。

### 需要做几次

**每次下载新版本后都要做一次**——新下载的文件会重新带上那个标记。已经打开过的旧版本不受影响。

### 关于安全

这行命令等于你告诉 macOS「这个应用我信得过」，所以**只对你确实信任来源的软件这样做**。
请从本项目的官方发布页下载，不要用第三方转发的安装包。

如果终端提示 `Operation not permitted`（没有权限），在命令最前面加上 `sudo ` 再执行一次，
按提示输入你的开机密码（输入时不显示字符，属正常）。

> 说明：「右键 →打开」和系统设置里的「仍要打开」对本应用**不适用**——系统不会为它提供这个选项，
> 上面这条命令是目前唯一可行的办法。

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

当前为测试版本，不对用户账户数据，聊天记录，后端接口做任何数据保留和兼容承诺

<!-- ci-paths-probe: 一次性路径探针分支，不用于合并 -->
