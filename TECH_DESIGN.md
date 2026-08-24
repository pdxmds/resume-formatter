# 技术设计｜本地 Markdown 简历排版器

文档版本：v1.1
文档状态：公开版本持续维护
关联文档：PRD｜本地 Markdown 简历排版器 v1.0
更新时间：2026-08-24
产品名称：简历排版器

## v1.1 实现覆盖说明

Schema v2 允许任意 Markdown `## 标题` 解析为 `custom` 板块。自定义板块使用 `blocks` 按顺序保存 `text`、`list` 和 `entry` 内容；标题只负责显示，不决定内容结构。导入器继续接受 Schema v1 四种预置栏目，新建或重新导出的自定义板块使用 Schema v2。本节覆盖后文中“未知栏目必须拒绝”和“不支持新建自定义栏目”的 v1.0 限制。

---

## 一、技术目标

开发一个本地运行的 Markdown 简历排版器，实现以下完整链路：

```text
符合 Schema v1 的 Markdown
        ↓
解析并校验
        ↓
生成结构化 Resume State
        ↓
渲染固定单页 A4 简历
        ↓
网页内少量编辑
        ↓
另存为独立 HTML
        ↓
通过 Chrome 导出 PDF
```

最终交付物为：

```text
dist/resume-formatter.html
```

该文件必须：

* 可以双击打开；
* 可以断网运行；
* 不依赖外部服务器；
* 不依赖 CDN；
* 不依赖在线字体；
* 可以独立导入 Markdown；
* 可以保存当前简历状态；
* 可以调用浏览器打印；
* 移动、复制或重命名后仍能使用。

---

## 二、核心技术决策

### 2.1 使用原生 Web 技术

第一版使用：

* HTML；
* CSS；
* Vanilla JavaScript；
* Browser File API；
* Blob API；
* FileReader；
* localStorage；
* window.print；
* ResizeObserver；
* Pointer Events。

不使用：

* React；
* Vue；
* Electron；
* 本地服务器；
* 数据库；
* Markdown 第三方解析器；
* YAML 第三方解析器；
* PDF 生成库；
* 在线字体或其他运行时依赖。

原因是第一版结构固定、交互规模有限，使用框架不会显著降低复杂度，反而会增加单文件打包和离线运行成本。

### 2.2 源码可以拆分，最终产物必须为单文件

开发阶段允许采用模块化目录。

```text
resume-formatter/
├── src/
│   ├── index.template.html
│   ├── styles/
│   │   ├── app.css
│   │   ├── resume.css
│   │   └── print.css
│   └── js/
│       ├── app.js
│       ├── state.js
│       ├── parser.js
│       ├── validator.js
│       ├── renderer.js
│       ├── editor.js
│       ├── persistence.js
│       ├── exporter.js
│       ├── overflow.js
│       ├── photo.js
│       └── utils.js
├── fixtures/
│   ├── valid/
│   └── invalid/
├── tests/
├── scripts/
│   └── build.mjs
├── dist/
│   └── resume-formatter.html
└── README.md
```

构建脚本使用 Node.js 原生模块完成以下工作：

1. 读取 HTML 模板；
2. 合并 CSS；
3. 合并 JavaScript；
4. 将 CSS 和 JavaScript 内嵌进 HTML；
5. 输出独立的 `dist/resume-formatter.html`。

构建阶段可以使用 Node.js，但最终 HTML 运行时不得依赖 Node.js。

### 2.3 采用单向状态驱动

系统的内容真源是 `Resume State`，不是当前页面 DOM。

```text
Markdown
   ↓ parse
Resume State
   ↓ render
DOM
```

用户进行编辑时：

```text
用户操作
   ↓
更新 Resume State
   ↓
局部或完整重新渲染
   ↓
自动保存草稿
```

不得把浏览器自动生成的 `contenteditable` DOM 结构作为长期数据直接保存。

---

## 三、数据模型

### 3.1 Resume State

建议使用以下结构：

