# 免费免账号 4K 来源复查 · 2026-10-23 第二轮

本轮找到一个新的、含较多 4K 编码内容的来源 **4K-AV 的电影/电视剧栏目**。公开媒体 URL 无需 Cookie、Authorization、额外账号或付费；本机和东京均取得实际媒体。它不是 AppleCMS 采集接口，接入现有 LibreTV 需要网页目录适配、明确选择 4K 版本，并验证 HEVC 播放。

## 可用来源与证据

| 来源 | 本轮实测 | 范围与接入条件 |
| --- | --- | --- |
| [4K-AV 电影](https://4k-av.com/movie/) / [电视剧](https://4k-av.com/tv/) | 固定跨页抽样 24 条，24 条匿名可取流并取得尺寸；15 条编码宽度 3840，其中 8 条为 3840×2160、7 条为宽银幕裁边；9 条低于 4K，0 失败、0 未知 | 新发现；样本中 62.5% 达到 3840 宽。它仍是混合片库；抽样不能作为整库普查或原生 4K 母版认证 |
| [最大资源公开 API](https://api.zuidapi.com/api.php/provide/vod) | 定向复测 5 部，4 部 3840×2160、1 部超时 | 已知混合源，有实际 4K 正片，不能据这批正向候选推断整库多数 4K |
| [快车资源](https://kuaichezy.com/) / [公开 API](https://caiji.kuaichezy.org/api.php/provide/vod) | 定向复测 4 部，2 部 3840×2160、1 部 3840×1632、1 部超时 | 已知混合源；官网公开免费采集接口，适合补充 4K 正片 |

抽样时间为北京时间 2026-10-23 13:06–13:20；可达性和链接有效期以这次检查为限。没有将普通源、单片目录或网站的“4K”名称当成整个来源的画质证明。

## 4K-AV 的抽样方法

先读取电影目录第 1、10、19 页和 TV 目录第 1、6、11 页，每页在排除成人/情色分类条目后的目录行中，固定选取 floor(n×10%)、floor(n×35%)、floor(n×60%)、floor(n×85%) 四个位置，再检查详情及媒体。最新页自动跳回栏目首页，保留真实来源页。选择不依赖 4K 标签，并保留低分辨率和失败条目在分母中。

电影样本 7/12 达到 3840 宽；TV 样本 8/12。TV 栏目包含剧集、动画、纪录片及晚会，不能把 24 条称为 24 部电影。这个固定跨页样本比只挑 4K 标签更有参考价值，但仍不是随机全库抽样。

验证读取 HLS 清单、实际中段分片和 fMP4 初始化数据的 visual sample entry；不会只采用标题、标签或清单宣称的分辨率。3840×1608 等是宽银幕编码尺寸，单独列出，不能写成完整 3840×2160。尺寸也不能证明无上采样、原盘码率或原生 HDR。

## 另外定向验证的 6 个例子

这 6 条没有混入上述 24 条占比。本机及东京均成功取得清单、中段和媒体头；初始化段均为 hvc1 / HEVC。

| 正片/剧集 | 实际编码尺寸 | 时长（约） | 公开详情页 |
| --- | --- | --- | --- |
| 逆行人生 | 3840×1608 | 121.1 分钟 | [播放页](https://4k-av.com/movie/007024-upstream/) |
| 猎罪图鉴 第 2 季第 1 集 | 3840×1608 | 47.8 分钟 | [播放页](https://4k-av.com/tv/207289-under-the-skin-s02e01/) |
| 默杀 | 3840×1608 | 119.5 分钟 | [播放页](https://4k-av.com/movie/006916-a-place-called-silence/) |
| 庆余年 第 2 季第 1 集 | 3840×2160 | 47.8 分钟 | [播放页](https://4k-av.com/tv/105778-joy-of-life-s02e01/) |
| 抓娃娃 | 3840×1504 | 133.4 分钟 | [播放页](https://4k-av.com/movie/006920-successor/) |
| 志愿军：存亡之战 | 3840×1608 | 143.4 分钟 | [播放页](https://4k-av.com/movie/007288-the-volunteers-the-battle-of-life-and-death/) |

既有审计脚本以 height ≥1600 辅助标记 cropped 4K，因而将《抓娃娃》标为 false。这里保留原始结果并直接报告 3840×1504，不将它伪报为 2160 高；本轮导出按实际 3840 宽的电影画幅定义，标明每条真实宽高。

## 播放与接入限制

- 网站公开说明 4K 优先支持苹果设备。本轮正常浏览器导航可访问；普通脚本请求详情页有 403。移动页面公开选择 4K HEVC 地址，桌面页面对同片默认提供较低清晰度。读取了 [开源网页适配规则](https://github.com/YYDS678/uzVideo-extensions/blob/main/vod/js/Zhi_4kav.js) 作为发现线索，没有执行第三方插件。
- 已获得的媒体直链在普通审计 UA 和 iPhone UA 下均无需登录、Cookie 或 Referer；东京以并发 2、64 MiB V8 上限完成 6 条只读复测。
- 媒体响应的 `Access-Control-Allow-Origin` 为 `https://4k-av.com`。当前 `comic.fenda.cc` 网页不能把它当作允许任意跨域的直链，需使用应用现有代理能力并实测初始化段、分片、Range 和字幕等。原生 Android 播放器仍需 HEVC 解码验证。
- 搜索阶段直接访问上游的桌面检查窗口内，《庆余年 2》为 `videoWidth=0`、`currentTime=0`、`readyState=0`。后续发布验收使用应用同源代理，Chrome 155 已在正式 `/watch` 页面解码为 3840×2160，时间正常推进且跳转成功；先前短窗口失败不代表浏览器无法解码。TCL T7K 与 Safari 真机仍未验收。
- 用户随后要求发布到生产：已将本轮 21 条核验内容加入网站动态 4K 目录，现共 40 条；已有电视 APK 读取同一目录。发布记录见 [4KAV 生产发布](4kav-production-release-20261023.md)。

## 排除与未核实来源

- [无水印资源 4K 分类](https://wsyzy.cc/index.php/vod/type/id/62.html)：公开 API 当次列出约 848 条。两个并行样本归并后为 16 个不同条目，均至少一次可取到媒体，实际尺寸没有一条达到 4K。包含语言版本，不能视为 16 部独立影片；原始失败/重试未抹去。
- [永乐视频](https://www.ylys.cc/play/84601-3-31/)：公开页面有自营 4K 线路信息，本轮主站及发布页给出的备用站播放页超时或 523，未确认可用媒体。
- [枫叶 4K](https://fengye4k.cn/movie/anime_37c13a8d56)：详情要求登录、积分或会员解锁下载，属于网盘/磁力模式，不符合免额外账号直连要求。
- [北觅](https://v.luttt.com/voddetail/3734/)：本轮 HTTP 567，无已验证媒体。
- 1Shows：主页可被 HTTP 工具取得，但正常浏览器跳到其他网站，未得到影片播放证据。
- Anyflix：《星际穿越》页面标 4K，正常点击后当前自动线路实际播放 1920×1080；其他质量选项未验证，不能据此断言全站最高只有 1080p。
- GitHub 中的野兔、小胡、飞刀、淘影、旧 4K API 等新线索，本轮为 503、超时、TLS 错误或未授权响应；Nakios 为发现线索，未取得实际媒体。没有注册、购买或使用第三方账号凭据。

## 本地交付物

- `deploy/.artifacts/4kav-verified-20261023.m3u`：21 条去重、实测 3840 宽的公开媒体链接，其中 9 条完整 2160 高、12 条宽银幕裁边。此为已验证条目导出，不是整个来源的替代品。
- `deploy/.artifacts/4kav-verified-20261023.json`：同一批条目的尺寸、时长、详情页和核验时间。
- 原始证据：`renewed-4kav-systematic-selection.json`、`renewed-4kav-systematic-pages.json`、`renewed-4kav-systematic-results.json`、`renewed-4kav-systematic-summary.json`、`renewed-4kav-six-results.json`、`renewed-4kav-six-codecs.json`、`renewed-4kav-tokyo-results.json`、`renewed-4kav-cors.json`、`renewed-4kav-browser-decode.json`，均在本机忽略目录 `deploy/.artifacts/`。
