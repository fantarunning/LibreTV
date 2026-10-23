---
name: LibreTV Web
description: 保留 LibreTV 深色青色身份的响应式网页影音系统。
colors:
  primary: "#00b8e6"
  primary-hover: "#33d6ff"
  on-primary: "#08131f"
  page: "#0b101a"
  surface: "#141c29"
  card: "#0d141f"
  chip: "#16202e"
  hover: "#1d2a3d"
  line: "#223045"
  content: "#e6f2ff"
  muted: "#8599b2"
  faint: "#7a8ca6"
  danger: "#ef4444"
  success: "#22c55e"
  warning: "#f59e0b"
  rating: "#fbbf24"
  light-primary: "#2563eb"
  light-primary-hover: "#1d4ed8"
  light-on-primary: "#ffffff"
  light-page: "#f6f7f9"
  light-surface: "#ffffff"
  light-chip: "#eef0f3"
  light-hover: "#e9ecf0"
  light-line: "#e0e3e8"
  light-content: "#1a1a1a"
  light-muted: "#5f6368"
  light-faint: "#6b7280"
typography:
  wordmark:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"
    fontSize: "48px"
    fontWeight: 700
    lineHeight: "48px"
    letterSpacing: "0em"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: "32px"
    letterSpacing: "0em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: "28px"
    letterSpacing: "0em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
    letterSpacing: "0em"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: "20px"
    letterSpacing: "0em"
  caption:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
    letterSpacing: "0em"
rounded:
  control: "6px"
  card: "8px"
  search: "12px"
  pill: "9999px"
spacing:
  micro: "4px"
  tight: "6px"
  small: "8px"
  grid-gap: "10px"
  control-x: "12px"
  gutter: "16px"
  group: "24px"
  section: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-ghost:
    backgroundColor: "{colors.chip}"
    textColor: "{colors.muted}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  input:
    backgroundColor: "{colors.chip}"
    textColor: "{colors.content}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  nav-link:
    textColor: "{colors.muted}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "6px 10px"
  nav-link-active:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.content}"
  filter-chip:
    backgroundColor: "{colors.chip}"
    textColor: "{colors.muted}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  filter-chip-active:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
  poster-card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.content}"
    rounded: "{rounded.card}"
---

# Design System: LibreTV Web

## Overview

**Creative North Star: "LibreTV 的深色片库"**

LibreTV 网页沿用深蓝黑背景、青色操作色与冷白文字，内容以搜索、海报和连续观看为中心。账户、配对与已核实片源使用安静的列表、分隔线和明确操作，不为设置任务增加大屏海报式包装。

这份文档从现有源码和已检查的账户截图提取，描述手机、平板和桌面网页的共同系统。Android TV 的红色大屏界面、遥控焦点与原生组件由 android-tv/DESIGN.md 单独规定；两端共享 LibreTV 身份和内容，不共享全部组件尺寸与布局。

**Key Characteristics:**

- 深蓝黑底、冷白层次和青色操作。
- 以真实影视内容为主体；操作页面使用列表和分隔。
- 紧凑控件、清晰状态和可恢复的加载错误。
- 同一语义颜色系统支持深色与浅色主题。

## Colors

配色以深蓝黑与青色为网页基准，浅色模式沿用同一角色关系；frontmatter 的默认值对应深色模式，light- 前缀记录实际浅色映射。运行时以 src/app/globals.css 的 --c-* 变量为依据。

### Primary

- **片库青色**（primary）：主要操作、当前集、链接和筛选选中态。
- **明亮青色**（primary-hover）：主操作悬停反馈。
- **深色按钮字**（on-primary）：保证青色实心底上的小字清楚可读。
- **浅色模式蓝色**（light-primary）：浅底下的链接与主操作；对应悬停色和白色按钮字同时切换。

### Neutral

- **深蓝黑画布**（page）：页面基础；深色 body 使用由 page 到 surface 的纵向固定渐变。
- **抬升的蓝黑面板**（surface）：顶部导航、抽屉、弹窗与剧集区域。
- **低亮海报底**（card）：内容卡片背景。
- **控件蓝黑**（chip）与**悬停蓝黑**（hover）：输入框、次要按钮和选中导航。
- **细线蓝黑**（line）：一像素边框与行分隔。
- **冷白正文**（content）、**蓝灰辅助字**（muted）与**蓝灰元数据**（faint）：建立文字层级；辅助信息保持可读，不额外降低透明度。
- light- 的 page、surface、chip、hover、line、content、muted、faint 为实际浅色模式替换值。

### States and Brand

- danger、success、warning 用于对应状态，配合文字说明；rating 用于评分。
- 现有 LibreTV 文字标识保留青色到粉色渐变；它是品牌标识的例外，不是普通正文与标题样式。

**The Semantic Color Rule.** 页面使用现有语义颜色变量；切换主题时整体更新。青色实心按钮在深色主题使用 on-primary 深色字，浅色主题使用白字。

## Typography

**Display Font / Body Font:** 系统无衬线字体栈，优先平台中文字体；准确栈见 typography 的 fontFamily。

**Character:** 网页文字直接、紧凑，中文内容与浏览器原生表单保持一致。字号和字重区分标题、动作、说明及时间等元数据，不增加第二套装饰字体。

### Hierarchy

- **Wordmark**：仅首页品牌名称；桌面使用 wordmark，手机为 (36px / 40px)。
- **Headline**：账户、配对与专区页面主标题，使用 headline。
- **Title**：内容区块标题，使用 title；列表内子标题按任务使用 (14–16px) 与中等字重。
- **Body**：主要说明与按钮文字，使用 body；较长说明使用现有宽松行高 (1.625)。
- **Label / Caption**：动作标签、日期、来源、评分与同步时间，使用 label / caption。
- 分辨率等对照数据使用 tabular-nums；常规界面不因技术信息改为等宽字体。