```javascript
{
  appVersion: "1.0.0",
  schemaVersion: 1,

  documentId: "uuid",
  resumeName: "示例科技-产品经理",

  source: {
    fileName: "示例科技-产品经理.md",
    importedAt: "2026-08-01T00:00:00.000Z",
    rawMarkdownHash: ""
  },

  profile: {
    name: "示例用户",
    headline: "AI 产品经理",
    location: "上海",
    phone: "180xxxxxxxx",
    email: "example@example.com",
    website: "",
    portfolio: "",
    github: ""
  },

  sections: [
    {
      id: "section-uuid",
      type: "education",
      title: "教育经历",
      entries: [
        {
          id: "entry-uuid",
          name: "示例大学",
          role: "信息管理｜硕士",
          date: "2024.09–2027.06",
          location: "上海",
          bullets: [
            {
              id: "bullet-uuid",
              content: [
                {
                  type: "text",
                  value: "主修产品与数据分析"
                }
              ]
            }
          ]
        }
      ]
    }
  ],

  photo: {
    dataUrl: "",
    mimeType: "",
    originalWidth: 0,
    originalHeight: 0,
    scale: 1,
    offsetX: 0,
    offsetY: 0
  },

  importSnapshot: null,

  metadata: {
    createdAt: "",
    updatedAt: "",
    lastSavedAt: ""
  }
}
```

### 3.2 ID 规则

以下对象必须具有稳定 ID：

* 文档；
* 栏目；
* 经历条目；
* Bullet。

ID 用于：

* 网页编辑定位；
* 删除和增加内容；
* 局部渲染；
* 草稿恢复；
* 错误定位。

第一版可以使用：

```javascript
crypto.randomUUID()
```

Chrome 不支持时提供时间戳与随机数组合的降级方案。

### 3.3 导入快照

每次 Markdown 成功导入后，需要保存一份深拷贝：

```javascript
state.importSnapshot = structuredClone(currentResumeContent)
```

"恢复导入内容"只恢复以下内容：

* profile；
* sections；
* resumeName；
* 导入时的照片状态，若产品决定导入后照片保持不变，则不恢复照片。

第一版建议：

> 恢复导入内容只恢复文字和栏目结构，不清除当前证件照。

这样可以避免用户重新上传照片。界面提示需要明确说明这一规则。

---

## 四、Markdown 解析设计

### 4.1 解析流程

```text
读取文件
  ↓
统一换行符
  ↓
提取 Frontmatter
  ↓
解析 Frontmatter
  ↓
扫描正文行
  ↓
构建中间语法树
  ↓
执行 Schema 校验
  ↓
生成 Resume State
```

解析器必须同时保留行号，以便错误提示能够指出具体位置。

### 4.2 Frontmatter 规则

只支持：

```yaml
key: value
```

具体规则：

* 文件必须以 `---` 开始；
* Frontmatter 必须由第二个独立的 `---` 结束；
* 每一行最多解析第一个冒号；
* Key 去除首尾空格；
* Value 去除首尾空格；
* Key 区分大小写；
* 空行允许；
* 重复字段报错；
* 缺少结束标记报错；
* 不支持数组；
* 不支持嵌套对象；
* 不支持多行值；
* 不自动推断数字、布尔值和日期类型；
* 所有值先作为字符串处理；
* `schema_version` 单独转换为整数并校验。

例如：

```yaml
website: https://example.com/profile
```

应正确解析为：

```javascript
{
  website: "https://example.com/profile"
}
```

不能因为 URL 中存在冒号而截断。

### 4.3 正文语法

第一版识别：

```text
## section
### entry
role: value
date: value
location: value
- bullet
```

栏目仅允许：

```text
education
experience
projects
skills
```

解析器不得自动把以下名称识别为合法栏目：

```text
work
internship
project
skill
教育经历
工作经历
```

遇到未知栏目必须报告。

### 4.4 Skills 特殊结构

`skills` 栏目不包含 `### entry`，直接包含 Bullet：

```markdown
## skills

- 产品：用户研究、策略设计、A/B 实验
- AI：Prompt、Context、Tool、Evals
```

内部状态可以统一转换为一个特殊条目：

```javascript
{
  id: "...",
  name: "",
  role: "",
  date: "",
  location: "",
  bullets: []
}
```

但渲染层不得显示空条目标题。

### 4.5 加粗语法

第一版只支持行内：

```markdown
**文字**
```

