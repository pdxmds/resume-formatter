/**
 * Resume State management module.
 * The Resume State is the single source of truth for all resume data.
 */

/** @type {string} */
const STATE_STORAGE_PREFIX = "resume-formatter:draft:";

/** @type {string} */
const LAST_DOCUMENT_KEY = "resume-formatter:last-document";

/** @type {number} */
const APP_VERSION = "1.0.0";

/** @type {number} */
const SCHEMA_VERSION_1 = 1;

/** @type {string} */
const SECTION_TITLES = {
  education: "教育背景",
  experience: "实习经历",
  projects: "项目经历",
  skills: "技能特长",
};

/**
 * Object.frozen mapping from PRD section keys to display titles.
 * A read‑only lookup.
 */
const SECTION_TITLES_MAP = Object.freeze(Object.assign(
  Object.create(null),
  SECTION_TITLES,
));

/**
 * SECTION_TITLES_MAP 的防御性访问
 * 若 sectionType 未注册则回退到原始英文键
 * @param {string} sectionType
 * @returns {string}
 */
function getSectionTitle(sectionType) {
  return SECTION_TITLES_MAP[sectionType] || sectionType;
}

/**
 * Create a default resume state.
 * @returns {object}
 */
function createDefaultState() {
  return {
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION_1,
    documentId: generateId(),
    resumeName: "",
    source: {
      fileName: "",
      importedAt: "",
      rawMarkdownHash: "",
    },
    profile: {
      name: "",
      headline: "",
      location: "",
      phone: "",
      email: "",
      website: "",
      portfolio: "",
      github: "",
    },
    sections: [],
    layout: {
      fontSize: 10,
      lineHeight: 1.57,
      headerOffsetY: 0,
    },
    photo: {
      source: "",
      dataUrl: "",
      mimeType: "",
      originalWidth: 0,
      originalHeight: 0,
      scale: 1,
      frameScale: 1,
      frameOffsetX: 0,
      frameOffsetY: 0,
      offsetX: 0,
      offsetY: 0,
    },
    importSnapshot: null,
    metadata: {
      createdAt: "",
      updatedAt: "",
      lastSavedAt: "",
    },
  };
}

/**
 * Get the current Resume State singleton.
 * @returns {object}
 */
function getState() {
  if (!window.__resumeState) {
    window.__resumeState = createDefaultState();
  }
  return window.__resumeState;
}

/**
 * Set a new Resume State (e.g. after import).
 * @param {object} newState
 */
function setState(newState) {
  window.__resumeState = newState;
  if (typeof resetUndoHistory === "function") resetUndoHistory();
}

/**
 * Update the metadata timestamps.
 * @param {object} state
 */
function touchState(state) {
  const now = new Date().toISOString();
  if (!state.metadata.createdAt) {
    state.metadata.createdAt = now;
  }
  state.metadata.updatedAt = now;
}

/**
 * Create an import snapshot from the current state's content-relevant data.
 * @param {object} state
 * @returns {object}
 */
function createImportSnapshot(state) {
  return {
    resumeName: state.resumeName,
    profile: deepClone(state.profile),
    sections: deepClone(state.sections),
  };
}

/**
 * Restore content from an import snapshot (preserves photo).
 * @param {object} state
 * @param {object} snapshot
 */
function restoreImportSnapshot(state, snapshot) {
  if (!snapshot) return;
  state.resumeName = snapshot.resumeName;
  state.profile = deepClone(snapshot.profile);
  state.sections = deepClone(snapshot.sections);
  state.metadata.updatedAt = new Date().toISOString();
}

/**
 * Get the localStorage key for a given draft.
 * @param {string} documentId
 * @returns {string}
 */
function getDraftKey(documentId) {
  return STATE_STORAGE_PREFIX + documentId;
}

/**
 * Save current state to localStorage draft.
 * @param {object} state
 */
function saveDraft(state) {
  try {
    const key = getDraftKey(state.documentId);
    localStorage.setItem(key, JSON.stringify(state));
    localStorage.setItem(LAST_DOCUMENT_KEY, state.documentId);
    return true;
  } catch (e) {
    console.error("Failed to save draft:", e);
    return false;
  }
}

/**
 * Load draft from localStorage.
 * @param {string} documentId
 * @returns {object|null}
 */
function loadDraft(documentId) {
  try {
    const key = getDraftKey(documentId);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.error("Failed to load draft:", e);
    return null;
  }
}

/**
 * Load embedded state from HTML's <script id="embedded-resume-state">.
 * @returns {object|null}
 */
function loadEmbeddedState() {
  const el = document.getElementById("embedded-resume-state");
  if (!el) return null;
  return safeJsonParse(el.textContent);
}
