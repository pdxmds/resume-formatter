import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const sample = readFileSync(new URL("fixtures/valid/sample-resume.md", root), "utf8");
const copiesKey = "resume-formatter:md-snapshots-v1";
const sessionKey = "resume-formatter:app-state-v1";

function app(storage = new Map(), embedded = null) {
  const events = {};
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {} }, crypto: globalThis.crypto,
    structuredClone, Date, Math, setTimeout: () => 1, clearTimeout() {},
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem(key, value) { storage.set(key, value); },
    },
    document: {
      addEventListener() {}, querySelectorAll: () => [],
      getElementById: (id) => id === "embedded-resume-state" && embedded ? { textContent: JSON.stringify(embedded) } : null,
    },
    addEventListener(name, callback) { events[name] = callback; },
    requestAnimationFrame() {},
  });
  context.window = context;
  for (const file of ["utils", "state", "parser", "json-importer", "validator", "editor", "persistence", "exporter", "app"]) {
    vm.runInContext(readFileSync(new URL(`src/js/${file}.js`, root), "utf8"), context);
  }
  vm.runInContext(`
    function renderResume() {} function updateA4Status() {} function resetUndoHistory() {}
    function getTheme() { return getState().layout.theme || "d"; }
    function showToast(message, level) { window.lastToast = {message, level}; }
    function showDialog(options) { window.lastDialog = options; }
  `, context);
  context.sample = sample;
  const run = (code) => vm.runInContext(code, context);
  run("setState(validateAndBuildState(parseMarkdown(sample), 'fictional.md').state)");
  return { context, run, storage, events };
}

test("完整副本保留照片、排版、局部格式和字段 ID，复制后互不影响", () => {
  const a = app();
  a.run(`
    getState().profile.birth = "2001/08";
    getState().photo = {...getState().photo, dataUrl:"data:image/png;base64,TEST", scale:1.3, offsetX:12};
    getState().layout = {fontSize:11, lineHeight:1.7, theme:"b", blockTextStyle:{"profile:name":{italic:true}}};
    getState().sections[0].spacingBefore = 2.5;
    getState().sections[0].entries[0].bullets[0].markerStyle = "square";
    var before = deepClone(getState());
    var copy = saveMarkdownSnapshot(getState(), "虚构测试副本");
  `);
  const saved = JSON.parse(a.storage.get(copiesKey))[0];
  const before = JSON.parse(a.run("JSON.stringify(before)"));
  assert.deepEqual(saved.state.photo, before.photo);
  assert.deepEqual(saved.state.layout, before.layout);
  assert.deepEqual(saved.state.sections, before.sections);
  assert.equal(saved.state.profile.birth, "2001/08");
  assert.notEqual(saved.state.documentId, before.documentId);
  a.run('getState().profile.name = "修改后的虚构姓名"');
  assert.notEqual(JSON.parse(a.storage.get(copiesKey))[0].state.profile.name, "修改后的虚构姓名");
});

test("保存当前副本原位更新，重新打开恢复完整数据", async () => {
  const a = app();
  a.run('var copy = saveMarkdownSnapshot(getState(), "测试副本"); getState().layout.fontSize = 11; markDirty(); saveCurrentCopy(copy.id)');
  assert.equal(JSON.parse(a.storage.get(copiesKey)).length, 1);
  a.run('getState().layout.fontSize = 7');
  await a.run('loadSavedCopy(copy.id)');
  assert.equal(a.run('getState().layout.fontSize'), 11);
  assert.equal(a.run('isDirty()'), false);
});

test("刷新恢复未保存文字、照片、布局及当前副本关联", () => {
  const a = app();
  a.run('loadInitialState(); initPersistence(); var copy = saveMarkdownSnapshot(getState(), "测试副本"); getState().profile.name = "草稿测试"; getState().layout.theme="c"; markDirty(); persistCurrentSession()');
  const b = app(a.storage);
  b.run('setState(loadInitialState()); initPersistence()');
  assert.equal(b.run('getState().profile.name'), "草稿测试");
  assert.equal(b.run('getState().layout.theme'), "c");
  assert.equal(b.run('_activeFile'), a.run('_activeFile'));
  assert.equal(b.run('isDirty()'), true);
});