内部不得直接保存 HTML，应保存为 token：

```javascript
[
  { type: "text", value: "负责" },
  { type: "strong", value: "217 个 Bad Case" },
  { type: "text", value: "的分类与回归验证" }
]
```

禁止支持：

* 嵌套加粗；
* 跨行加粗；
* HTML 标签；
* Markdown 链接；
* 图片；
* 斜体；
* 删除线。

无法正确闭合的 `**` 作为 Warning，不自动猜测。

### 4.6 不可信文本处理

所有 Markdown 内容必须按照纯文本处理。

禁止通过以下方式渲染：

```javascript
element.innerHTML = markdownValue
```

普通文本使用：

```javascript
textContent
```

加粗内容通过显式创建 `<strong>` 节点实现。

导入的 `<script>`、`<img>`、`<style>` 等文本必须作为普通文字显示或触发不支持语法警告，不得执行。

---

## 五、校验设计

### 5.1 校验结果结构

```javascript
{
  level: "error" | "warning" | "info",
  code: "MISSING_REQUIRED_FIELD",
  message: "experience 栏目下的"示例科技｜产品部"缺少 date 字段。",
  line: 28,
  section: "experience",
  entry: "示例科技｜产品部",
  field: "date",
  suggestion: "请在该条目中增加 date: 时间范围。"
}
```

### 5.2 Error

以下问题阻止导入：

* 文件不是 `.md`；
* Frontmatter 缺失；
* Frontmatter 无法闭合；
* `schema_version` 缺失；
* `schema_version` 不为 1；
* 必填个人字段缺失；
* 重复 Frontmatter 字段；
* 未知栏目；
* 栏目重复；
* `education` 条目缺少名称、role 或 date；
* `experience` 条目缺少名称、role 或 date；
* 条目字段重复；
* 字段出现在任何条目或栏目之外；
* 文件中包含不支持的一级标题结构，导致正文无法解析。

### 5.3 Warning

以下问题允许确认后继续导入：

* `projects` 条目缺少 role；
* `projects` 条目缺少 date；
* 经历没有 Bullet；
* skills 为空；
* 未闭合的加粗标记；
* 不支持的普通段落；
* 空选填字段；
* 联系方式格式看起来异常；
* 相同条目名称重复；
* Bullet 为空；
* 导入内容可能超过 A4。

### 5.4 Info

导入成功后展示：

```text
已导入：示例科技-产品经理.md
识别到：2 条教育经历、4 条工作经历、2 个项目、5 条技能
存在：0 个错误、2 个警告
```

系统不得静默删除任何无法识别的内容。

---

## 六、渲染设计

### 6.1 页面结构

```html
<body>
  <div id="app">
    <aside id="toolbar"></aside>

    <main id="workspace">
      <section id="resume-page">
        <header id="resume-header"></header>
        <div id="resume-sections"></div>
      </section>
    </main>

    <div id="status-region"></div>
    <div id="dialog-root"></div>
  </div>
</body>
```

### 6.2 A4 页面

```css
#resume-page {
  width: 210mm;
  height: 297mm;
  box-sizing: border-box;
  overflow: hidden;
}
```

页面内部再定义内容安全区：

```css
.resume-content {
  height: 100%;
  padding: var(--page-padding-top)
           var(--page-padding-right)
           var(--page-padding-bottom)
           var(--page-padding-left);
  box-sizing: border-box;
}
```

所有内容必须处于正常文档流中。

除证件照外，禁止通过大量绝对定位实现经历排版。

### 6.3 模板稳定性规则

* 公司或学校名称位于左侧；
* role 位于名称下方或同一信息组；
* date 位于右侧固定区域；
* location 作为次要信息；
* Bullet 使用统一缩进；
* 栏目标题高度固定；
* 长文本允许自然换行；
* date 区域不得挤压到正文外；
* 不使用固定内容高度截断单条经历；
* 不允许内容覆盖；
* 不允许通过整体页面缩放解决溢出。

### 6.4 字体

使用系统字体栈：

```css
font-family:
  -apple-system,
  BlinkMacSystemFont,
  "Segoe UI",
  "PingFang SC",
  "Hiragino Sans GB",
  "Microsoft YaHei",
  Arial,
  sans-serif;
```

