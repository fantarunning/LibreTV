# 源清单来源与验证

`curated.json` 为东京出口通过链路探测的 11 个候选源；不是版权或内容分级认证，也没有把响应成功等同于真机完整播放。

## 来源

- 当前东京 LibreTV 部署者公开 AppleCMS 配置：6 个源，读取时只提取公开 API 字段，未复制任何密码、token 参数或私有订阅。
- 上游历史配置：[LibreSpark/LibreTV js/config.js](https://github.com/LibreSpark/LibreTV/blob/65382704af751ac034cce616b3dd63fec7ddbb43/js/config.js)。排除 `adult: true` 和测试地址后，与现配置按 API URL 去重得到 24 个候选。
- 没有向公共粘贴板、外部订阅服务或其他第三方发布列表。

## 测试方法和边界

- 本地测试时间：2026-10-23T03:31:25.712Z；本地当前网络。
- 东京测试时间：2026-10-23T03:33:01.980Z；东京服务用户执行、与部署相同出口。
- 每源以「西游记」做一次搜索，取最多 3 个结果，请求独立详情，解析直接 HLS URL、主/子清单、AES-128 密钥（如有）及一个中段分片。分片只取最多 64 KiB，检查 HTTP 状态、大小并排除 HTML/JSON 错页。
- 探测并发 4、单请求 8 秒、JSON/清单大小最多 2 MiB，公开地址与重定向均排除内网目标。
- 探测未做音视频解码、分辨率鉴定、完整剧集播放、广告审核或实际手机/电视网络测试。源的覆盖和状态会变化；单次未搜到该片不表示该源所有内容均不可用。
- 报告不保存播放清单、媒体分片或含时效 token 的播放 URL。

| 源 | 本地 | 东京 | 默认状态 |
|---|---|---|---|
| 如意资源 | TypeError | http-403 | 排除 |
| 极速资源 | 链路通过 | 链路通过 | 默认候选 |
| 光速资源 | 链路通过 | 链路通过 | 默认候选 |
| 新浪资源 | 链路通过 | 链路通过 | 默认候选 |
| 百度资源 | 链路通过 | 链路通过 | 默认候选 |
| 魔都资源 | 链路通过 | 链路通过 | 默认候选 |
| 电影天堂资源 | 链路通过 | 链路通过 | 默认候选 |
| 暴风资源 | 链路通过 | 链路通过 | 默认候选 |
| 天涯资源 | not-json | not-json | 排除 |
| 小猫咪资源 | ENOTFOUND | ENOTFOUND | 排除 |
| 非凡影视 | 链路通过 | 链路通过 | 默认候选 |
| 黑木耳 | not-json | not-json | 排除 |
| 360资源 | 链路通过 | 链路通过 | 默认候选 |
| iqiyi资源 | http-503 | http-503 | 排除 |
| 卧龙资源 | not-json | not-json | 排除 |
| 华为吧资源 | http-405 | not-json | 排除 |
| 豆瓣资源 | no-search-results | no-search-results | 排除 |
| 魔爪资源 | TypeError | TypeError | 排除 |
| 最大资源 | 链路通过 | 链路通过 | 默认候选 |
| 樱花资源 | http-403 | http-403 | 排除 |
| 无尽资源 | http-403 | http-403 | 排除 |
| 旺旺短剧 | 23 | not-json | 排除 |
| iKun资源 | TypeError | 链路通过 | 默认候选 |
| 量子资源站 | 链路通过 | http-404 | 排除 |

两地都通过的源为 10 个；iKun 仅东京通过，当前应用通过东京代理拉取，因此保留。量子本地通过但东京返回 404，不加入东京默认列表。如意在东京返回 403，移出默认列表。失败源保留在候选文件和报告中，供后续人工复测，客户端不会自动启用它们。

## 复测

```powershell
node scripts/infra/probe-sources.mjs scripts/infra/source-candidates.json public/sources/probe-local.json public/sources/curated-local.json
```

默认生产列表取东京报告；不要用本地复测结果直接覆盖生产清单。`probe-local.json`、`probe-tokyo.json` 可核对各阶段、耗时和失败原因；`scripts/infra/source-candidates.json` 保留原始候选。
