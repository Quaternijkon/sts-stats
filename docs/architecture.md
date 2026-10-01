# 架构

```text
React 视图 / Zustand 状态
  ├─ useAnalysis → 每游戏独立 Web Worker → Engine/bridge.ts → Engine/domain
  └─ StatsPlatform → Tauri IPC → Rust 原生目录和本地持久化
```

`Engine/` 保留原项目的解析、Schema、对象注册表、查询、统计、竞技场、流派及官方中文库。新界面直接导入上游 TypeScript；不使用、修改或分发原生项目打包后的 `engine.js`。官方本地化资源来自原项目的上游文件，不在页面内复制译名。

`src/services/platform.ts` 是文件、目录、导入导出和偏好持久化的唯一平台接口。安装应用通过受限 Rust commands 操作；浏览器 adapter 仅用于隔离预览。界面不获得任意原生文件写入权限。目录授权由原生选择器或 OS 拖放事件创建并持久化；拖放接口只消费原生事件保存的路径，不接受前端传入任意路径。重新扫描要求与已授权规范路径相同。无 HTTP、shell 或广泛 filesystem capability，CSP 禁止远程连接和脚本。

Rust 的文件选择、目录扫描和读写在 `spawn_blocking` 中执行。扫描跳过隐藏目录和符号链接，按 profile.save 选择当前 Profile，拒绝多个账号／来源、多个 progress.save、读取过程中变动的文件、超过 32 MiB 的单文件、超过 50,000 个文件或总计 512 MiB 的来源；错误会明确返回，不静默截断。同步先比较完整元数据指纹，无变化时不读取所有内容。所有 `.run` 和 `progress.save` 均只读，导出也禁止覆盖这些文件。

解析、Schema 验证、导入去重、完整结果排序／分页和统计均在 Web Worker 中执行。每个游戏一个 Worker，避免引擎全局游戏状态交叉污染。请求串行执行；同一组件的排队旧请求可被最新选择替换。已运行的同步统计不能中断，其结果由组件生存期保护，不能覆盖新选择。

分析结果缓存只在内存中，最多 36 条、32 MiB；单条超过 4 MiB 不缓存。每个视图最多缓存六个响应，随游戏、数据修订或显式重试失效。缓存可随时丢弃。持久化存档和来源归档属于用户的权威数据，不属于派生缓存。

导入在 Worker 中先准备完整候选数据，所有文件成功后才调用原生存储。`dataset.json` 使用同目录临时文件、flush 和原子替换；Windows 同样使用 tempfile 的覆盖式 persist。按来源哈希分开存储归档，保存接受的原始内容副本和归一化版本。切换回旧来源时恢复其已导入历史。原游戏目录中消失的文件不会删除已有归档。游戏来源不得与应用存储目录重叠。

原生旧数据保持 `runs / progress / source / importedAt / manifest / fileRunIDs` 结构；`importedAt` 仍是自 2001-01-01 起的秒数。额外 `importMetadata` 记录新导入的时间戳、内容摘要和接受的版本摘要，旧原生 Codable 会忽略此字段。旧 manifest 在新来源首次同步时重新生成 SHA-256 内容摘要。

布局通过同一设计系统响应窗口宽度。宽屏侧栏常驻，窄屏切换抽屉；列表使用浏览器表格并分页到 100 行，矩阵按 40×40 分块显示，固定不透明表头及左名称列。颜色集中在 `src/styles/theme.ts` 和 CSS tokens，角色身份按稳定 ID 绑定；数值大小、比例和偏好采用各自色阶。

本次仅支持 Windows 和 macOS。Android SAF 需要另行实现 platform adapter、Rust/Kotlin 授权目录插件和移动宿主工作流；本工程不会将浏览器目录 API 冒充 Android 原生存档访问。