不得引用在线字体文件。

---

## 七、网页内编辑设计

### 7.1 编辑元素绑定

每个可编辑元素包含：

```html
data-action="edit-field"
data-entry-id="..."
data-field="role"
```

或：

```html
data-action="edit-profile"
data-field="name"
```

使用事件委托，不为每个元素单独绑定监听器。

### 7.2 contenteditable 约束

Chrome 中优先使用：

```html
contenteditable="plaintext-only"
```

标量字段禁止换行，包括：

* 姓名；
* headline；
* phone；
* email；
* 公司名称；
* role；
* date；
* location。

用户按 Enter 时：

* 阻止默认行为；
* 保存当前内容；
* 退出编辑状态。

Bullet 第一版同样按单段纯文本处理，不允许在一个 Bullet 内创建多个段落。

### 7.3 状态同步

推荐触发时机：

* `input`：更新内存状态并触发溢出检测；
* `blur`：执行清洗、校验和自动保存；
* `keydown Enter`：提交标量字段；
* `paste`：强制粘贴纯文本。

不得保存以下 DOM：

* `<div>`；
* `<br>`；
* 浏览器插入的 `<span>`；
* 复制内容附带的样式。

### 7.4 空字段

编辑状态下显示浅色占位符，但占位符不能进入状态。

可以使用：

```css
[data-empty="true"]::before {
  content: attr(data-placeholder);
}
```

打印时隐藏：

```css
@media print {
  [data-empty="true"]::before {
    display: none;
  }
}
```

### 7.5 增删结构

允许：

* 在已有栏目中增加新条目；
* 删除条目；
* 增加 Bullet；
* 删除 Bullet。

不允许：

* 新建自定义栏目；
* 修改栏目类型；
* 拖动栏目排序；
* 拖动条目排序；
* 创建嵌套 Bullet；
* 使用富文本工具栏。

删除整条经历必须二次确认。

删除 Bullet 不需要弹窗，但必须支持立即撤销提示或在短时间内提供"撤销"操作。M0 阶段可以暂不实现撤销，V1.0 再增加。

---

## 八、草稿与存档设计

### 8.1 localStorage Key

```text
resume-formatter:draft:{documentId}
```

另设索引：

```text
resume-formatter:last-document
```

草稿内容包括完整 Resume State。

### 8.2 自动保存

触发条件：

* 用户编辑后延迟 500–800ms；
* 新增或删除条目；
* 新增或删除 Bullet；
* 照片调整；
* 成功导入 Markdown。

采用 debounce，避免每次按键立即写入 localStorage。

状态栏：

```text
正在保存
已保存
存在未保存修改
保存失败
```

自动保存失败时不得阻塞网页继续编辑，但必须明确提示。

### 8.3 启动恢复规则

打开 HTML 时按以下顺序处理：

```text
读取内嵌 Resume State
        ↓
检查相同 documentId 的浏览器草稿
        ↓
比较 updatedAt
        ↓
如草稿更新，询问是否恢复
```

不得在用户不知情的情况下直接用浏览器草稿覆盖 HTML 中的正式内容。

### 8.4 内嵌状态

HTML 中保留：

```html
<script id="embedded-resume-state" type="application/json">
{
  "...": "..."
}
</script>
```

序列化 JSON 时必须转义：

```text
<
>
&
U+2028
U+2029
```

尤其需要防止用户文本中出现：

```text
</script>
```

导致脚本标签提前闭合。

---

## 九、另存为 HTML

### 9.1 保存流程

```text
用户点击"另存为 HTML"
        ↓
校验版本名称
        ↓
刷新当前 Resume State
        ↓
克隆完整 document
        ↓
将最新状态写入克隆文档
        ↓
清理临时 UI 状态
        ↓
序列化完整 HTML
        ↓
Blob 下载
```

### 9.2 清理内容

导出前必须移除或重置：

* 当前焦点；
* 选中文本；
* 编辑边框；
* 打开的弹窗；
* Toast；
* 拖动状态；
* 临时错误高亮；
* 状态栏中的"正在保存"；
* 文件 input 中的本地路径；
* 页面滚动位置相关临时属性。

