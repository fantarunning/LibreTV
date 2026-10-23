# 家庭账号、跨端同步与电视配对

本分支使用现有 MySQL 实例中的独立 `libretv` 库。Next.js 同时提供网页与账号 API，无需额外 Java 服务或 Redis。浏览器 IndexedDB 保存本地投影、云端版本和持久待同步队列；MySQL 保存跨设备记录。

## 配置与迁移

复制 `.env.example`，配置 `PASSWORD`、`MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_DATABASE`、`MYSQL_USER`、`MYSQL_PASSWORD`。生产设置 `APP_ORIGIN` 为实际 HTTPS 站点 origin，并设置 `COOKIE_SECURE=true`。`DATABASE_URL` 是可选替代连接方式，非空时优先于 `MYSQL_*`。

`MYSQL_CONNECTION_LIMIT` 默认 4、上限 10；东京配置为 2。Node 直接运行时可连接宿主机 `127.0.0.1`；Docker 连接宿主机 MySQL 时使用 `host.docker.internal`。不创建新的 MySQL 实例，也不连接其他项目的业务库。

聚合搜索每个请求同时处理最多 `SEARCH_CONCURRENCY` 个源，默认 4、上限 8；每个源后续分页最多并行 2 个，`SEARCH_MAX_PAGES` 默认 5。源级死线仍由 `SEARCH_SOURCE_TIMEOUT_MS` 控制。客户端取消请求或关闭 NDJSON 流会中止在途请求并停止未开始的源/分页，不写入取消结果缓存。

先由管理身份创建专库并运行以下两个文件；应用身份仅授予该库的 `SELECT/INSERT/UPDATE/DELETE`：

1. `migrations/001-accounts-sync.sql`
2. `migrations/002-tv-commands.sql`

本地迁移命令为 `node scripts/migrate-mysql.mjs`，执行前使用迁移身份配置环境。SQL 幂等建表，不修改其他项目表。运行时不自动建表；缺少连接或迁移会明确返回 503，不会降级为内存“云同步”。

六个表分别保存用户、设备会话、短期配对、同步文档、已接受事件、短期电视遥控命令。原全站 PASSWORD 用于引导默认家庭账号，不开放匿名注册。`ACCOUNT_NAME` 默认为“家庭账号”，同时作为账号命名空间；变更它会进入另一个账号，不会自动迁移旧记录。

## 登录与设备

`POST /api/auth` 接受 `{password, deviceName?}`，返回 `{success, account}`，通过 `HttpOnly/SameSite=Lax` Cookie 持久化随机设备凭据。浏览器会话从本次登录起固定 30 天，不随普通访问续期。服务器仅保存凭据 SHA-256 摘要。

`GET /api/account/me` 返回 `AccountSession`。`GET /api/account/devices` 返回 `{devices}`，包含设备 ID、名称、类型、到期时间和 `current`；`DELETE /api/account/devices?id=...` 撤销同一账号的一台设备。`DELETE /api/auth` 撤销当前会话并清除 Cookie。设备撤销后下一次受保护请求即被拒绝；没有长期会话缓存绕过撤销。

原 `<expiresAt>.<hmac>` Cookie 无账号身份，升级后不再接受，需要登录一次。修改 `PASSWORD` 或 `PROXY_SECRET` 会使原有设备凭据失效。

浏览器写请求校验 `Origin` 或同源 Fetch Metadata。原生端使用 `Authorization: Bearer <device token>`，仅向自有服务 origin 发送，不应把令牌附到第三方播放源或 CDN。

## Android TV 配对

1. TV 调用 `POST /api/tv/pair`，请求 `{deviceName}`，获得 `{deviceCode,userCode,expiresAt,verificationUrl}`。配对码为 8 位，5 分钟有效。
2. 手机打开 `verificationUrl`（`/account/tv?code=...`），先通过网页账号登录，再调用 `POST /api/tv/pair/approve`，请求 `{userCode}`。
3. TV 每数秒调用 `GET /api/tv/pair?deviceCode=...`。响应状态为 `pending`、`authorized` 或 `expired`。仅持有高熵 `deviceCode` 的配对通道获得 `{token,expiresAt}`；手机批准接口不返回 TV 凭据。
4. TV 使用原生受保护存储保存凭据，通过 Bearer 调用 API。服务器固定签发 365 天会话，可通过设备列表提前撤销。

短码只能由已登录的网页设备批准；TV 不能通过自称 user-agent 或请求类型获得一年登录。创建、批准和轮询分别有限流；批准过程加数据库行锁，已使用的短码不能重复创建设备。TV 凭据在配对表中加密保存，仅在配对有效期内支持可靠重试。