test("旧版 Markdown 副本可恢复文字并升级，其他旧副本保持原样", () => {
  const legacy = { id:"legacy", name:"旧测试.md", markdown:sample, createdAt:"2026-01-01" };
  const other = { ...legacy, id:"other", createdAt:"2025-01-01" };
  const a = app(new Map([[copiesKey, JSON.stringify([legacy, other])]]));
  a.run('setState(loadInitialState()); initPersistence(); saveCurrentCopy("legacy")');
  const copies = JSON.parse(a.storage.get(copiesKey));
  assert.ok(copies[0].state.sections.length);
  assert.equal(copies[0].markdown, undefined);
  assert.deepEqual(copies[1], other);
});

test("HTML 内嵌简历不被网站草稿替换，独立 HTML 的修改可恢复", () => {
  const a = app();
  a.run('initPersistence(); getState().profile.name="网站草稿"; persistCurrentSession()');
  const embedded = JSON.parse(a.run('JSON.stringify(getState())'));
  embedded.documentId = "downloaded-example";
  embedded.profile.name = "HTML内嵌测试";
  const b = app(a.storage, embedded);
  b.run('setState(loadInitialState()); initPersistence()');
  assert.equal(b.run('getState().profile.name'), "HTML内嵌测试");
  b.run('getState().profile.name="HTML后续修改"; markDirty(); persistCurrentSession()');
  assert.equal(app(a.storage, embedded).run('loadInitialState().profile.name'), "HTML后续修改");
  assert.equal(app(a.storage).run('loadInitialState().profile.name'), "网站草稿");
});

test("存储已满时不清除未保存标记、不覆盖旧副本并提供 HTML 备份入口", () => {
  const a = app();
  a.run('var copy = saveMarkdownSnapshot(getState(), "测试副本"); getState().profile.name="未保存的修改"; markDirty()');
  const oldData = a.storage.get(copiesKey);
  a.context.localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
  a.run('saveCurrentCopy(copy.id)');
  assert.equal(a.run('isDirty()'), true);
  assert.equal(a.storage.get(copiesKey), oldData);
  assert.ok(a.context.lastDialog.buttons.some((button) => button.text === "下载完整 HTML"));
  assert.throws(() => a.run('saveMarkdownSnapshot(getState(), "失败副本")'));
  assert.equal(a.storage.get(copiesKey), oldData);
});

test("完整副本写入成功但草稿写入失败时，重开不能恢复过期草稿", () => {
  const a = app();
  a.run('initPersistence(); persistCurrentSession()');
  const oldSession = JSON.parse(a.storage.get(sessionKey));
  oldSession.savedAt = "2020-01-01";
  a.storage.set(sessionKey, JSON.stringify(oldSession));
  a.context.localStorage.setItem = (key, value) => {
    if (key === sessionKey) throw new Error("QuotaExceededError");
    a.storage.set(key, value);
  };
  a.run('getState().profile.name="已成功保存的副本"; saveMarkdownSnapshot(getState(), "完整副本")');
  assert.equal(app(a.storage).run('loadInitialState().profile.name'), "已成功保存的副本");
});

test("导入单个新文件后解除原副本关联，避免保存到错误版本", () => {
  const a = app();
  a.run('var copy=saveMarkdownSnapshot(getState(), "原副本"); activateImportedResume(validateAndBuildState(parseMarkdown(sample), "新测试.md").state)');
  assert.equal(a.run('_activeFile'), null);
  assert.equal(JSON.parse(a.storage.get(copiesKey)).length, 1);
});

test("损坏的草稿不阻止恢复保存的副本，损坏的副本列表不得覆盖", () => {
  const a = app();
  a.run('saveMarkdownSnapshot(getState(), "有效副本")');
  a.storage.set(sessionKey, "broken");
  assert.ok(app(a.storage).run('loadInitialState().sections.length') > 0);
  a.storage.set(copiesKey, "broken");
  assert.throws(() => a.run('saveMarkdownSnapshot(getState(), "不应覆盖")'));
  assert.equal(a.storage.get(copiesKey), "broken");
});

test("只含个人信息、没有经历的已保存简历仍可恢复", () => {
  const a = app();
  a.run('initPersistence(); getState().sections=[]; getState().profile.name="空经历测试"; persistCurrentSession()');
  const state = app(a.storage).run('loadInitialState()');
  assert.equal(state.profile.name, "空经历测试");
  assert.equal(state.sections.length, 0);
});
