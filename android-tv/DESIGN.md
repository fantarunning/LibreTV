---
name: LibreTV Android TV
description: 原生 Android TV 的深色大屏影音界面，保留 LibreTV 身份与遥控器操作。
colors:
  primary: "#E50914"
  on-primary: "#FFFFFF"
  background: "#101014"
  navigation: "#16161B"
  surface: "#202026"
  panel: "#202027"
  navigation-selected: "#393940"
  surface-variant: "#49454F"
  text-primary: "#FFFFFF"
  text-secondary: "#BCBCC7"
  text-hero: "#CFCFD7"
  text-source: "#AFAFBC"
  text-placeholder: "#A6A6B2"
  input-outline: "#565661"
  focus-fill: "#E6E1E5"
  focus-content: "#313033"
  focus-border: "#938F99"
  pairing-wait: "#E1BDC0"
  feedback: "#26262C"
  error-container: "#481D25"
  error-text: "#FFB6BB"
  player: "#000000"
typography:
  wordmark:
    fontFamily: "sans-serif"
    fontSize: "45sp"
    fontWeight: 700
    lineHeight: "52sp"
    letterSpacing: "0sp"
  display:
    fontFamily: "sans-serif"
    fontSize: "36sp"
    fontWeight: 400
    lineHeight: "44sp"
    letterSpacing: "0sp"
  display-hero:
    fontFamily: "sans-serif"
    fontSize: "36sp"
    fontWeight: 700
    lineHeight: "44sp"
    letterSpacing: "0sp"
  headline:
    fontFamily: "sans-serif"
    fontSize: "32sp"
    fontWeight: 400
    lineHeight: "40sp"
    letterSpacing: "0sp"
  headline-medium:
    fontFamily: "sans-serif"
    fontSize: "28sp"
    fontWeight: 400
    lineHeight: "36sp"
    letterSpacing: "0sp"
  headline-small:
    fontFamily: "sans-serif"
    fontSize: "24sp"
    fontWeight: 400
    lineHeight: "32sp"
    letterSpacing: "0sp"
  title:
    fontFamily: "sans-serif"
    fontSize: "22sp"
    fontWeight: 400
    lineHeight: "28sp"
    letterSpacing: "0sp"
  body:
    fontFamily: "sans-serif"
    fontSize: "16sp"
    fontWeight: 400
    lineHeight: "24sp"
    letterSpacing: "0.5sp"
  body-medium:
    fontFamily: "sans-serif"
    fontSize: "14sp"
    fontWeight: 400
    lineHeight: "20sp"
    letterSpacing: "0.2sp"
  body-small:
    fontFamily: "sans-serif"
    fontSize: "12sp"
    fontWeight: 400
    lineHeight: "16sp"
    letterSpacing: "0.2sp"
  label:
    fontFamily: "sans-serif"
    fontSize: "14sp"
    fontWeight: 500
    lineHeight: "20sp"
    letterSpacing: "0.1sp"
  input:
    fontSize: "18sp"
  pairing-code:
    fontFamily: "monospace"
    fontSize: "32sp"
    fontWeight: 600
    lineHeight: "40sp"
    letterSpacing: "4sp"
rounded:
  field: "6dp"
  card: "8dp"
  button: "50%"
spacing:
  compact: "8dp"
  button-vertical: "10dp"
  small: "12dp"
  control: "14dp"
  regular: "16dp"
  row-inset: "18dp"
  section: "20dp"
  collection: "22dp"
  overlay: "24dp"
  rail-vertical: "26dp"
  title-overlay: "28dp"
  page: "32dp"
  detail-gap: "34dp"
  settings-page: "38dp"
  detail-page: "42dp"
  pair-gap: "48dp"
  pair-horizontal: "64dp"
components:
  button:
    backgroundColor: "rgba(73, 69, 79, 0.8)"
    textColor: "rgba(230, 225, 229, 0.8)"
    typography: "{typography.label}"
    rounded: "{rounded.button}"
    padding: "10dp 16dp"
  button-focused:
    backgroundColor: "{colors.focus-fill}"
    textColor: "{colors.focus-content}"
    typography: "{typography.label}"
    rounded: "{rounded.button}"
    padding: "10dp 16dp"
  navigation-item:
    backgroundColor: "transparent"
    rounded: "{rounded.button}"
    padding: "10dp 16dp"
  navigation-item-selected:
    backgroundColor: "{colors.navigation-selected}"
    rounded: "{rounded.button}"
    padding: "10dp 16dp"
  input:
    textColor: "{colors.text-primary}"
    typography: "{typography.input}"
    rounded: "{rounded.field}"
    padding: "14dp"
  pairing-code:
    textColor: "{colors.text-primary}"
    typography: "{typography.pairing-code}"
  poster:
    backgroundColor: "{colors.surface-variant}"
    rounded: "{rounded.card}"
    width: "130dp"
    height: "180dp"
  player-controls:
    backgroundColor: "rgba(0, 0, 0, 0.88)"
    textColor: "{colors.text-primary}"
    padding: "24dp"
  player-panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text-primary}"
    padding: "26dp"
    width: "360dp"