应用本身的工具栏、导入功能和编辑能力必须保留。

### 9.3 副本语义

点击"另存为 HTML"时提供选项：

```text
作为当前文档存档
另存为新副本
```

第一版为降低复杂度，可以统一视为"新副本"：

* 生成新的 `documentId`；
* 保留 `parentDocumentId` 作为可选元数据；
* 下载新文件；
* 当前页面是否切换到新 `documentId` 需要明确。

V1.0 建议采用：

> 下载成功后，当前页面继续保持原 documentId；用户重新打开新 HTML 后，它才作为独立文档运行。

这样可以避免一次下载操作意外改变当前草稿归属。

---

## 十、证件照设计

### 10.1 数据处理

上传后：

1. 校验 MIME 类型；
2. 读取为 Data URL；
3. 使用 Canvas 缩小图片；
4. 限制最大边长；
5. 转为 JPEG 或保留支持的格式；
6. 将压缩结果存入 State。

建议限制：

```text
支持：JPEG、PNG、WebP
原文件最大：10 MB
压缩后目标：不超过约 500 KB
最大边长：1600 px
```

GIF 不保留动画，可以拒绝导入。

SVG 第一版不支持，避免嵌入脚本等安全问题。

### 10.2 裁切模型

照片容器固定，图片通过：

```css
transform:
  translate(var(--offset-x), var(--offset-y))
  scale(var(--scale));
```

照片位置只保存在：

```javascript
photo.scale
photo.offsetX
photo.offsetY
```

拖动使用 Pointer Events，并限制照片不能完全离开容器。

### 10.3 不影响布局

照片容器必须具有固定尺寸。

上传、更换、删除和缩放照片不得改变 Header 高度和主体内容起点。

---

## 十一、A4 溢出检测

### 11.1 基础检测

页面内部设置：

```html
<div id="resume-content">
  ...
</div>
```

检测：

```javascript
const overflow =
  resumeContent.scrollHeight > resumeContent.clientHeight + tolerance;
```

建议容差：

```text
1–2 CSS px
```

避免小数像素误报。

### 11.2 检测时机

以下事件后重新检测：

* Markdown 导入；
* 字段编辑；
* Bullet 增删；
* 条目增删；
* 照片变化；
* 浏览器 resize；
* 字体加载完成；
* HTML 草稿恢复。

使用 `ResizeObserver` 与 `requestAnimationFrame` 合并检测。

### 11.3 溢出定位

第一版按栏目检测：

1. 获得内容安全区底部坐标；
2. 遍历 section；
3. 判断 section 的底部是否超过安全区；
4. 标记第一个溢出的栏目；
5. 计算大致超出高度。

展示：

```text
当前内容超出单页 A4 约 12 mm。
首次发生溢出的栏目：项目经历。
```

"占用空间最多的经历"可通过计算每个 entry 的 `getBoundingClientRect().height` 得到，作为 P2 信息，不参与自动处理。

### 11.4 不允许的自动行为

系统不得自动：

* 缩小整页；
* 缩小所有字号；
* 修改行距；
* 删除 Bullet；
* 改写内容；
* 隐藏溢出内容；
* 将内容拆到第二页后仍提示正常。

---

## 十二、PDF 导出

### 12.1 打印样式

```css
@page {
  size: A4 portrait;
  margin: 0;
}

@media print {
  html,
  body {
    margin: 0;
    padding: 0;
  }

  #toolbar,
  #status-region,
  #dialog-root,
  .editor-control {
    display: none !important;
  }

  #resume-page {
    width: 210mm;
    height: 297mm;
    margin: 0;
    box-shadow: none;
  }

  * {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
```

### 12.2 打印前检查

检查：

* A4 是否溢出；
* 姓名是否为空；
* headline 是否为空；
* phone 是否为空；
* email 是否为空；
* 是否存在占位符；
* 是否存在未处理的导入 Warning；
* 是否存在尚未完成的编辑状态；
* 草稿是否保存成功。

存在问题时展示清单，用户可以：

```text
返回修改
仍然打印
```

存在解析 Error 时不允许打印。

### 12.3 产品承诺边界

只有在以下条件同时满足时，才验收为单页 PDF：