**The Content Before Chrome Rule.** 内容密度由任务决定：发现页容纳海报，账户与授权页保持清楚的标题、说明、列表和操作。

## Layout

网页采用流式宽度与居中最大宽度。首页和普通导航最大 (1152px)，播放页最大 (1280px)；账户最大 (672px)、配对最大 (448px)、4K列表最大 (896px)。常规侧边留白 (16px)，配对页 (20px)；窄屏不依赖固定正文宽度。

导航高 (56px)，品牌入口固定，文字导航保持完整，手机收紧项目间距。首页海报网格随断点从 3 列到 4、6、8 列，间距采用 grid-gap；长推荐按完整行虚拟化，保留底部加载、重试与分类结束状态。

播放页在大屏使用内容加 (300px) 剧集侧栏，窄屏堆叠；视频为 (16:9) 容器，附加控件可换行。对必须同时观看画面的片段标记，手机采用底部面板并限制高度。账户与4K片源列表将说明留在左侧，操作靠右；正文允许换行，长设备名截断，不把操作挤出屏幕。

## Elevation & Depth

整体采用色阶层次和细边框，账户与片源列表直接放在页面画布上。已有海报卡片在 hover 时使用轻微缩放 (1.03) 和柔和阴影；模态抽屉使用黑色半透明遮罩。顶部栏已有半透明 surface 与背景模糊，继续限定在其现有导航用途。

### Shadow Vocabulary

- **海报悬停**：Tailwind shadow-md 的现有柔和、向下阴影，用于海报交互反馈。
- **非模态侧栏**：现有 shadow-2xl，帮助仍可交互的背景与侧栏建立前后关系。
- 键盘 focus-visible 使用青色描边环，不作为静止装饰。

**The Tonal Layer Rule.** 静止界面主要依靠底色层次与细分隔线表达关系；浮层遮罩和交互态阴影用于明确状态。

## Shapes

控件使用 control 的轻圆角，海报与播放容器使用 card，搜索外框使用 search。分类筛选使用 pill；它表达小型选项，不作为整页容器形状。列表使用细水平分隔线；封面保持原有纵向比例与 object-fit 裁切。

## Components

### Buttons

主按钮明亮且直接；次按钮收敛。主按钮使用 primary 与 on-primary，次按钮使用 chip、muted 和 line。默认内边距采用 button 组件值；小按钮为 (4px 10px / 12px 字号)。hover 更新底色，focus-visible 显示 (2px) 青色半透明环，disabled 降低透明度并显示不可用光标。

### Chips

类别筛选使用 compact 文本与圆形端头；未选中为 chip 和 muted，选中为 primary 和 on-primary。电影／剧集切换放在共同背景内，保持当前选择明确。状态改变不只依赖 hover。

### Cards / Containers

海报卡片以 (2:3) 图像为主体，底部一行标题截断；评分位于图像右上。卡片使用 card 底色、line 细边框和 card 圆角。账户与片源条目是分隔列表，不套额外海报式卡片。

### Inputs / Fields

输入采用 chip、line 与 content，placeholder 使用 faint。label 始终可见；focus-visible 同时显示边框变化与焦点环。配对码输入大字居中、自动转大写；错误位于字段下方，提交中按钮说明当前动作。

### Navigation

导航由 LibreTV 标识、文字入口和统一 SVG 图标组成。文字入口使用 muted，当前页使用 hover 背景与 content；标签保持完整。图标动作有 aria-label，hover 提亮；手机压缩间距，不增加新的导航视觉体系。

### Account and Source Lists

设备条目先读名称，再读类型与到期时间；解除授权为独立行操作，并有确认反馈。同步区域展示状态、最近时间或可恢复错误。4K片源条目先读片名，再读实际宽高、编码、来源和核实日期；影片与直播分组，各自操作名称明确。

### Player Controls

ArtPlayer 保留播放、进度、倍速、比例、网页／原生全屏等已有能力。附加睡眠、轨道、字幕与电视播放放在视频下方，按可用媒体能力显示。手机隐藏控制栏内低频截图、画中画与音量等项目，为主要播放动作留足空间。键盘操作不接管正在编辑的原生表单控件。

## Do's and Don'ts

### Do:

- **Do** 使用现有语义颜色与原生中文系统字体，保留 LibreTV 的网页身份。
- **Do** 让设备名称、播放状态、分辨率和动作标签优先可读；窄屏时允许辅助说明换行。
- **Do** 为加载、错误、空列表、禁用和键盘焦点保留明确反馈。
- **Do** 将实际视频尺寸写完整；宽银幕画幅按已核实尺寸展示。
- **Do** 在手机、平板和桌面一起检查新增页面；为长列表保留加载更多和失败重试。

### Don't:

- **Don't** 将 Android TV 的红色大屏布局复制到网页账户和配对页面。
- **Don't** 将品牌文字已有的青粉渐变扩散为普通标题、按钮或说明文字。
- **Don't** 用额外卡片包裹每一行设备或片源；沿用列表分隔。
- **Don't** 只依赖颜色解释同步、失败或授权状态。
- **Don't** 把片源标题中的 4K、HDR 或音轨名称当成已验证的实际播放能力。

提取依据：src/app/globals.css、tailwind.config.ts、src/components/header.tsx、video-card.tsx、drawer.tsx、src/app/account/page.tsx、account/tv/page.tsx、4k/page.tsx 与 watch/page.tsx，以及账户、配对、4K列表、播放器和遥控抽屉截图。本文描述视觉系统，不充当公共部署或真机验收报告。格式采用 [DESIGN.md 规范](https://raw.githubusercontent.com/google-labs-code/design.md/main/docs/spec.md)。

