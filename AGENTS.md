# 仓库指南

本地工作仅限代码编辑、Git 提交和推送。依赖安装、检查、编译、打包和安装包验证使用 GitHub Actions；不得在本机运行 npm / pnpm 安装、测试、Vite 预览、cargo 或原生构建，不保留本地构建缓存与安装包。

- `Engine/` 是原项目上游 TypeScript 解析、Schema、统计和官方本地化。不得直接修改原生项目生成的 engine.js；本工程直接编译上游。
- `src/` 是 React / TypeScript 前端。状态在 Zustand，文件接口只能经过 `src/services/platform.ts`，重型分析与数据处理在独立 Worker。
- `src-tauri/` 是 Tauri 2 Rust 原生层；原生读写和扫描放在 spawn_blocking。平台仅 Windows / macOS。
- `.github/workflows/`、`docs/`、`scripts/`、`tests/` 分别放云端构建、架构、审计及合成测试。
- TypeScript 两空格；Rust cargo fmt。修改保持现有风格，不做无关重排。

## 云端验证

`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm verify:local`、`pnpm check:version`、`pnpm build`、`pnpm test:e2e`；Rust fmt / clippy / test 使用 src-tauri/Cargo.toml 和 Cargo.lock。

普通推送不产生安装包；PR、main 推送及手动触发 Check。Build Desktop 仅手动或 Release 调用。Release 仅 v* 标签发布，尚无 Check 前置依赖。三个版本字段和标签须一致。不得擅自推送、绑定别的仓库或发布。

## 数据约束

原游戏存档永远只读；应用写入限定为应用目录或用户通过导出对话框明确选择的目标。数据处理纯本地，禁止网络分析、遥测、账号服务或服务器。原 dataset.json 必须兼容，尤其 Foundation 的 importedAt 日期基准。派生缓存可丢弃且受大小限制。个人存档、账户标识和用户数据集不得放进仓库、公共资源、截图、报告或构建产物。

## 页面约束

复用统一 Card、MetricTile、MetricGrid、ObjectNumericCell 和 CSS tokens；标题简洁，说明只放 title / hover 帮助，禁止灰色解释性页脚。页面间距 24 / 窄屏16，章节20，组件12；指标卡内距16、圆角20、图标20、主值28，最多六列。

角色颜色按稳定 ID 绑定 Ironclad 红、Silent 绿、Regent 金橙、Necrobinder 紫、Defect 蓝、Watcher 紫红；颜色集中在 theme.ts 和 CSS tokens，不能按排序或胜率分配。数量蓝、胜利绿、承伤红、选择紫、金币金、连胜金橙、时间青蓝、楼层青绿。连续数值大小蓝→青→橙；比例红→黄→绿固定0/50/100%；偏好使用 #4f57c7→淡色→#107564，50%中性。风险必须有绝对阈值、方向、单位、文字或图标，否则保持中性，不能从样本百分位猜风险。

数值柱长：比例为实际0–1；数量／时长为完整筛选列的 count(smaller)/(n-1)，并列同排名、单值0；缺失显示—，不补零。分页前算排名。表头和矩阵左名称固定且背景不透明，大列表分页或虚拟化。

仅投入时间、滚动胜率和楼层到达率有局部角色滑块，保留全局其他过滤，稳定高度，最多六缓存响应，过时结果不覆盖新选择。胜负记录总体＋角色，五行按列排序，完整横向滚动，胜利绿失败红放弃灰。楼层1–49为实际到达，50固定通关率（胜利÷非放弃）。滚动和楼层用胶囊柱、固定0–100%轴。多人不得进入单人分析。

复盘生命当前绿、最大紫、净减少红、净增加蓝；承伤红、回复蓝、金币金、花费橙、回合紫。缺失断曲线、不造零；最终牌组按ID及升级合并。最小单元提供110ms亮度／内部描边hover，不能移位、缩放或改变尺寸；尊重减少动态效果。验证明暗、窄窗口、长标题和滚动，只用合成数据。

## 本地化

游戏内容必须通过 `/Users/ruoyangdong/project/sts2translate-skill/sts2-official-zh-translator` 获取或核对官方译名。现有官方库优先，不凭模型创造中文名；模组无官方对应须明确区分。不直接修改自动生成本地化产物，修改上游并重新生成。游戏 ID 和本地化表达式保持原样。
