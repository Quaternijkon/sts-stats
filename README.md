# 尖塔数据终端 · Windows / macOS

从原生 STS2Stats 1.1.0 移植的本地存档分析应用。采用 **Tauri 2 + Rust + React / TypeScript**，保留原项目的 TypeScript 解析和统计引擎。支持《杀戮尖塔》及《杀戮尖塔 2》，两个游戏的数据、筛选、收藏、来源和分析 Worker 独立。

项目位于 `~/project/sts2stats-tauri`。原项目 `~/project/sts2stats` 保留，没有覆盖或搬动原始存档。本目录是新的桌面工程；Android 不在本次移植范围。

## 功能

- 全局统计、生涯角色完整记录、角色胜率与连胜、全部胜负记录、投入时间年份日历、滚动胜率、楼层到达率。
- 27 类对象列表与详情、逐局和生涯来源、卡池归属、角色视角、关联对象和关联单人记录。
- 原 Plackett–Luce / Laplace 选择竞技场、聚焦对象、角色视角、直接／间接证据、排名区间和诊断，支持 JSON / CSV / SVG / PNG 及打印。
- 卡牌流派结构、成员、卡牌归属、对局构成和模型诊断；休息处选择、进入前生命分箱和后续路线相关。
- 单人／多人记录、完整搜索、分页、收藏和返回状态恢复、玩家切换、逐层决策复盘、已记录指标曲线、同条件基准、原始存档查看及导出、最终牌组与遗物。
- 原生目录／文件选择、本地事务式导入、自动同步、不同来源的独立归档、旧 `dataset.json` 迁移及导出。
- 系统／浅色／深色主题、窄窗口侧栏、统一语义色、不透明固定表头、多选筛选、日期快捷范围和逐项移除条件。

多人记录仅进入多人列表和单局复盘，不进入单人统计。生涯统计从完整单人历史计算；`progress.save` 的累计值另行显示，不与详细记录相加。50 · 通关固定为胜利局数除以非放弃局数。缺失的节点指标不补零。

## 本地使用

安装包：macOS 13.3+（Apple Silicon / Intel 通用 DMG），Windows 10/11 x64（NSIS EXE / MSI，使用 WebView2）。旧原生应用要求 macOS 15；新应用使用系统 WebView，最低版本由 WebKit 的本地解压 API 决定。

安装后选择游戏，点击工具栏文件夹导入**单一账号、Profile、普通或 modded 来源**的存档目录。选择带 `profile.save` 的账号目录时跟随当前 Profile，不同来源分别归档；多个未能区分来源的 `progress.save` 会被拒绝。也可以导入单个 `.run` / `progress.save`，或将目录／文件拖入应用窗口。目录导入默认每 15 秒检查，变动通过连续稳定快照后同步；每 60 秒复核内容。自动同步开关分别按游戏保存，首页及未选中的游戏也会继续同步；单独导入文件保持手动更新。`⌘/Ctrl+O` 导入目录、`⇧⌘/Ctrl+O` 导入文件、`⌘/Ctrl+R` 同步、`⌘/Ctrl+0` 返回首页，`⌘/Ctrl+1/2/3` 打开统计／卡牌／记录，`⌘/Ctrl+,` 打开设置。

旧数据迁移：在对应游戏的「存档管理」中选择「迁移 dataset.json」，再选择原应用的数据文件。Foundation `importedAt` 日期基准和 `runs / progress / source / manifest / fileRunIDs` 保持兼容。迁移不会写回原文件；需要自动同步时重新通过目录选择器授权原存档目录。

数据存放在操作系统的应用数据目录，具体路径在「存档管理」显示。源目录只读；归档保存应用自有副本。任何文件解析失败时不提交本次同步。原目录删除历史文件后，已导入历史仍保留。同一对局按开始时间、种子、玩家和模式识别，重命名不会重复计数，同名但不同对局不会互相覆盖。同时间、不同内容的冲突版本会被拒绝。

## 本地写代码，GitHub 构建

本地工作仅限代码编辑、Git 提交和推送。依赖安装、检查、编译、打包均由 GitHub runner 执行。项目仓库为 [Quaternijkon/sts-stats](https://github.com/Quaternijkon/sts-stats)，在 [Actions 页面](https://github.com/Quaternijkon/sts-stats/actions) 手动运行 **Build Desktop** 获取 Windows 和 macOS 安装包。

| 工作流 | 触发 | 结果 |
| --- | --- | --- |
| Check | PR、`main` 推送、手动、Release 前置调用 | ESLint、TypeScript、Vitest、本地架构审计、生产前端构建、Chromium / WebKit Playwright、macOS / Windows Rust fmt / Clippy / tests |
| Build Desktop | 手动、Release 调用 | macOS 通用 DMG；Windows x64 NSIS EXE 和 MSI |
| Release | `v*` 标签、手动 | 调用桌面构建；仅标签下创建 GitHub Release |

普通功能分支推送不会运行 Check，需创建 PR 或手动触发；普通推送不会生成安装包。Artifacts 名称为 `sts2stats-macos` 和 `sts2stats-windows`。Release 必须先通过完整 Check，再生成安装包；在普通分支手动运行 Release 只检查和构建，不创建发布版本。合成截图、失败 trace 及测试报告保存在 `synthetic-frontend-validation` artifact。

Runner 安装 Node.js 22、pnpm 10.15.1、Rust stable；依赖使用 `pnpm-lock.yaml` 和 `Cargo.lock`。发布时同步 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json` 的版本，提交后推送匹配的 `v版本` 标签。`check:version` 会检查三个版本和标签一致性。

新工程推送到 `Quaternijkon/sts-stats`。`main` 推送触发 Check；安装包通过手动 Build Desktop 构建。

macOS 采用临时签名且未公证，Windows 未配置正式代码签名。正式分发前可另行配置签名证书。当前工程没有 Android 构建或 SAF 插件。

## 云端验证与结构

以下命令由 GitHub Actions 执行：

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm verify:local
pnpm check:version
pnpm build
pnpm exec playwright install --with-deps chromium webkit
pnpm test:e2e
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

架构见 [docs/architecture.md](docs/architecture.md)，功能逐项对照见 [docs/native-parity-2026-10-02.md](docs/native-parity-2026-10-02.md)，移植历史见 [docs/migration.md](docs/migration.md)，云端流程及验证边界见 [docs/cloud-validation.md](docs/cloud-validation.md)。本轮新增代码与测试尚待 GitHub Actions 实际运行，不将静态审查视作检查通过。纯本地运行，没有账号、服务器、远程分析或遥测。示例与截图仅使用合成数据。禁止把个人存档、账户标识或用户数据集提交进仓库、公共资源或报告。