* 页面状态显示"A4 排版正常"；
* 使用 Chrome；
* 纸张选择 A4；
* 缩放为 100%；
* 关闭页眉页脚；
* 开启背景图形；
* 浏览器未启用特殊缩放或无障碍字体放大。

---

## 十三、应用状态机

应用主要状态：

```text
EMPTY
IMPORTING
IMPORT_ERROR
IMPORTED
EDITING
DIRTY
SAVING
SAVED
EXPORTING_HTML
PRINT_CHECK
PRINTING
```

关键规则：

* 导入失败时保留当前简历，不清空现有状态；
* 导入新的 Markdown 前检查是否存在未另存的修改；
* 导入确认后才覆盖当前 Resume State；
* 保存 HTML 失败时不修改当前 State；
* 打印操作不修改 Resume State；
* 恢复导入内容后立即标记为 DIRTY，并触发自动保存。

---

## 十四、异常处理

必须覆盖：

* 用户取消文件选择；
* Markdown 文件为空；
* 文件读取失败；
* Frontmatter 无法解析；
* schema_version 不支持；
* localStorage 满；
* localStorage 被禁用；
* Blob 下载失败；
* 图片格式不支持；
* 图片文件过大；
* Canvas 压缩失败；
* 图片解码失败；
* 浏览器不支持关键 API；
* 导出的 HTML 内嵌状态损坏。

出现异常时：

* 不破坏当前简历；
* 不静默失败；
* 提供具体错误；
* 提供下一步操作建议；
* 在控制台保留技术错误，界面不直接显示完整堆栈。

---

## 十五、测试设计

### 15.1 测试夹具

至少准备以下 Markdown：

```text
fixtures/valid/
├── minimal.md
├── full.md
├── bold-text.md
├── long-content.md
├── url-with-colon.md
└── chinese-english-mixed.md
```

```text
fixtures/invalid/
├── missing-frontmatter.md
├── unclosed-frontmatter.md
├── missing-required-field.md
├── duplicate-field.md
├── unknown-section.md
├── missing-role.md
├── missing-date.md
├── invalid-bold.md
├── unsupported-html.md
└── nested-list.md
```

### 15.2 单元测试

重点测试纯函数：

* Frontmatter 解析；
* 正文扫描；
* Section 解析；
* Entry 解析；
* Bullet 加粗 token；
* Schema 校验；
* 文件名清洗；
* JSON 安全序列化；
* State migration；
* 溢出计算辅助函数。

### 15.3 集成测试

验证：

1. 导入真实 Markdown；
2. State 内容正确；
3. DOM 栏目顺序正确；
4. 编辑字段后 State 更新；
5. 增删 Bullet 后 State 更新；
6. 自动保存后刷新可恢复；
7. 另存 HTML 后重新打开；
8. 重新打开后内容和照片一致；
9. 再次导入 Markdown 正常；
10. 重新另存 HTML 正常。

### 15.4 人工打印测试

至少测试：

* macOS Chrome；
* Windows Chrome；
* macOS Edge 或 Windows Edge；
* 无照片；
* 有照片；
* 接近满页；
* 明显溢出；
* 中英文混排；
* 长公司名称；
* 长项目名称；
* URL 和邮箱。

每次打印验收记录：

```text
浏览器版本
操作系统
纸张设置
缩放设置
PDF 页数
是否截断
是否横向溢出
背景和分割线是否正常
照片位置是否一致
```

---

## 十六、开发里程碑

### M0｜核心纵向链路

目标：

> 证明 Markdown 可以稳定转成可独立保存和重新打开的单页 A4 HTML。

包含：

* Schema v1 解析；
* 具体错误校验；
* Resume State；
* 固定 A4 模板；
* 溢出检测；
* 内嵌 State；
* 另存 HTML；
* 重新打开 HTML；
* window.print；
* 基础打印样式。

M0 暂不包含：

* contenteditable 全量编辑；
* 条目增删；
* 照片；
* localStorage 草稿；
* 恢复导入内容；
* 完整打印前检查。

M0 验收：

