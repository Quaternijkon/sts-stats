# 本地验证、构建与 Release

开发、依赖安装、检查、测试、编译和打包均在本地完成，不使用 GitHub Actions。仓库不包含 Actions 工作流；GitHub 只保存源码与已在本地生成的 Release 附件。

## 准备与检查

需要 Node.js 22+、pnpm 10.15.1、Rust stable（至少 1.89）和当前平台的桌面开发工具链。首次执行：

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium webkit
pnpm verify
```

`pnpm verify` 依次执行版本检查、ESLint、TypeScript、Vitest、架构与公共资源审计、前端生产构建、Chromium / WebKit Playwright，以及 Rust fmt / Clippy / test。命令失败立即退出，修复后再构建。测试只用合成数据；报告和构建缓存留在被 Git 忽略的本地目录。

## macOS 通用 DMG

在本地 macOS 安装 Xcode Command Line Tools，然后执行：

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
pnpm build:desktop macos
```

输出在 `src-tauri/target/universal-apple-darwin/release/bundle/`，包含 Apple Silicon / Intel 通用 `.app` 和 DMG。构建脚本使用非交互打包，不依赖 Finder 排版自动化。应检查 DMG、两种架构、应用版本和签名，并从挂载后的应用启动验证。当前配置使用临时签名，未公证。

## Windows x64

在本地 Windows 的 Visual Studio C++ / WebView2 开发环境中执行：

```sh
rustup target add x86_64-pc-windows-msvc
pnpm build:desktop windows
```

Windows 原生构建生成 NSIS EXE 和 MSI。macOS 也可使用本地交叉工具链生成 NSIS EXE：

```sh
brew install llvm lld nsis sevenzip
cargo install cargo-xwin --locked
rustup target add x86_64-pc-windows-msvc
pnpm build:desktop windows
```

交叉构建脚本使用 cargo-xwin、LLVM 和本地缓存的 Microsoft CRT / Windows SDK；Apple Silicon 上也直接生成 x64 PE。Tauri 的 WiX MSI 打包仅在 Windows 主机启用，macOS 交叉构建只生成 NSIS EXE。输出在 `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/`。Windows 安装包目前没有正式代码签名。

交叉编译成功与安装包结构检查不能替代 Windows 实机的安装、权限、系统对话框和 WebView2 验证。Release 必须明确列出已执行检查和未执行的目标系统验证。

## 上传 Release

先提交已验证代码，从同一提交构建两个平台的安装包，核对 `package.json`、`Cargo.toml`、`tauri.conf.json`、Cargo.lock 和标签版本一致。检查安装包后生成 SHA-256 校验和，推送源码和匹配的 `v版本` 标签，再使用 `gh release create` / `gh release upload` 上传实际生成的 DMG、EXE、可用的 MSI、校验和及构建说明。不创建 Actions 运行。

发布说明应记录源码提交、工具链版本、检查结果、安装包架构、签名状态和验证边界。安装包、依赖、缓存、测试报告及 PDB 不进入 Git。不得包含个人存档、账户标识或用户数据集。

## 2026-10-20 本地检查记录

macOS Apple Silicon 上已通过 ESLint、TypeScript、122 项 Vitest、36 项 Chromium / WebKit Playwright、架构与公共资源审计、版本检查、前端生产构建、Rust fmt / Clippy 和 21 项 Rust 测试。原生回归发现并修复了迁移回滚遇到无效父路径时提前终止的问题，增加了一个目标恢复失败时仍恢复其他检查点的用例。安装包构建结果和目标系统验证边界以相应 Release 的实际附件与说明为准。
