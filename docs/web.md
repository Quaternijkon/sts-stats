# Web 平台

Web、Windows 和 macOS 共用 React 界面、Zustand 状态、Engine 解析统计及每游戏独立 Worker。`platform.ts` 选择浏览器或原生适配器。匿名使用不需要 Tauri 宿主或数据库服务器。可选自托管账户支持电脑和 Android 浏览器同步当前数据集与收藏，见 [self-hosting.md](self-hosting.md)。

## 构建与部署

```sh
pnpm install --frozen-lockfile
pnpm build:web
pnpm test:e2e:web
```

`dist-web/` 是可部署的完整静态站点；`.local-build/releases/v版本/STS2Stats_版本_web.zip` 是发行包。将 ZIP 解压后的内容交给 HTTPS 静态托管即可，也支持站点子目录，不需要 SPA 路由重写或 API。不能直接用 `file://` 双击打开。`pnpm preview:web` 在 `http://127.0.0.1:1421/sts2stats/` 验证实际生产包和子目录资源路径。

网页只从站点加载自身资源，生产 CSP 仅允许同源数据连接（`connect-src 'self'`）。注册和登录不会上传存档，主动启用账户同步后才上传两游戏当前数据集与收藏。静态托管仍可独立使用匿名功能；可选账户由同源自托管服务提供，不添加遥测。

## 浏览器能力

| 能力 | Chromium 的目录授权浏览器 | Safari / WebKit 及其他浏览器 |
| --- | --- | --- |
| 统计、对象、竞技场、流派、单人／多人复盘 | 共用完整引擎与 Worker | 共用完整引擎与 Worker |
| `.run` / `progress.save` / `dataset.json` | 手动导入、拖放和导出 | 手动导入、拖放和导出 |
| 文件夹导入 | 只读授权目录 | 文件夹选择器，手动导入 |
| Profile 切换 | 读取 profile.save，跟随当前 Profile | 导入时读取 profile.save |
| 自动同步 | 获得目录读取权限后，页面运行期间轮询 | 重新选择文件夹或文件更新 |
| 刷新后保留、来源归档与收藏 | 当前站点 IndexedDB | 当前站点 IndexedDB |
| 完整旧目录与 plist 迁移、打开应用数据目录 | 使用桌面版；Web 可迁移 dataset.json | 使用桌面版；Web 可迁移 dataset.json |

目录只请求 `read` 权限。浏览器撤销读取权限或重新打开页面后需要确认时，可在存档管理点击「重新授权目录」。应用不自动弹出权限请求。隐藏文件不导入，多个账号或 progress.save 混在一起时拒绝导入。

不支持目录授权的浏览器无法证明两次选中的同名文件夹是同一来源，因此每次手动选择建立独立来源，已有归档不会被覆盖或混合。可以在「来源归档」切换，也可以导入此前导出的完整 dataset.json。

## 存储与备份

完整数据、启动摘要、来源归档和偏好在 IndexedDB 中分别存储，原先的 localStorage 预览数据会在成功提交后迁移。小型偏好恢复记录会同步写入 localStorage，避免快速刷新丢失最后一次筛选或收藏；IndexedDB 提交成功后清理对应记录。游戏、来源相互隔离；数据与归档一起提交，写入失败保留旧数据。大数据不受 localStorage 的约 5 MB 限制，实际容量取决于浏览器站点配额。

每游戏派生缓存最多 128 项、128 MiB，单项最多 4 MiB；缓存可丢弃。配额不足时先清理派生缓存，再尝试一次权威数据提交；仍失败会明确报告，不静默清空记录。不同标签页使用数据修订身份拒绝过期导入或归档切换，并通知已打开的页面重新读取已提交数据。

「保留浏览器数据」向浏览器申请长期保留，是否批准由浏览器决定。隐私窗口、清理站点数据、删除浏览器配置或更换站点域名／端口都可能导致原数据不可用。请定期在存档管理导出 dataset.json；浏览器存储不是跨设备备份。桌面与 Web 可通过 dataset.json 互相迁移，Foundation importedAt 日期基准不变。

## 验证

本地合成测试覆盖 IndexedDB 事务回滚、缓存上限、旧存储迁移、跨标签页过期写入、超过 5 MB 的数据、刷新后的收藏和偏好、只读目录授权／权限恢复／Profile 选择、无目录 API 的文件夹导入及生产包子目录部署。Chromium 与 WebKit 运行相同界面回归；目录授权功能按浏览器实际能力验证。

1.2.0 的本地 `pnpm verify` 已通过：133 项单元测试、开发版和 Web 生产包各 47 项浏览器回归，以及 21 项 macOS Rust 测试。两个浏览器套件各跳过一项 WebKit 不提供的目录授权 API 用例；手动目录导入仍在 WebKit 中验证。版本检查、ESLint、TypeScript、架构审计、两种前端生产构建、Rust fmt / Clippy 同时通过。