1. 可以导入一份真实简历；
2. 页面栏目和内容正确；
3. 可以检测是否超过 A4；
4. 可以另存为 HTML；
5. 新 HTML 可独立打开；
6. 新 HTML 可以再次导入 Markdown；
7. 新 HTML 可以再次另存；
8. 页面正常时可以输出单页 A4 PDF。

### V0.2｜基础编辑

包含：

* 标量字段编辑；
* Bullet 编辑；
* Bullet 增删；
* 条目增删；
* 占位符；
* 编辑后重新渲染；
* 编辑后的 HTML 存档。

验收：

* 编辑不产生异常 DOM；
* 编辑结果进入 Resume State；
* 另存后结果完整保留；
* 打印时编辑提示全部隐藏。

### V0.3｜照片

包含：

* 上传；
* 压缩；
* 更换；
* 删除；
* 拖动；
* 缩放；
* 恢复默认；
* HTML 内嵌；
* PDF 保留裁切结果。

### V1.0｜正式投入使用

包含：

* localStorage 自动保存；
* 草稿恢复确认；
* 恢复导入内容；
* 打印前检查；
* 更完整状态提示；
* 真实简历回归测试；
* Chrome 跨设备测试；
* README 使用说明。

---

## 十七、开发任务拆解

### T01｜建立工程骨架

产出：

* 源码目录；
* HTML 模板；
* CSS 和 JS 模块；
* 无依赖构建脚本；
* 单文件 dist 输出。

验收：

* 执行构建后生成 `dist/resume-formatter.html`；
* 断网双击可以打开；
* 控制台无错误。

依赖：无。

### T02｜定义 Resume State

产出：

* State 默认值；
* ID 生成；
* 深拷贝；
* State 校验；
* 内嵌 JSON 读取与写入。

验收：

* 空状态可以渲染；
* 内嵌状态可以恢复；
* 损坏状态有具体提示。

依赖：T01。

### T03｜实现 Markdown Parser

产出：

* Frontmatter 解析；
* 正文行扫描；
* Section 和 Entry 解析；
* Bullet 与加粗 token 解析；
* 行号保留。

验收：

* 所有 valid fixtures 正确解析；
* Parser 不执行任何 HTML；
* URL 中的冒号不会被错误截断。

依赖：T02。

### T04｜实现 Validator

产出：

* Error、Warning、Info；
* 字段和栏目规则；
* 错误定位；
* 导入摘要。

验收：

* 所有 invalid fixtures 返回预期错误；
* Error 阻止导入；
* Warning 允许确认后导入；
* 当前简历在导入失败后保持不变。

依赖：T03。

### T05｜实现固定 A4 模板

产出：

* Header；
* 联系方式；
* 教育经历；
* 工作经历；
* 项目经历；
* 技能；
* A4 CSS；
* 打印 CSS。

验收：

* 使用真实简历正确渲染；
* 栏目顺序与 Markdown 一致；
* 长文字自然换行；
* 不存在内容覆盖。

依赖：T02、T03。

### T06｜实现溢出检测

产出：

* 实时检测；
* 栏目定位；
* 超出高度估算；
* 状态栏提示。

验收：

* 正常内容不误报；
* 超长内容可以稳定检测；
* 编辑或 resize 后重新计算。

依赖：T05。

### T07｜实现另存 HTML

产出：

* 文件名输入；
* 文件名清洗；
* State 注入；
* DOM 临时状态清理；
* Blob 下载；
* 独立 HTML 恢复。

验收：

* 保存的 HTML 可独立打开；
* 内容和栏目完整；
* 可以再次导入；
* 可以再次另存；
* 不依赖原 Markdown 文件。

依赖：T02、T05。

### T08｜实现 PDF 导出

产出：

* 打印样式；
* 基础打印检查；
* `window.print()`；
* 推荐打印设置说明。

验收：

* A4 正常状态下输出单页；
* 工具栏不出现在 PDF；
* 没有横向滚动；
* 没有文字截断。

依赖：T05、T06。

完成 T01–T08 后达到 M0。

### T09｜实现文字编辑

产出：

* contenteditable；
* 纯文本粘贴；
* 标量字段禁止换行；
* State 同步；
* 基础字段校验。

依赖：T05。

### T10｜实现结构编辑

产出：

* Bullet 增删；
* 条目增删；
* 删除确认；
* 空字段占位；
* 重新渲染。

