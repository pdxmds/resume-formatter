import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const sources = [
  "src/js/utils.js",
  "src/js/state.js",
  "src/js/parser.js",
  "src/js/json-importer.js",
  "src/js/validator.js",
  "src/js/exporter.js",
];

const context = vm.createContext({
  console,
  crypto: globalThis.crypto,
  structuredClone,
  Date,
  Math,
  setTimeout,
  clearTimeout,
});
context.window = context;
context.document = {
  getElementById: () => null,
  querySelector: () => null,
  createElement: () => ({ appendChild() {}, remove() {} }),
  body: { appendChild() {} },
};

for (const source of sources) {
  vm.runInContext(readFileSync(new URL(source, root), "utf8"), context, { filename: source });
}

function evaluate(markdown, name = "测试简历.md") {
  context.__markdown = markdown;
  context.__fileName = name;
  return vm.runInContext(
    "validateAndBuildState(parseMarkdown(__markdown), __fileName)",
    context,
  );
}

test("匿名 Markdown fixture 可以解析并生成 Resume State", () => {
  const markdown = readFileSync(new URL("fixtures/valid/sample-resume.md", root), "utf8");
  const result = evaluate(markdown, "sample-resume.md");

  assert.ok(result.state);
  assert.equal(result.state.schemaVersion, 1);
  assert.equal(result.state.source.fileName, "sample-resume.md");
  assert.ok(result.state.sections.some((section) => section.type === "experience"));
  assert.equal(result.errors.filter((item) => item.level === "error").length, 0);
});

test("缺少必填字段时拒绝导入并返回具体错误", () => {
  const markdown = readFileSync(
    new URL("fixtures/invalid/missing-required-field.md", root),
    "utf8",
  );
  const result = evaluate(markdown, "missing-required-field.md");
  const codes = result.errors.map((item) => item.code);

  assert.equal(result.state, null);
  assert.ok(codes.includes("MISSING_REQUIRED_FIELD"));
  assert.ok(codes.includes("MISSING_DATE"));
});

test("链接与强调格式保留为结构化 token", () => {
  const markdown = `---
schema_version: 1
resume_name: 格式测试
name: 示例用户
phone: 1xx-xxxx-xxxx
email: example@example.com
---

## 项目经历

### 示例项目
role: 产品负责人
date: 2025.01-2025.03

- 查看[作品页面](https://example.com)，并完成**核心流程**
`;
  const result = evaluate(markdown);
  const tokens = result.state.sections[0].entries[0].bullets[0].content;

  assert.ok(tokens.some((token) => token.href === "https://example.com"));
  assert.ok(tokens.some((token) => token.type === "strong" && token.value === "核心流程"));
});

test("自定义栏目标题会保留在 Resume State 中", () => {
  const markdown = `---
schema_version: 1
resume_name: 标题测试
name: 示例用户
phone: 1xx-xxxx-xxxx
email: example@example.com
---

## 实习经历
title: 工作经历

### 示例公司
role: 产品实习生
date: 2025.01-2025.03

- 负责需求梳理
`;
  const result = evaluate(markdown);
  assert.ok(result.state);
  assert.equal(result.state.sections[0].title, "工作经历");
});

test("任意二级标题可以导入为包含混合内容的自定义板块", () => {
  const markdown = `---
schema_version: 2
resume_name: 自定义板块测试
name: 示例用户
phone: 1xx-xxxx-xxxx
email: example@example.com
---

## 我想展示的内容

这是一段**自由正文**。

- 第一条
- 第二条

### 示例条目
role: 自定义角色
date: 2025.01-2025.06

- 条目描述
`;
  const result = evaluate(markdown);
  const section = result.state.sections[0];

  assert.ok(result.state);
  assert.equal(section.type, "custom");
  assert.equal(section.title, "我想展示的内容");
  assert.deepEqual(Array.from(section.blocks, (block) => block.type), ["text", "list", "entry"]);
  assert.equal(section.blocks[1].bullets.length, 2);
  assert.equal(section.blocks[2].name, "示例条目");
});

