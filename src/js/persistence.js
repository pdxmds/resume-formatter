/** Full local copies and reload recovery. No user data leaves the browser. */
const APP_STATE_KEY = "resume-formatter:app-state-v1";
const MD_SNAPSHOTS_KEY = "resume-formatter:md-snapshots-v1";
let _sessionStorageKey = APP_STATE_KEY;
let _restoredSession = null;
let _draftTimer = null;
let _persistenceReady = false;
let _storageWarningShown = false;

function normalizeStoredState(value) {
  if (!value || typeof value !== "object" || !value.profile
    || typeof value.profile.name !== "string" || !Array.isArray(value.sections)) return null;
  const defaults = createDefaultState();
  const state = { ...defaults, ...deepClone(value) };
  for (const key of ["profile", "source", "layout", "photo", "metadata"]) {
    state[key] = { ...defaults[key], ...(state[key] || {}) };
  }
  return state;
}

/** Read legacy Markdown copies without deleting or rewriting them. */
function stateFromSavedCopy(snapshot) {
  if (snapshot.state) return normalizeStoredState(snapshot.state);
  if (typeof snapshot.markdown !== "string") return null;
  return validateAndBuildState(parseMarkdown(snapshot.markdown), snapshot.name).state;
}

function loadInitialState() {
  const embedded = normalizeStoredState(loadEmbeddedState());
  // Each downloaded HTML owns its draft; an unrelated website draft must never replace it.
  _sessionStorageKey = embedded ? `${APP_STATE_KEY}:${embedded.documentId}` : APP_STATE_KEY;
  _restoredSession = null;
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(_sessionStorageKey) || "null");
  } catch (error) {
    console.warn("Could not read last session; checking saved copies:", error);
  }
  try {
    const copies = embedded ? [] : loadMarkdownSnapshots().sort((a, b) =>
      new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
    // A copy write may succeed even when there is no space for a second draft write.
    const newerCopy = saved && copies.find((copy) =>
      new Date(copy.updatedAt || copy.createdAt || 0) > new Date(saved.savedAt || 0));
    if (newerCopy) {
      const state = stateFromSavedCopy(newerCopy);
      if (state) {
        _restoredSession = { activeFile: `snapshot:${newerCopy.id}`, dirty: false };
        return state;
      }
    }
    const state = normalizeStoredState(saved && saved.state);
    if (state) {
      _restoredSession = { activeFile: saved.activeFile || null, dirty: Boolean(saved.dirty) };
      return state;
    }
    if (embedded) return embedded;
    const lastId = localStorage.getItem(LAST_DOCUMENT_KEY);
    const legacyDraft = lastId && normalizeStoredState(loadDraft(lastId));
    if (legacyDraft) {
      _restoredSession = { activeFile: null, dirty: true };
      return legacyDraft;
    }
    for (const copy of copies) {
      const state = stateFromSavedCopy(copy);
      if (state) {
        _restoredSession = { activeFile: `snapshot:${copy.id}`, dirty: false };
        return state;
      }
    }
  } catch (error) {
    console.warn("Local resume recovery unavailable:", error);
  }
  return embedded;
}

function initPersistence() {
  _persistenceReady = true;
  if (_restoredSession) {
    _activeFile = _restoredSession.activeFile;
    if (_restoredSession.dirty) markDirty();
    else clearDirty();
    setDraftStatus("已恢复上次简历");
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") persistCurrentSession();
  });
  window.addEventListener("pagehide", () => persistCurrentSession());
  window.addEventListener("beforeunload", (event) => {
    if (!persistCurrentSession() && isDirty()) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
}

function setDraftStatus(text) {
  for (const id of ["draft-status", "local-save-status"]) {
    const status = document.getElementById(id);
    if (status) status.textContent = text;
  }
}

function scheduleDraftSave() {
  if (!_persistenceReady) return;
  clearTimeout(_draftTimer);
  setDraftStatus("正在暂存…");
  _draftTimer = setTimeout(persistCurrentSession, 350);
}

function persistCurrentSession() {
  if (!_persistenceReady) return true;
  clearTimeout(_draftTimer);
  try {
    localStorage.setItem(_sessionStorageKey, JSON.stringify({
      version: 1, state: getState(), activeFile: _activeFile, dirty: isDirty(), savedAt: new Date().toISOString(),
    }));
    setDraftStatus(isDirty() ? "草稿已暂存到本机" : "已保存到本机");
    _storageWarningShown = false;
    return true;
  } catch (error) {
    setDraftStatus("暂存失败，请下载备份");
    if (!_storageWarningShown) {
      _storageWarningShown = true;
      showToast("浏览器存储空间不足或不可用。请点击“保存 → 下载完整 HTML”备份，不要关闭页面。", "error");
    }
    return false;
  }
}

function showLocalSaveFailure() {
  showDialog({
    title: "尚未保存成功",
    message: "浏览器存储空间不足或不可用，当前修改仍留在页面中。请先下载完整 HTML 备份；不要清除网站数据，也不要关闭页面。",
    buttons: [
      { text: "返回编辑" },
      { text: "下载完整 HTML", primary: true, action: () => exportAsHtml(getState()) },
    ],
  });
}
