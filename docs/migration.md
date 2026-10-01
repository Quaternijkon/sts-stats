# 移植覆盖与验证

2026-10-02 的逐项补齐和静态集成审查见 [native-parity-2026-10-02.md](native-parity-2026-10-02.md)。本轮新增实现和测试尚待云端执行；下文迁移初期的通过记录不适用于尚未检查的新修改。当前 Release 已增加完整 Check 前置依赖，云端检查覆盖 Chromium / WebKit 和 macOS / Windows。

| 原项目能力 | 新入口／实现 |
| --- | --- |
| 一代／二代首页与隔离 | 游戏首页、每游戏独立 dataset、Worker、偏好与来源归档 |
| 全局、生涯统计 | OverviewPage；沿用 dashboard / career 算法 |
| 角色、滚动、楼层、时间、记录图 | 固定身份色；局部角色滑块；50 项通关率；五行记录格 |
| 27 类对象及详情 | ObjectPages；UnifiedObjectRegistry 与逐局／生涯区分 |
| 卡牌选择竞技场 | 原模型、排序、区间、直接／间接证据、分块矩阵和 CSV |
| 卡牌流派 | 原模型、结构图、核心／桥接成员、归属、对局构成和诊断 |
| 休息处分析 | 原分析、生命分箱、选择统计及后续实际路线相关 |
| 单人、多人、收藏、复盘 | RunPages；Worker 分页；玩家切换；面积曲线、缺失断点、节点详情 |
| 最终牌组／遗物 | ID + 升级等级合并、紧凑换行标签及对象跳转 |
| 导入、同步、归档 | Rust 只读访问、Worker 事务验证、内容身份去重、来源归档 |
| dataset.json 兼容 | Foundation 日期和原字段；通过显式文件选择迁移 |
| 本地设置和维护 | 存档管理、清除本游戏数据、主题、最低样本及自动同步 |
| macOS-only 构建 | Tauri macOS / Windows 工程及 GitHub Actions |

移植不是逐像素复制 SwiftUI：系统菜单、NSOpenPanel 书签、AppKit 表格和 Swift Charts 换为 Tauri 原生对话框及统一 React 组件。Windows 与 macOS 共用业务代码，平台差异在 Rust 和 StatsPlatform 服务层。Android 不在本次范围。

迁移中给原 TypeScript 桥和解析函数补充类型标注；对象列表最低样本过滤在完整结果排名前执行；胜负记录移除每角色 100 条截断；修复 floor 查询丢失 roomType 关联的既有问题。原查询测试中两处只修改外层快照的夹具补齐对应玩家快照，保留原断言。

测试全部采用合成数据或仓库既有确定性样例，没有使用个人游戏存档。新增导入测试覆盖重命名去重、文件消失保留、同名不同对局、版本时间冲突、来源隔离、坏文件全事务回滚及 Foundation 日期兼容。Rust 测试覆盖只读扫描、符号链接、多个 Profile 和原子替换。浏览器验证覆盖统计、对象、分页、复盘、游戏隔离、明暗主题、窄窗口及滚动表头。

本机 macOS 的 Rust 编译／测试和前端验证不能替代 Windows runner 构建及安装体验验证。目标仓库为 `Quaternijkon/sts-stats`，以 Actions 实际运行结果作为云端检查和编译依据。签名、公证和正式发布也尚未执行。

用户请求的子代理分工已发起，但默认模型通道连续返回 503，子代理没有完成审查。主代理继续实现和验证，没有将失败的子代理任务计为已完成。

## 迁移初期验证记录 · 2026-10-01

- ESLint、TypeScript、生产前端构建、本地架构／公共资源审计和版本一致性检查通过。
- Vitest：51 项通过；Rust：5 项通过，fmt / Clippy 无警告；Playwright：4 项通过。
- 浏览器检查覆盖全部桌面导航入口、明暗主题、窄窗口、长名称、滚动表头，以及角色滑块的图表结构／高度／位置和全局筛选保持不变。
- macOS Apple Silicon 的 Release 应用和 DMG 已由本机工具链生成，采用临时签名。CI 配置另外构建 Apple Silicon / Intel 通用 DMG。
- 原生应用进程可启动；电脑 UI 自动化未能取得该窗口（cgWindowNotFound），原生窗口交互验收尚未完成。Windows 安装包及 GitHub Actions 尚未实际运行。
- 本机新 SDK 的优化构建出现过 Mach-O 宏库加载错误，显式关闭 Release 符号剥离后编译成功。DMG 在 CI 模式下构建，避免依赖 Finder 的自动化排版。
- 本次未读取个人存档；三个确定性夹具未发现账户标识。原项目目录完整保留。

后续开发限定为本地代码编辑和 Git 操作，检查、编译及打包使用 GitHub Actions。此前生成的本地构建缓存、测试浏览器和安装包已清理。