## 同步协议

共享类型位于 `src/lib/cloud-types.ts`。可同步类型为 `history/progress/skip/favorite/preferences`。账号始终从服务端会话读取，请求不能指定目标用户。

```json
{
  "mutations": [{
    "eventId": "a-unique-event-id",
    "kind": "progress",
    "key": "source_film_0",
    "value": {"key":"source_film_0","position":120,"duration":1800,"updatedAt":1800000000000},
    "baseVersion": 0
  }]
}
```

将以上对象提交到 `POST /api/sync`。响应包含 `accepted` 事件 ID、`records` 服务端新版本和 `conflicts` 当前服务端值。新文档以 `baseVersion=0` 创建；修改需要精确匹配当前版本。一个账号的事务锁串行分配版本，两个设备不能同时以旧版本成功覆盖同一文档。

同一 `eventId` 的相同提交只应用一次；同一 ID 换成其他内容返回 409。冲突返回当前记录，不自动将旧进度重试到更新版本。明确的后续重看、拖回会生成新事件，并以已确认的新版本继续提交。

`value=null` 是持久删除标记，也占用服务端版本；旧设备离线队列不能以旧版本恢复已删除文档。普通本地缓存淘汰与用户主动删除不同，不向其他设备同步缓存淘汰。

`GET /api/sync?cursor=0&limit=100` 返回 `{records,cursor,hasMore}`，以服务端版本排序。客户端保存每账号游标，持续请求直到 `hasMore=false`。记录键最多 512 字符；每批最多 50 条、整个请求最多 256 KiB、单文档最多 64 KiB。校验流式字节大小，不能通过省略 Content-Length 绕过限制。

浏览器同步请求必须携带 `X-LibreTV-Account: <预期账号ID>`；服务器在它与当前 Cookie 身份不一致时返回 403，防止退出/切换 Cookie 的竞态把旧账号待同步数据交给新账号。该头只用于比较，不授予账号权限。原生客户端也应携带它。

网页每 15 秒尝试同步，回前台、恢复网络时也尝试。播放进度先落 IndexedDB，再进入可合并的持久队列；请求期间的新操作保留新事件 ID，不被旧响应删除。切换账号会清除当前本地投影并重置目标游标，从 MySQL 重建，保留各账号独立队列和版本元数据。

作品与集进度仍按 `sourceKey/vodId/episodeIndex` 定位。同一来源的跨设备续播已实现；跨源存在集号或剪辑差异时，需要业务层匹配，不代表任意两个播放源能精确无缝衔接。

## 手机遥控自己的 TV App

`POST /api/tv/commands` 接受 `{deviceId,action,payload?}`，只允许同一账号的未撤销 TV。支持 `play/pause/resume/seek`；`seek.payload.position` 单位为秒。`play` 参数为 `{source:{key,name,url},vodId,title,episodeIndex,position?}`，集号从 0 开始。

直接播放 4K 目录等媒体时，`play.payload` 可附加 `directUrl,width,height,codec,isLive`，TV 跳过采集站详情请求并使用媒体直链；`isLive=true` 时不恢复进度、不缓存、不自动下一集。服务器验证 HTTP(S) 地址、有限整数尺寸和元数据长度。

TV 用 Bearer 轮询 `GET /api/tv/commands?after=0`，获得 `{commands:[{id,action,payload}],cursor}`。命令 ID 与游标为整数；保存最后处理的游标，避免重复操作。每台电视最多保留 50 条，命令 120 秒过期。此功能要求 TV App 在线，不承诺唤醒待机或已关闭的电视，也不等同 DLNA/AirPlay/Google Cast。

## 验证证据

2026-10-23 在东京 rc1 staging（本机 18082）对真实 MySQL 专库通过 `scripts/verify-account-flow.mjs` 验证：网页登录 30 天、TV 配对 365 天、Web→TV 进度、事件幂等、CAS 冲突、分页、删除防复活、遥控、CSRF、旧 Cookie 拒绝、设备撤销，共 11 项。凭据只在主机内部注入测试进程，不打印；测试创建设备已撤销，合成进度留删除标记。

`deploy/tokyo/verify-accounts.sh` 可重复运行这组业务流。单元测试另覆盖真实 Dexie 客户端的账号往返切换、晚到确认、离线重连等竞态；这两类结果与实体电视解码、第三方播放源可播性、生产切换验收分别记录。