---

# Design System: LibreTV Android TV

## Overview

**Creative North Star: "大屏影院，遥控即达"**

这是已实施的原生 Android TV 界面记录。电视采用用户指定的 Netflix 式大图、侧栏与横向海报组织方式，同时保留 LibreTV 名称、用途和中文产品文字。深色环境让影片图像承担视觉主体；红色提供品牌识别，浅色焦点说明遥控器下一步将操作的对象。

此文档只约束 `android-tv` 原生表面，其角色为 Operate。结构与交互使用 Compose for TV 的 Material 组件和 Android 系统返回。它不覆盖根目录的 Web/PWA 视觉系统。下列 frontmatter 是当前实现的 token 记录；Android 长度保留 dp、文字保留 sp。继承项以锁定的 `androidx.tv:tv-material:1.0.1` 为准。

**Key Characteristics:**

- 深底、红色 LibreTV 品牌与高对比浅色焦点。
- 大图引导、固定左侧导航、横向影片行与原生全屏播放。
- 系统无衬线字体与分层文字，支持系统字号缩放。
- D-pad 可达、焦点与列表位置恢复、明确加载和重试反馈。

记录依据为 `MainActivity.kt`、`Playback.kt`、`README.md`、本地 TV Material 依赖与原生模拟器截图。最终独立原生设计审查 disposition 为 `ship`；有效界面截图为 `output/evidence/pair-final.png`、`playback-controls-final.png`、`discovery-fixed.png`、`font130.png`。未运行 Web detector。截图来自 Android TV API 34、1920×1080 模拟器。`playback-controls-final.png` 的测试视频实际为 1280×720 AVC；补充截图 `4k-real-live.png` 则展示真实河北卫视直播样本，播放器 HUD 为 3840×2160、`avc1.640033`、`c2.goldfish.h264.decoder`，该样本已在模拟器播放。补充图取自最后一次 debug，旧顶部“第1集”文字已在当前源码改为“直播”。这仅覆盖该真实直播样本，不代表 TCL T7K、HDR、硬件解码、其他目录条目或 60fps 已验收。

配对契约已统一为服务端八位字符、电视 4+4 单行分组；`pair-final.png` 已重拍真实 rc2 staging 八位挑战的当前界面。真实原生客户端经现有隧道连接东京 staging/MySQL，完成手机已登录会话批准配对与电视 365 天 TTL 验证；手机写入 3.000 秒进度后，原生续播并由手机同步回读到 10.025 秒。仅新增的临时验收设备已撤销，两条测试文档已 tombstone，其他设备和记录保留。脱敏证据为 `output/evidence/staging-native-acceptance.json`、`staging-home.png` 与 `staging-current.png`；这是实际 staging 账号/同步流程证据，与 TCL 物理验收分开。

rc2 补验还通过真实手机会话向第二个临时电视投送 `directUrl`，广告过滤清单返回 200 有效 HLS，媒体段维持原始绝对地址。真实《攻壳机动队4K》已在原生播放，`staging-rc2-4k.png` HUD 为 3840×2074、`avc1.640033`、`c2.goldfish.h264.decoder`，MySQL 回读进度 25.077 秒。该临时电视和两条文档也已定向清理，保留既有 browser 会话。播放出现过缓冲，不能据此宣称稳定 4K 吞吐或 TCL 实机帧率。

## Colors

调色以近黑和带轻微紫灰的中性色承托图像；红色集中表达 LibreTV 身份。

### Primary

- **LibreTV Red**（`primary`）：配对页与侧栏的 LibreTV 字标，以及 Material 主色角色。
- **On Primary**（`on-primary`）：主色上的白色内容角色。当前常规播放/配对动作沿用 TV Material 的中性按钮，并未把所有按钮涂红。

### Neutral

