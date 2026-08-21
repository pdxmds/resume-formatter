import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const sources = [
  "src/js/utils.js",
  "src/js/state.js",
  "src/js/parser.js",
  "src/js/validator.js",
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
