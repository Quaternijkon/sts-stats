# 尖塔数据终端 · Windows / macOS / Web

从原生 STS2Stats 1.1.0 移植的本地存档分析应用。采用 **React / TypeScript + Web Worker** 共用界面和引擎，桌面通过 **Tauri 2 + Rust** 接入系统文件。支持《杀戮尖塔》及《杀戮尖塔 2》，两个游戏的数据、筛选、收藏、来源和分析 Worker 独立。

项目位于 `~/project/sts2stats-tauri`。原项目 `~/project/sts2stats` 保留，没有覆盖或搬动原始存档。Android 可通过 Web 浏览器登录账户查看同步数据。

## 功能

- 全局统计、生涯角色完整记录、角色胜率与连胜、全部胜负记录、投入时间年份日历、滚动胜率、楼层到达率。
- 27 类对象列表与详情、逐局和生涯来源、卡池归属、角色视角、关联对象和关联单人记录。
- 原 Plackett–Luce / Laplace 选择竞技场、聚焦对象、角色视角、直接／间接证据、排名区间和诊断，支持 JSON / CSV / SVG / PNG 及打印。
- 卡牌流派结构、成员、卡牌归属、对局构成和模型诊断；休息处选择、进入前生命分箱和后续路线相关。
- 单人／多人记录、完整搜索、分页、收藏和返回状态恢复、玩家切换、逐层决策复盘、已记录指标曲线、同条件基准、原始存档查看及导出、最终牌组与遗物。
- 原生目录／文件选择、本地事务式导入、自动同步、不同来源的独立归档、旧 `dataset.json` 迁移及导出。
- 完整旧应用目录／plist 迁移，恢复两游戏历史来源、接受的版本、收藏与筛选；来源归档可在原目录不存在时打开。
- 轻量启动摘要、延迟加载、跨启动分析与卡池缓存；同条件基准支持 CSV、样本证据和最低样本过滤。
- 正式 Web 平台：IndexedDB 持久化、只读目录授权与浏览器同步、手动导入降级、来源归档、静态资源 ZIP 及子目录部署。
- 可选自托管邀请码账户和多端数据／收藏同步，支持 macOS、Windows 与 Android 浏览器；本地构建后可通过 SSH 部署、检查和回滚。
- 系统／浅色／深色主题、窄窗口侧栏、统一语义色、不透明固定表头、多选筛选、日期快捷范围和逐项移除条件。

多人记录仅进入多人列表和单局复盘，不进入单人统计。生涯统计从完整单人历史计算；`progress.save` 的累计值另行显示，不与详细记录相加。50 · 通关固定为胜利局数除以非放弃局数。缺失的节点指标不补零。

## 本地使用

Web 可部署 Release 中的静态资源 ZIP，使用 HTTPS 或 localhost 打开；匿名使用仅在本机保存数据，主动启用账户同步后上传当前数据集及收藏。站点为 https://sts2stats.quaternijkon.online 。浏览器能力见 [docs/web.md](docs/web.md)，部署和同步步骤见 [docs/self-hosting.md](docs/self-hosting.md)。

安装包：macOS 13.3+（Apple Silicon / Intel 通用 DMG），Windows 10/11 x64（NSIS EXE / MSI，使用 WebView2）。旧原生应用要求 macOS 15；新应用使用系统 WebView，最低版本由 WebKit 的本地解压 API 决定。

安装后选择游戏，点击工具栏文件夹导入**单一账号、Profile、普通或 modded 来源**的存档目录。选择带 `profile.save` 的账号目录时跟随当前 Profile，不同来源分别归档；多个未能区分来源的 `progress.save` 会被拒绝。也可以导入单个 `.run` / `progress.save`，或将目录／文件拖入应用窗口。目录导入默认每 2 秒检查，变动通过连续稳定快照后同步；每 60 秒复核内容，启动和回到前台立即检查。自动同步开关分别按游戏保存，首页及未选中的游戏也会继续同步；单独导入文件保持手动更新。`⌘/Ctrl+O` 导入目录、`⇧⌘/Ctrl+O` 导入文件、`⌘/Ctrl+R` 同步、`⌘/Ctrl+0` 返回首页，`⌘/Ctrl+1/2/3` 打开统计／卡牌／记录，`⌘/Ctrl+,` 打开设置。

