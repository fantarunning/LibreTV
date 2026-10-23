# 东京单实例发布与回滚

## 已有入口与资源

- 正式入口：`https://comic.fenda.cc`，既有 Nginx TLS server 的根路径代理 `127.0.0.1:18081`；保留其他精确代理路径。
- 主机 CentOS 7.6 / glibc 2.17，约 1724 MiB RAM，无 Swap；本次首次检测可用约 369 MiB。
- 复用 `tripick-mysql` MySQL 8.4.11，`127.0.0.1:3307`；运行时 `max_connections=16`、`Max_used_connections=5`。LibreTV 连接池设 2，不增加 MySQL / Redis 服务。
- 专库 `libretv`、账号 `libretv_app`，仅授予该库 SELECT / INSERT / UPDATE / DELETE。六张 `ltv_` 表由管理员执行迁移；运行账号无 DDL 权限。
- LibreTV 服务保持 `MemoryLimit=256 MiB`、V8 old space 128 MiB。首次 Node24 隔离启动旧版本约 68 MiB，不能代替新功能并发测试。

## 凭据与备份

生产凭据只在主机 `/etc/libretv/` 的 root 所有、权限 600 文件中处理。不要复制到仓库、终端输出或命令参数。

`prepare.sh` 备份现有 `prod.env`、systemd unit、current 链接，已有专库时也做事务一致性 dump；首次专库原本不存在时记录 `DATABASE_WAS_ABSENT`。迁移脚本另写 `libretv-preactivate.sql`。本次首个备份目录为 `/home/libretv/backups/20261023T032952Z`。

准备文件是 `/etc/libretv/prod.env.next`、`/etc/libretv/libretv.service.next`；不会自动替换生效文件。`mysql.env` 保存新专库凭据，重复准备复用它。

## Node24 与旧 glibc

本次使用官方 `node-v24.22.1-linux-x64.tar.xz`，在工作站下载并按官方 SHASUMS256 核验后上传；主机只解压，不编译。

官方 Node24 不能直接使用系统 glibc 2.17。运行时复用主机已有 `/opt/glibc235` 和 C++ 库；仅修改 staged Node 二进制的 ELF `PT_INTERP` 为 `/opt/glibc235/ld.so` 短链接，wrapper 设置进程私有 `LD_LIBRARY_PATH`。系统 glibc 和旧服务均不替换。原始已校验归档保留用于重建。

直接执行 glibc loader 会使 Node `process.execPath` 指向 loader，破坏子进程；因此不能仅凭 `node -v` 验收。脚本检查服务用户下 Node、crypto、fs 和通过 `process.execPath` 启动的子 Node。随后用独立端口启动 Next 验证。该兼容路径仍依赖旧主机自维护，长期建议迁移到受支持系统。

## 发布顺序

本地使用已有 OpenSSH 身份；以下 `$target` 是已有 SSH 目标。Python 包装器以 LF 传输脚本，避免 PowerShell 管道 CRLF 问题。

```powershell
$target = 'root@server'
python scripts/infra/tokyo-ssh.py deploy/tokyo/prepare.sh --target $target --arg https://comic.fenda.cc
```

迁移 SQL 先上传 `/home/libretv/migrations/`，再执行 `migrate.sh`，依次执行 `001-accounts-sync.sql` 与 `002-tv-commands.sql`。MySQL 管理员凭据从主机原有 `/etc/tripick/mysql-root.cnf` 读取，不经本地中转。

所有本地构建/测试通过后，构建 standalone 并打包；不要在这台小内存服务器执行 npm 构建。

```powershell
$env:DOCKER_BUILD='1'
$env:NEXT_TELEMETRY_DISABLED='1'
npm run build
python scripts/infra/package-release.py libretv-family-20261023
```

将生成的归档上传 `/home/libretv/staging/`。使用打包器输出的 SHA256，运行：

```powershell
python scripts/infra/tokyo-ssh.py deploy/tokyo/stage.sh --target $target --arg /home/libretv/staging/libretv-family-20261023.tar.gz --arg SHA256 --arg libretv-family-20261023
python scripts/infra/tokyo-ssh.py deploy/tokyo/smoke.sh --target $target --arg /home/libretv/releases/libretv-family-20261023
```

隔离实例 `libretv-staging` 仅监听 `127.0.0.1:18082`，同样限制 256 MiB。使用账号业务流脚本验证登录、30/365 天会话、配对、跨端进度、分页、删除、撤销和 CSRF；确认数据库真实读写成功。需要保留合成记录时避免与真实历史混淆；脚本会撤销其测试设备并为测试进度写墓碑。然后停止 staging，释放内存。

只有明确 `release-ready` 后才执行：

```powershell
python scripts/infra/tokyo-ssh.py deploy/tokyo/activate.sh --target $target --arg /home/libretv/releases/libretv-family-20261023
```

激活脚本切换 env、可选 staged unit、current 链接并重启。健康检查失败会自动恢复旧 env、unit 和代码；健康检查通过之后，仍需公网真实业务流验收。不要把 `/api/status` 成功等同于账号同步/视频播放成功。

## 回滚

```powershell
python scripts/infra/tokyo-ssh.py deploy/tokyo/rollback.sh --target $target --arg /home/libretv/backups/20261023T032952Z
```

回滚恢复代码、配置与 unit，保留新增数据库和用户数据。恢复 SQL dump 属于数据恢复操作，应先核对快照与新增数据，不能自动覆盖已产生的真实历史。

## 播放源

默认源使用 [候选清单与链路报告](../public/sources/README.md) 中东京通过的 11 个源；失败候选不自动启用。报告覆盖搜索、详情、HLS 清单、中段分片，仍需手机/平板/实际电视解码和持续播放验证。没有把列表发布到外部分享服务。

将审定的 JSON 上传到主机后，用 `curated-sources.sh` 写入 `prod.env.next`。源名使用原生 UTF-8，避免 `\uXXXX` 在 systemd EnvironmentFile 中丢失反斜杠。重新启动 staging 后应核对运行中环境或登录状态 API 的源名确实可读，不能只检查 env 文件内容。

## 本次正式结果

2026-10-23 最终 release `/home/libretv/releases/libretv-family-20261023` 已激活，staging 已停止。归档 SHA256：`553071e6165a426eeea2d4156b238912d218a394fbaf5709bb2236b0873b1cc5`。公网 11 项账号业务流、30 天安全 Cookie、APK 与 4K 清单哈希复核通过。切换后共享服务 PID 均保持基线，可用内存约 614 MiB，LibreTV 约 76 MiB（此为复验时点值，并非容量上限证明）。

生产接口可使用现有凭据在主机内部重复验收：

```powershell
python scripts/infra/tokyo-ssh.py deploy/tokyo/verify-accounts.sh --target $target --arg /etc/libretv/prod.env --arg https://comic.fenda.cc
```

其他业务与设备证据见 [本次验收记录](verification-2026-10-23.md)。