- **Cinema Background**（`background`）：非播放页面主背景，也用于大图渐变收边。
- **Navigation Ink**（`navigation`）：左侧导航底色；`navigation-selected` 表达当前目的地。
- **Surface / Panel**（`surface`、`panel`）：主题表面与播放器右侧菜单。
- **Surface Variant**（`surface-variant`）：继承 Material 的按钮和海报占位表面。
- **Primary / Secondary Text**（`text-primary`、`text-secondary`）：内容正文与说明。大图副文案、片源说明、输入占位分别使用 `text-hero`、`text-source`、`text-placeholder`。
- **Focus Fill / Content / Border**（`focus-fill`、`focus-content`、`focus-border`）：继承 Material 的焦点按钮填充、深色文字与卡片描边。它们是近白及浅灰色，并非所有焦点都使用纯白；输入框焦点才使用 `text-primary` 的纯白。
- **Feedback / Error**（`feedback`、`error-container`、`error-text`）：短暂操作回执、全局错误与播放器失败文字。`pairing-wait` 专用于等待手机确认。
- **Player Black**（`player`）：原生视频承载底色与半透明黑色控制遮罩。

**The Focus Ownership Rule.** 当前目的地和当前焦点是两种状态：目的地保留深灰底，实际焦点使用组件的浅色焦点状态，不能只靠红色区分。

## Typography

**Display Font:** Android 系统 `sans-serif`，由 TV Material 选择系统与语言回退。
**Body Font:** 同一系统字体；项目没有打包品牌字体。

配对字标与大图标题通过粗体建立识别，其余文字使用 Material 角色。中文实际字形由系统回退决定，不承诺每个电视固件都与模拟器完全一致。

### Hierarchy

- **Wordmark**（`wordmark`）：配对页 LibreTV 字标；侧栏字标使用 `title` 并加粗。
- **Display**（`display`）：详情片名；大图使用粗体变体 `display-hero`，最多两行。
- **Headline**（`headline`）：配对口号、搜索、收藏、4K 与设置页面标题。`headline-medium` 用于未配对提示，`headline-small` 用于播放器菜单标题。
- **Title**（`title`）：影片行标题与播放器顶部片名。
- **Body**（`body`）：主要说明和大图副标题。`body-medium` 用于单行海报片名；`body-small` 用于片源、配对链接和实际解码信息。
- **Label**（`label`）：TV Material labelLarge，供按钮和导航动作继承。
- **Input**（`input`）：输入框只显式覆盖字号；不为它杜撰单独的字重或行高 token。
- **Pairing Code**（`pairing-code`）：八位字符按 4+4 分组，继承 headlineLarge 的尺寸和行高，覆盖为等宽字体、半粗字重和字符间距；始终显示一行。

**The System Scale Rule.** 新原生文字继续使用 sp 和 Material 角色，不能用截图像素反推固定文字尺寸。130% 字号截图验证了第十九张海报焦点边框；它不是全部页面在所有字号下无裁切的承诺。

## Layout

采用横向电视画布，左侧导航与内容区并列。导航宽度（120dp），内部横向/纵向留白（14dp / 26dp），项目间距（14dp），导航本身可纵向滚动。内容占剩余宽度，未定义手机断点或 Web 响应式规则。

发现页由可纵向滚动的主列表容纳大图和横向海报行。大图高度（240dp），右侧图像占内容宽度的 65%，左下文案区留白（32dp），最大宽度（500dp）。横、纵渐变让图像向背景自然消退。海报行采用水平留白（32dp）、垂直留白（18dp）与卡间距（16dp），行前间距（16dp）；这些留白也容纳焦点放大。

海报图片框（130×180dp），外部文字列间距（8dp）。搜索结果以五张分组，集合页也以五张分组；集合页留白（32dp）、组间距（20dp）。详情页外边距（42dp）、左右间距（34dp），封面（210×310dp），每组六个选集按钮、按钮宽度（90dp）。

配对页为左右两列，水平/垂直外边距（64dp / 42dp），左列右侧间隔（48dp），右列宽（300dp），二维码框（176dp）且内边距（8dp）。二维码保持黑白，八位配对码按 4+4 分组以单行等宽文字呈现；服务端接受带空格或不带空格的完整八位字符。

播放器使用铺满画布的 Media3 PlayerView。顶部标题外边距（28dp）、内部留白（12dp）；底部控制层留白（24dp）、纵向间距（14dp）。动作行可水平滚动，额外保留（8dp）内边距承接焦点放大。右侧菜单宽（360dp）、内边距（26dp）、项目纵向间距（16dp）。

## Elevation & Depth