依赖：T09。

### T11｜实现照片功能

产出：

* 图片校验；
* Canvas 压缩；
* Data URL；
* Pointer 拖动；
* 缩放；
* 删除和恢复默认；
* State 同步。

依赖：T05、T07。

### T12｜实现浏览器草稿

产出：

* documentId；
* debounce 保存；
* 状态栏；
* 更新版本比较；
* 恢复确认。

依赖：T02、T09、T10、T11。

### T13｜实现恢复导入内容

产出：

* importSnapshot；
* 二次确认；
* 恢复逻辑；
* 保存状态更新。

依赖：T03、T12。

### T14｜实现完整打印前检查

产出：

* 必填字段检查；
* 溢出检查；
* 占位符检查；
* 未处理 Warning；
* 未保存状态；
* 返回修改或仍然打印。

依赖：T06、T09、T12。

### T15｜真实简历回归

至少导入 3–5 份不同岗位 Markdown，验证：

* 内容不丢失；
* 栏目不错位；
* HTML 可重新打开；
* 照片不丢失；
* PDF 不失控；
* 版本之间样式一致。

依赖：全部任务。

---

## 十八、代码质量要求

* 核心函数使用 JSDoc 标注输入输出；
* Parser 和 Validator 尽量写成纯函数；
* UI 层不得承担 Markdown 解析职责；
* 不使用全局可变变量存储多个状态副本；
* 不直接拼接用户输入到 `innerHTML`；
* 所有按钮必须有明确状态；
* 所有不可逆操作必须确认；
* 所有异常必须保留当前简历；
* 每个模块只负责一个核心职责；
* 不提前实现 Schema v2；
* 不为了未来模板系统抽象复杂插件架构。

---

## 十九、第一阶段禁止事项

在 M0 完成前不得开发：

* 多模板系统；
* AI 内容修改；
* JD 分析；
* Markdown 回写；
* 云端同步；
* 编辑历史；
* 版本对比；
* 拖拽栏目排序；
* 自动压缩到一页；
* 独立 PDF 引擎；
* Electron 桌面应用；
* 通用 Markdown 兼容；
* 自定义 CSS 编辑器。

任何新需求先记录到 Backlog，不得中断 M0 纵向链路。

---

## 二十、完成定义

V1.0 只有同时满足以下条件才算完成：

1. `dist/resume-formatter.html` 可以断网双击运行；
2. 可以导入符合 Schema v1 的真实 Markdown；
3. 错误可以定位到具体栏目、条目、字段或行号；
4. 解析结果生成统一 Resume State；
5. 页面使用固定 A4 模板渲染；
6. 用户可以完成少量文字和结构修改；
7. 证件照可以上传、调整并嵌入；
8. 浏览器刷新后可以选择恢复草稿；
9. 可以恢复最近一次导入的文字内容；
10. 可以检测 A4 溢出；
11. 可以另存为独立 HTML；
12. 新 HTML 可以继续编辑、导入、另存和打印；
13. 页面状态正常时可以导出单页 A4 PDF；
14. 连续处理 3–5 份真实简历不出现数据丢失；
15. PDF 导出后无需进入 Word 修复排版。

---

## 二十一、Codex 执行指令

请基于《PRD｜本地 Markdown 简历排版器》和本文档开发 Resume Formatter。

执行规则：

1. 严格按照 T01 → T08 的顺序先完成 M0；
2. 不得提前开发照片、自动保存和高级编辑；
3. 每完成一个任务，执行对应验收；
4. 不得通过降低验收标准绕过问题；
5. 不得引入前端框架或运行时网络依赖；
6. 不得将 DOM 作为简历长期内容真源；
7. 不得使用 `innerHTML` 直接渲染用户导入内容；
8. 不得为了兼容任意 Markdown 扩大 Schema；
9. 发现 PRD 与技术设计冲突时暂停该项实现并明确报告；
10. 每个里程碑完成后输出：

* 已完成内容；
* 文件变更；
* 自动测试结果；
* 人工验收步骤；
* 尚未完成项；
* 当前已知风险。

首先执行 T01：建立工程骨架和无依赖单文件构建流程。完成后再进入 T02。