test("自定义板块可以通过 Markdown 导出再导入", () => {
  const initial = evaluate(`---
schema_version: 2
resume_name: 往返测试
name: 示例用户
phone: 1xx-xxxx-xxxx
email: example@example.com
---

## 获奖与其他

可编辑正文

- 内容一
`);
  context.__state = initial.state;
  const exported = vm.runInContext("serializeStateToMarkdown(__state)", context);
  const roundTrip = evaluate(exported, "round-trip.md");

  assert.match(exported, /schema_version: 2/);
  assert.match(exported, /## custom\n\ntitle: 获奖与其他/);
  assert.ok(roundTrip.state);
  assert.equal(roundTrip.state.sections[0].blocks[0].content[0].value, "可编辑正文");
});

test("预置板块与自定义板块可以一起导出再导入", () => {
  const markdown = readFileSync(new URL("fixtures/valid/sample-resume.md", root), "utf8");
  const initial = evaluate(markdown, "sample-resume.md");
  initial.state.sections.push({
    id: "custom-test",
    type: "custom",
    title: "其他经历",
    entries: [],
    blocks: [{ id: "text-test", type: "text", content: [{ type: "text", value: "自定义内容" }] }],
  });
  context.__state = initial.state;
  const exported = vm.runInContext("serializeStateToMarkdown(__state)", context);
  const roundTrip = evaluate(exported, "complete-round-trip.md");

  assert.ok(roundTrip.state);
  assert.deepEqual(Array.from(roundTrip.state.sections, (section) => section.type), [
    "education", "experience", "projects", "skills", "custom",
  ]);
});

test("自定义板块与预置标题同名时仍保留自定义结构", () => {
  const initial = evaluate(`---
schema_version: 2
resume_name: 同名测试
name: 示例用户
phone: 1xx-xxxx-xxxx
email: example@example.com
---

## custom
title: 教育背景

这是自定义内容
`);
  context.__state = initial.state;
  const exported = vm.runInContext("serializeStateToMarkdown(__state)", context);
  const roundTrip = evaluate(exported, "same-title.md");

  assert.equal(roundTrip.state.sections[0].type, "custom");
  assert.equal(roundTrip.state.sections[0].title, "教育背景");
  assert.equal(roundTrip.state.sections[0].blocks[0].type, "text");
});

test("JSON Schema v2 支持自定义板块", () => {
  const raw = JSON.stringify({
    schemaVersion: 2,
    resumeName: "JSON 测试",
    profile: { name: "示例用户", headline: "产品经理", phone: "1xx-xxxx-xxxx", email: "example@example.com" },
    sections: [{
      type: "custom",
      title: "自定义标题",
      blocks: [
        { type: "text", content: "一段文字" },
        { type: "list", items: ["列表内容"] },
      ],
    }],
  });
  context.__json = raw;
  const result = vm.runInContext("importJsonResume(__json, 'custom.json')", context);

  assert.ok(result.state);
  assert.equal(result.state.sections[0].title, "自定义标题");
  assert.equal(result.state.sections[0].blocks[1].bullets[0].content[0].value, "列表内容");
});

test("实习经历可以按拖动后的 ID 顺序整体重排", () => {
  const markdown = readFileSync(new URL("fixtures/valid/sample-resume.md", root), "utf8");
  const result = evaluate(markdown, "sample-resume.md");
  const section = result.state.sections.find((item) => item.type === "experience");
  const initialIds = section.entries.map((entry) => entry.id);
  const initialNames = section.entries.map((entry) => entry.name);

  context.__section = section;
  context.__order = [initialIds[1], initialIds[0], initialIds[2]];
  const changed = vm.runInContext("applyEntryOrder(__section, __order)", context);

  assert.equal(changed, true);
  assert.deepEqual(Array.from(section.entries, (entry) => entry.name), [
    initialNames[1], initialNames[0], initialNames[2],
  ]);
});

test("所有简历大板块可以按拖动后的 ID 全局重排", () => {
  const markdown = readFileSync(new URL("fixtures/valid/sample-resume.md", root), "utf8");
  const result = evaluate(markdown, "sample-resume.md");
  const initialIds = result.state.sections.map((section) => section.id);
  const initialTitles = result.state.sections.map((section) => section.title);

  context.__state = result.state;
  context.__sectionOrder = [initialIds[0], initialIds[2], initialIds[1], initialIds[3]];
  const changed = vm.runInContext("applySectionOrder(__state, __sectionOrder)", context);

  assert.equal(changed, true);
  assert.deepEqual(Array.from(result.state.sections, (section) => section.title), [
    initialTitles[0], initialTitles[2], initialTitles[1], initialTitles[3],
  ]);

  context.__state = result.state;
  const exportedMarkdown = vm.runInContext("serializeStateToMarkdown(__state)", context);
  const exportedJson = vm.runInContext("serializeStateToJson(__state)", context);
  assert.ok(exportedMarkdown.indexOf("## 项目经历") < exportedMarkdown.indexOf("## 实习经历"));
  assert.ok(exportedJson.indexOf('"type": "projects"') < exportedJson.indexOf('"type": "experience"'));
});

test("载入旧状态时会清除造成板块重叠的负间距", () => {
  const state = { sections: [
    { id: "negative", spacingBefore: -100 },
    { id: "positive", spacingBefore: 3 },
  ] };
  context.__legacyState = state;
  vm.runInContext("setState(__legacyState)", context);

  assert.equal(state.sections[0].spacingBefore, 0);
  assert.equal(state.sections[1].spacingBefore, 3);
});

test("出生年月在 Markdown v1/v2、编辑及 Markdown/JSON 往返中保留", () => {
  for (const schemaVersion of [1, 2]) {
    const initial = evaluate(`---
schema_version: ${schemaVersion}
resume_name: 顶部布局测试（虚构）
name: 示例用户
phone: 1xx-xxxx-xxxx
email: example@example.com
birth: 2001/08
location: 海州市
---
`);
    assert.ok(initial.state);
    assert.equal(initial.state.profile.birth, "2001/08");
    assert.equal(initial.state.profile.headline, "");
    // Model the edit before saving, instead of only testing the import value.
    initial.state.profile.birth = "2000.09";
    context.__state = initial.state;
    const markdown = vm.runInContext("serializeStateToMarkdown(__state)", context);
    const roundTrip = evaluate(markdown);
    assert.equal(roundTrip.state.profile.birth, "2000.09");
    assert.equal(roundTrip.state.profile.location, "海州市");

    context.__json = vm.runInContext("serializeStateToJson(__state)", context);
    const jsonRoundTrip = vm.runInContext("importJsonResume(__json, 'header.json')", context);
    assert.ok(jsonRoundTrip.state, JSON.stringify(jsonRoundTrip.errors));
    assert.equal(jsonRoundTrip.state.profile.birth, "2000.09");
    assert.equal(jsonRoundTrip.state.profile.headline, "");
  }
});

test("旧文件省略出生年月和求职方向时仍可导入及保存", () => {
  context.__json = JSON.stringify({
    schemaVersion: 1,
    resumeName: "旧版测试（虚构）",
    profile: { name: "示例用户", phone: "1xx-xxxx-xxxx", email: "example@example.com" },
    sections: [],
  });
  const imported = vm.runInContext("importJsonResume(__json, 'legacy.json')", context);
  assert.ok(imported.state);
  assert.equal(imported.state.profile.birth, "");
  context.__state = imported.state;
  const markdown = vm.runInContext("serializeStateToMarkdown(__state)", context);
  assert.doesNotMatch(markdown, /birth:|undefined/);
  assert.equal(evaluate(markdown).state.profile.birth, "");

  delete imported.state.profile.birth;
  vm.runInContext("setState(__state)", context);
  assert.equal(imported.state.profile.birth, "");
});

test("JSON 拒绝非文本出生年月，避免渲染出对象或数组", () => {
  for (const birth of [2001, {}, []]) {
    context.__json = JSON.stringify({
      schemaVersion: 2,
      resumeName: "字段类型测试（虚构）",
      profile: { name: "示例用户", phone: "1xx-xxxx-xxxx", email: "example@example.com", birth },
      sections: [],
    });
    const result = vm.runInContext("importJsonResume(__json, 'invalid-birth.json')", context);
    assert.equal(result.state, null);
    assert.ok(result.errors.some((error) => error.field === "profile.birth"));
  }
});