旧数据迁移：在对应游戏的「存档管理」中选择「迁移 dataset.json」，再选择原应用的数据文件。Foundation `importedAt` 日期基准和 `runs / progress / source / manifest / fileRunIDs` 保持兼容。迁移不会写回原文件；需要自动同步时重新通过目录选择器授权原存档目录。

完整迁移：在「存档管理 → 原应用迁移」选择旧 `STS2Stats` 数据目录，可同时选择旧 `online.quaternijkon.sts2stats.mac.plist` 偏好文件。预览两游戏的全部来源，选择迁移范围和迁移后的当前来源。迁移包含 `dataset.json`、`save-archive-v1` 的历史与版本、收藏、四组筛选、主题、最低样本量及同步偏好；已有记录与收藏保留，任一所选来源校验失败时不提交。原目录已删除也可在「来源归档」打开历史。旧书签需要重新授权；重新选择目录时保留迁移的自动同步暂停偏好。macOS 的旧数据目录通常在 `~/Library/Application Support/STS2Stats`，旧偏好在 `~/Library/Preferences`；Windows 可读取复制过来的旧目录及 plist。

启动优先恢复摘要和磁盘分析结果，命中时无需载入完整存档。派生缓存位于应用数据目录下的 `derived-v2`，每游戏分析结果最多 128 项／128 MiB，另有最多 16 MiB 的摘要和 4 MiB 的卡池缓存；可删除重建。权威数据已移除原 32 MiB 单文件、50,000 文件与 512 MiB 数据集的固定限制，实际处理容量仍取决于可用内存。

数据存放在操作系统的应用数据目录，具体路径在「存档管理」显示。源目录只读；归档保存应用自有副本。任何文件解析失败时不提交本次同步。原目录删除历史文件后，已导入历史仍保留。同一对局按开始时间、种子、玩家和模式识别，重命名不会重复计数，同名但不同对局不会互相覆盖。同时间、不同内容的冲突版本会被拒绝。

## 本地开发、构建与发布

Windows、macOS 与 Web 的依赖安装、检查、测试、编译和打包均在本地完成，不使用 GitHub Actions。GitHub 仅保存源码与 Release 安装包。仓库指南见 [AGENTS.md](AGENTS.md)，操作步骤与验证边界见 [docs/local-build.md](docs/local-build.md)。

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium webkit
pnpm verify
pnpm build:desktop macos
pnpm build:desktop windows
pnpm build:web
pnpm test:e2e:web
```

macOS 生成 Apple Silicon / Intel 通用应用和 DMG；Windows 原生主机生成 x64 NSIS EXE / MSI。macOS 可使用 cargo-xwin、LLVM 和 NSIS 在本地交叉构建 Windows EXE，MSI 需要 Windows 主机。构建产物位于 `src-tauri/target/`，不会进入 Git。安装包、SHA-256 校验和与实际构建说明上传到 [GitHub Releases](https://github.com/Quaternijkon/sts-stats/releases)。

构建成功、安装包结构检查和目标系统安装运行验证分别记录。macOS 当前使用临时签名且未公证，Windows 未配置正式代码签名。只有实际生成的产物才会上传，不将交叉构建冒充 Windows 实机验收。

架构见 [docs/architecture.md](docs/architecture.md)，功能对照见 [docs/native-parity-2026-10-02.md](docs/native-parity-2026-10-02.md)，移植历史见 [docs/migration.md](docs/migration.md)。解析和统计在本地运行，可选账户仅保存同步快照，没有远程分析或遥测。测试、示例与截图只用合成数据；个人存档、账户标识、邀请码、会话及用户数据集不得进入仓库或产物。
