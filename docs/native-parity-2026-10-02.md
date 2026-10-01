# 原生功能对照与补齐 · 2026-10-02

对照源为相邻 `sts2stats` 工程中的 Swift 视图、AppStore、AnalysisEngine、SaveSyncMonitor、模型与上游 Engine；修改仅位于 Tauri 工程。八个 subagent 分别承担概览、对象、记录、存储、引擎、共用界面、云端流程和独立集成审查。

以下为代码实现与静态审查结果。新增回归用例尚未执行，不能据此声称 TypeScript、Rust、浏览器或安装包验证通过。

| 范围 | 对照原生入口 | 已补齐的能力 | Tauri 实现与合成回归 |
| --- | --- | --- | --- |
| 导航与筛选 | STS2StatsApp、LocalDataView | 分类总览、导航快捷键、多选条件、日期快捷、移除单项、详情入口筛选继承、返回上下文与滚动位置 | App、AppFilters、filters、usePageScroll；filters.test、parity.spec、store-import.test |
| 全局统计 | OverviewViews、DataCharts | 年份日历、本地日边界、月份／星期／图例、完整五行胜负记录、最新记录定位、大量记录虚拟化、空态操作与角色局部视角 | overview 模块；overview-parity.test、overview-parity.spec |
| 生涯统计 | OverviewViews CareerView | 最高进阶、角色记录排序和完整统计展开、无完成对局缺失值 | CharacterRecords；overview-parity.spec |
| 休息处 | RestSiteAnalysisViews | 动作次数与选择节点区分、生命和比例样本、完整／截尾／不完整区间、路线选择计数、带符号百分点与相关系数 | RestContent；overview-parity.test、overview-parity.spec |
| 对象列表与详情 | ObjectAnalysisViews | 27 类对象、逐局／累计来源、卡池／角色视角、持有及升级拆分图表、排序分页、关联对象、完整关联对局与证据分页、完整数据导出、返回列表状态 | ObjectPages、ObjectTables；objectPagination.test、object-parity.spec |
| 偏好竞技场 | EntityViews ArenaView | 聚焦卡牌、独立角色视角、矩阵与排名各自分页、区间／证据／诊断、JSON／CSV／SVG／PNG及打印 | ArenaPage、objects/export；object-parity.spec |
| 卡牌流派 | ObjectAnalysisViews ArchetypesView | 结构节点与选中详情、社区指标、方向证据、亲和矩阵、完整卡牌归属、对局构成、独立分页、诊断与导出 | ArchetypesPage；object-parity.spec |
| 单人／多人记录 | RunViews | 完整记录搜索、文件／玩家等排序、收藏、完整列排名、队伍组成与分页玩家遥测、返回搜索／排序／分页状态 | RunPages、runPages；runPages.test、run-parity.spec |
| 复盘 | RunViews、RunTimelineCharts | 原始 JSON 和存档导出、同角色同进阶基准、全部节点决策、实际楼层坐标、图例选择与键盘节点、缺失生命保护、按升级合并库存、多人只读对象与生命隔离 | runs 模块；run-replay.test、bridge.test、run-parity.spec |
| 导入与同步 | AppStore、AnalysisEngine、SaveSyncMonitor | 捕获导入游戏、加载／提交串行、Profile 根授权与动态解析、来源恢复、失败事务回滚、后台两游戏同步、稳定快照／内容复核、暂停和重试、手动请求不丢失 | appStore、dataset、platform、Rust；importer.test、store-import.test、Rust 合成测试 |
| 旧数据与存档管理 | Dataset、SettingsView、LocalDataView | Foundation 日期基准、缺失 fileRunIDs 回填、同步状态与时间、打开应用目录、完整累计计数、导出序列化移入 Worker、停止同步后清除 | LocalDataPage、models、Worker operations；importer.test、worker.test、parity.spec |
| 共用界面与引擎 | DesignSystem、Components、AnalysisEngine | 稳定对象／指标／角色色、缺失值、完整列尺度、六列指标、窄窗／长标题／固定表头／减少动态、六响应及字节缓存上限、请求身份保护、Worker 故障重建 | UI、theme、numericScales、useAnalysis、client；ui-semantics.test、worker.test及合成布局截图 |
| 云端验证 | 原项目构建与验证流程 | Chromium／WebKit 前端检查、macOS／Windows Rust检查、合成报告 artifact、发布先检查 | Check、Build Desktop、Release；cloud-validation.md |

## 兼容与口径

- 多人仅进入多人列表与复盘；单人概览、对象与流派继续使用单人证据。累计进度和逐局历史分别显示，缺少任一累计胜负计数时不输出伪完整总数。
- 1–49 表示实际楼层到达率；50 固定胜利局数除以非放弃局数。所有缺失节点指标保留缺失与断线，已记录的零仍显示为零。
- 竞技场的 `cardCategory` 保留上游“玩家来源选择目录”语义；经验卡池用于对象卡池分析，不替换竞技场目录。目录与角色视角冲突在控件中处理。
- 页面保留 Tauri 已有的每页独立筛选；详情继承进入时的条件，返回恢复各层上下文。原生四组筛选与 Tauri 每页范围的差异是既有交互设计，核心过滤字段仍兼容。
- 游戏译名沿用官方库，并通过指定翻译工具核对新增或修改用词。例如 v0.111.0 `CUSTOM_RUN_SCREEN.MODIFIERS_TITLE` 为“特效”，`MULTIPLAYER_LOAD_MENU.ACT` 为“阶段：{act}”。ID 和表达式不变，原工程与生成本地化资源未修改。
- 原存档只读；导出经用户选择目标，原始 `.run` 使用 `.run.json` 文件名。测试、报告和将来的截图只使用合成数据及仓库确定性夹具。

## 待执行验证

本轮遵守目标 AGENTS.md，仅编辑源码和阅读 diff，没有本地安装、检查、测试、构建、预览或打包，没有推送或发布。需在用户授权推送后执行 Check，依据实际结果修正 TypeScript、ESLint、Vitest、双引擎 Playwright、架构审计以及两平台 Rust fmt／Clippy／tests 的失败。

实际 macOS／Windows 安装、原生对话框、系统打印及 WebView 交互验收仍需桌面构建和安装包验证。双引擎合成 E2E 与 Rust 测试不代替这一步；签名、公证与发布未执行。