层次来自背景、导航底、组件表面及播放器遮罩，而非自定义阴影。当前 Button 和 Card 使用 TV Material 默认且无额外 glow。大图使用水平与垂直渐变；顶部播放标题黑色遮罩不透明度为 65%，底部为 88%，全局加载提示为 80%。不要为静态影片行新增悬浮投影。

**The Space for Focus Rule.** Button 与 Card 在焦点时按依赖默认放大至 1.1 倍。列表与控制行必须保留足够内边距，让放大和描边完整显示；不能为了塞入更多内容取消这部分留白。

## Shapes

字段使用轻圆角（`rounded.field`），海报卡和消息容器使用（`rounded.card`）。动作按钮继承 TV Material 的 CircleShape，即胶囊轮廓（`rounded.button`），其高度随文字和内边距变化。播放器信息遮罩与侧面板保持平直边缘，避免把每个区域都包装成独立圆角卡片。

## Components

### Buttons

当前按钮继承 TV Material：最小布局尺寸（58×40dp），内容水平/垂直内边距（16dp / 10dp），文字继承 `label`，默认使用中性色表面与内容透明度。焦点采用浅色实心填充、深色文字和 1.1 倍缩放；按下、禁用和禁用焦点状态继续交由 Material。红色是品牌主色，常规动作并未定义独立红底变体。

### Cards / Containers

海报使用 TV Material Card，图片采用裁切填充。默认无描边，焦点放大至 1.1 倍并出现（3dp）`focus-border` 描边，圆角沿用（`rounded.card`）。片名位于图片下方且最多一行；有片源时展示第二行来源，直链资源展示目录分辨率及直播标记。聚焦海报同步大图内容，确认键进入搜索/详情或播放。

### Inputs / Fields

原生单行 BasicTextField，最小高度（48dp），内边距（14dp），非焦点（1dp）`input-outline` 描边，焦点（2dp）纯白描边。服务器输入使用 Done，搜索输入使用 Search；IME 提交与遥控器动作指向同一功能。

### Navigation

左侧依次为发现、4K专区、搜索、继续看、我的片单、设置。当前页保留选中底色，焦点继承按钮浅色状态。返回其他栏目时先回发现；详情返回浏览。每个栏目保存滚动状态和最近海报焦点，返回时恢复。

### Pairing

首焦点落在生成/重新生成配对码动作。左侧服务器字段和操作保持一组，右侧展示二维码、八位码、配对链接与等待文字。配对码按 4+4 分组且最多一行，提示明确为“输入 8 位码”；链接最多三行，过期反馈要求重新生成。保留 LibreTV 中文产品说明，不把服务内部实现放进主操作文案。

### Player Controls

控制条默认显现，播放中且无菜单时在最后一次输入约七秒后隐藏。隐藏时确认/上下键显示控制条，左右键前后跳十秒；媒体播放/暂停键直接操作播放器。显示控制条时首焦点落在播放/暂停，菜单打开时落在关闭动作。

系统返回依次关闭菜单/换源候选、隐藏控制条，再离开播放并保存进度。右侧菜单承载选集、来源、音轨字幕、跳过标记与睡眠定时。保持正常播放画面为主，控制条和菜单是临时层。分辨率、codec 和 decoder 一行来自播放器实际选择，不能拿目录标签代替。

### Loading, Empty and Retry

发现行尾有下一页加载、失败重试、加载更多和结束状态。4K专区读取服务端目录，初次加载、错误/空目录与重新加载动作明确可见，不使用虚构节目填空。目录声称的分辨率与播放器实际解码信息分别呈现。全局错误为底部可关闭面板，短反馈在约四点五秒后消失。

## Do's and Don'ts

### Do:

- **Do** 保留 LibreTV 身份、深色背景、红色品牌和浅色遥控器焦点。
- **Do** 使用 Compose for TV Material、系统返回、sp 字体和现有焦点恢复模式。
- **Do** 为 1.1 倍焦点缩放及描边留出空间，并用原生截图检查。
- **Do** 保留加载、空态、错误与重试，让没有资源的情况也可操作。
- **Do** 使用播放器实际格式信息表达正在解码的分辨率、codec 和 decoder。

### Don't:

- **Don't** 把当前栏目选中状态当作遥控器焦点。
- **Don't** 把原生 dp/sp 换成截图像素，或从 Web 检测结果推断 TV 已验收。
- **Don't** 为未提供的片源、字幕或音轨虚构内容。
- **Don't** 用 4K 目录标签或模拟器 720p 播放证明 TCL、4K/HDR、硬件解码或 60fps 通过。

