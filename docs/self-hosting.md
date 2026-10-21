# hostdzire 部署与账户同步

站点为 `https://sts2stats.quaternijkon.online`。本地完成验证和打包，通过 `~/.ssh/config` 的 `hostdzire` 上传成品。服务器使用随包提供的 Node.js 24.22.1 Linux x64 和内置 SQLite，不安装开发依赖、不编译源码、不使用 GitHub Actions。既有 `sts2.quaternijkon.online` 项目与数据库保持独立。

## 日常命令

先提交代码，再执行：

```sh
pnpm deploy:hostdzire
pnpm deploy:hostdzire status
pnpm deploy:hostdzire invite
pnpm deploy:hostdzire rollback
```

部署程序依次执行版本、ESLint、TypeScript、单元测试、架构审计、Web 构建、Web 生产包和账户同步浏览器测试。任何失败均停止上传。Linux 运行时从 Node 官方 HTTPS 下载，核对 SHA-256 后保存在本地缓存。上传包再次核对校验和，然后原子切换 `current`、重启独立 systemd 服务、检查 HTTPS；启动失败恢复上一版本。`rollback` 恢复程序，不回滚账户数据。`/build-info.json` 记录版本与源码提交。每个部署版本约 130 MB，旧版本保留以供回滚；清理时必须保留 `current` 和 `previous` 指向的版本。

`invite` 生成一次性、7 天有效的邀请码，保存到本地被 Git 忽略、权限为 0600 的 `.local-build/hostdzire/account-invite.txt`，不输出到终端或构建信息。打开游戏 → 设置 → 使用邀请码注册，设置至少 12 个字符的密码。账户没有邮件或第三方登录。管理员可通过 SSH 调用 `server/admin.mjs revoke-sessions 用户名` 撤销指定账户的会话；须以服务账户运行并指定生产 `STS_DATABASE`。

## 服务器配置

| 位置 | 用途 |
| --- | --- |
| `/opt/sts2stats-tauri/releases/` | 从本地上传的静态资源、服务程序、运行时 |
| `/opt/sts2stats-tauri/current` / `previous` | 当前／上一成功版本 |
| `/etc/sts2stats-tauri.env` | root 0600 的运行配置 |
| `/var/lib/sts2stats-tauri/sync.sqlite` | 专用账户私有数据库 |
| `/var/lib/sts2stats-tauri/backups/` | SQLite 在线一致性备份，保留最近七份 |
| `sts2stats-tauri.service` | 低权限 `sts2stats-sync` 账户，监听 `172.25.0.1:18765` |
| `sts2stats-backup.timer` | 每日私有备份 |
| `sts2stats-certificate.timer` | 每日检查本域名的 Let's Encrypt 续期 |

复用现有 Nginx Proxy Manager 和 HAProxy 的 80/443 入口，仅增加 `98-sts2stats-tauri.conf` 虚拟主机。HTTP ACME challenge 使用已有配置，其他 HTTP 请求跳转 HTTPS；Web 资源和 API 同源，关闭访问日志，口令和存档正文不写日志。服务端口只绑定 Docker 私有网关，不监听公网。首次部署依赖现有 Docker 网关、代理路径和域名 A 记录；不会修改其他站点、SSH、DNS 或防火墙。迁移机器需先调整脚本中的路径、网关和域名。

恢复数据前停止 `sts2stats-tauri`，用 SQLite 备份恢复方式替换数据库并移走旧 WAL/SHM，保持专用账户所有权及 0600 权限，再启动服务。删除账户后，旧备份按七份保留周期自然轮换。恢复旧数据会触发客户端的修订倒退冲突保护。备份目前在同一台机器，异机灾备需要另行配置。

## 同步与 Android

注册或登录不会上传存档。在设置点击「启用账户同步」才同步两款游戏**当前**的数据集及收藏。目录权限、绝对路径、manifest、来源归档、外观与筛选留在本机。服务端仅保存账户隔离的快照，解析、统计和复盘仍由各设备的同一 Engine / Worker 完成。

可见页面每 15 秒同步，也可以手动同步。桌面应用需保持运行，才能扫描新游戏存档并上传；Android Chrome 登录同一账户并启用同步即可查看，可添加到主屏幕。此版本不提供 Android 原生安装包或浏览器关闭后的后台运行。

每游戏使用服务端单调修订及客户端基准指纹。首次两端都有不同数据、两端同时修改、服务器恢复旧版本时要求选择，不根据时钟猜测覆盖。选择「使用本机并上传」采用当前本机版本；选择云端则先将本机数据保存为独立「同步备份」来源归档。导入、收藏、账户或其他标签页更新后，过期同步不得覆盖新状态。清除本机数据同时暂停账户同步，不删除云端；退出登录保留本机数据，共用设备需另行清除。

会话有效期 30 天；Web 使用 Secure / HttpOnly / SameSite=Strict Cookie，桌面使用 macOS Keychain / Windows Credential Manager。密码使用独立随机盐的 scrypt。修改密码撤销其他设备会话；删除账户移除服务器当前数据及会话，本机数据保留。传输使用 HTTPS，服务器磁盘由专用账户权限保护，**不是端到端加密**。单次请求限制为 256 MiB，失败保留本地数据，不影响本地导入容量。

## 本地调试

需要 Node.js 24+。两个终端分别运行 `pnpm dev:sync` 和 `pnpm dev`；API 仅监听 `127.0.0.1:18765`，Vite 同源代理。开发库位于 `.local-build/sync-dev/`，`node server/admin.mjs invite` 创建开发邀请码。

`pnpm build:web && pnpm test:e2e:sync` 使用实际生产资源，覆盖 Chromium、WebKit 和 Pixel 7 视口的 Chrome 模拟；模拟不等同于 Android 实机验收。合成测试账户与数据不进入生产服务。
