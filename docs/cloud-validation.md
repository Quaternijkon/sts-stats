# 云端验证

本仓库的依赖安装、检查、测试、编译和打包只由 GitHub Actions 执行。工作流配置已补齐；本次修改尚未实际运行 CI，不能据此判定检查或安装包验证已经通过。

## Check

触发入口保留为 PR、`main` 推送和手动运行，另提供 `workflow_call` 供 Release 调用。普通功能分支推送不生成安装包，也不自动触发检查。

| Job | Runner | 检查内容 |
| --- | --- | --- |
| `frontend` | Ubuntu | 冻结 pnpm 锁文件、三个版本字段及标签一致性、ESLint、TypeScript、Vitest、本地架构审计、生产前端构建、Chromium / WebKit Playwright |
| `Rust (macos)` | macOS | 冻结 pnpm 锁文件、前端构建、Rust fmt、使用 Cargo.lock 的 Clippy 全 target 和 Rust tests |
| `Rust (windows)` | Windows | 同上，在实际 Windows runner 执行平台分支 |
| `check` | Ubuntu | 汇总前端和两个原生平台结果；任一失败、取消或跳过都不能通过 |

`check` 保留原有汇总状态名，已有将该状态设为必须通过的分支规则可以继续使用。Linux 只运行前端检查；Rust 在受支持的 macOS 和 Windows 上编译、检查并测试，不以 Linux 结果替代。

前端测试只加载 `tests/e2e/app.spec.ts` 构造的合成数据，在 Chromium 和 WebKit 两个 Playwright project 中执行。两个引擎的截图使用各自测试输出路径，避免相互覆盖。`synthetic-frontend-validation` artifact 保存 Vitest JUnit、Playwright JUnit / HTML 报告、明暗主题、窄窗口、滚动表格截图以及失败 trace，保留 14 天；测试失败时仍尝试上传已经产生的报告。产物不得包含个人存档、账户标识或用户数据集。

## Build Desktop 和 Release

Build Desktop 仅手动运行或由 Release 调用，输出 `sts2stats-macos` 通用 DMG，以及 `sts2stats-windows` x64 NSIS EXE / MSI，保留 14 天；PR 和普通推送不会进入该工作流。

Release 按 `Check → Build Desktop → GitHub Release` 执行。只有对应提交的前端检查与 macOS / Windows 原生检查全部成功才会打包；只有 `v*` 标签才能创建 GitHub Release。版本检查同时要求 `package.json`、`Cargo.toml`、`tauri.conf.json` 与标签一致。普通分支手动运行 Release 会先检查再构建，不发布版本。发布按同一 ref 排队，避免同一标签并发发布。

配置变更完成后，可在获得推送授权并将提交推送到目标仓库后，通过 PR、`main` 或 Actions 的手动 Check 入口验证。发生失败时，先查看对应 job 的日志以及合成前端报告，修正后重新检查同一提交；本次工作未推送、未触发 Actions，也未发布。

## 验证边界

Chromium / WebKit 双引擎合成 E2E 验证 React 页面及 Worker 行为，帮助发现 Windows WebView2 和 macOS WebKit 所用引擎间的差异；Ubuntu runner 的浏览器测试并不等于实际 Tauri WebView 环境。Rust tests 验证原生层的单元行为；这些检查均不代表真实安装体验、Tauri WebView 交互、系统文件对话框或操作系统权限已经完成验收。Build Desktop 产物生成后仍需在两个支持平台实际安装并验证。签名、公证、Windows SmartScreen 和正式发布状态须以实际云端执行及安装验收结果为准。
