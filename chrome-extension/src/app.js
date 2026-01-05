/**
 * 应用入口：负责 DOM 查询、状态串联、功能模块装配。
 */

import { safeJsonParse, stringifyPretty } from "./lib/json.js";
import { createContextMenu } from "./lib/contextMenu.js";
import { createToast } from "./lib/toast.js";
import { createDiffOverlay } from "./lib/diffOverlay.js";
import { SAMPLE_JSON_TEXT } from "./sample.js";
import { createLayerStack } from "./features/layerStack.js";
import { createMainPanel } from "./features/mainPanel.js";

function boot() {
  const overlayEl = document.getElementById("overlay");
  const modalStackEl = document.getElementById("modalStack");
  const mainViewerEl = document.getElementById("mainViewer");
  const jsonInputEl = document.getElementById("jsonInput");
  const layoutEl = document.getElementById("layout");
  const btnToggleInputEl = document.getElementById("btnToggleInput");
  const toastEl = document.getElementById("toast");
  const mainHintEl = document.getElementById("mainHint");

  const btnMainEditEl = document.getElementById("btnMainEdit");
  const btnMainSaveEl = document.getElementById("btnMainSave");
  const btnMainDiffEl = document.getElementById("btnMainDiff");
  const btnMainCancelEl = document.getElementById("btnMainCancel");
  const btnMainCopyEl = document.getElementById("btnMainCopy");
  const btnMainCopyCompactEl = document.getElementById("btnMainCopyCompact");

  const diffOverlayEl = document.getElementById("diffOverlay");
  const diffTitleEl = document.getElementById("diffTitle");
  const btnDiffCloseEl = document.getElementById("btnDiffClose");
  const diffSummaryEl = document.getElementById("diffSummary");
  const diffViewEl = document.getElementById("diffView");

  const toast = createToast(toastEl);
  const contextMenu = createContextMenu();

  const diffOverlay = createDiffOverlay({
    overlayEl: diffOverlayEl,
    titleEl: diffTitleEl,
    closeBtnEl: btnDiffCloseEl,
    summaryEl: diffSummaryEl,
    viewEl: diffViewEl
  });

  let rootValue = null;

  const setRootValue = (value) => {
    rootValue = value;
  };

  const getRootValue = () => rootValue;

  const setInputText = (text) => {
    jsonInputEl.value = text;
  };

  const getInputText = () => jsonInputEl.value;

  let mainPanel = null;

  const layerStack = createLayerStack({
    overlayEl,
    modalStackEl,
    toast,
    contextMenu,
    getRootValue,
    setRootValue: (value) => {
      setRootValue(value);
      setInputText(stringifyPretty(value));
    },
    onRootRendered: () => {
      if (!mainPanel) return;
      mainPanel.setMode("view");
      mainPanel.render();
    },
    diffOverlay
  });

  mainPanel = createMainPanel({
    mainViewerEl,
    mainHintEl,
    btnMainEditEl,
    btnMainSaveEl,
    btnMainDiffEl,
    btnMainCancelEl,
    btnMainCopyEl,
    btnMainCopyCompactEl,
    diffOverlay,
    toast,
    contextMenu,
    getRootValue,
    setRootValue,
    getInputText,
    setInputText,
    layerStack
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "s" && e.key !== "S") return;
    if (!e.metaKey && !e.ctrlKey) return;
    if (e.altKey) return;
    const handled = layerStack.saveTopIfEditing() || mainPanel.saveIfEditing();
    if (!handled) return;
    e.preventDefault();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const handled = mainPanel.cancelIfEditing();
    if (!handled) return;
    e.preventDefault();
  });

  function isEditableTarget(target) {
    if (!target) return false;
    const el = target instanceof Element ? target : null;
    if (!el) return false;
    if (el.closest("input, textarea")) return true;
    const active = document.activeElement;
    if (active && active instanceof HTMLElement && active.isContentEditable) return true;
    return false;
  }

  function hasUserSelection() {
    const sel = window.getSelection ? window.getSelection() : null;
    if (!sel) return false;
    return sel.type === "Range" && String(sel.toString() || "").trim().length > 0;
  }

  document.addEventListener("keydown", async (e) => {
    if (e.key !== "c" && e.key !== "C") return;
    if (!e.metaKey && !e.ctrlKey) return;
    if (e.altKey) return;
    if (e.shiftKey) return;
    if (isEditableTarget(e.target)) return;
    if (hasUserSelection()) return;

    const handled = (await layerStack.copyTopJson()) || (await mainPanel.copyCurrentJson());
    if (!handled) return;
    e.preventDefault();
  });

  let autoFormatTimerId = null;
  let autoErrorToastTimerId = null;
  let lastFormattedText = jsonInputEl.value;
  let lastErrorToastText = "";
  let inputVisible = true;
  const AUTO_FORMAT_DELAY_MS = 200;
  const AUTO_ERROR_TOAST_DELAY_MS = 900;

  function setInputVisible(visible) {
    inputVisible = visible;
    layoutEl.classList.toggle("input-hidden", !visible);
    if (btnToggleInputEl) btnToggleInputEl.textContent = visible ? "📥 隐藏输入" : "📤 显示输入";
  }

  if (btnToggleInputEl) {
    btnToggleInputEl.addEventListener("click", () => {
      setInputVisible(!inputVisible);
    });
  }

  function parseRootFromInput({ formatOnSuccess }) {
    const parsed = safeJsonParse(jsonInputEl.value);
    if (!parsed.ok) {
      toast.show("JSON 解析失败");
      return false;
    }
    setRootValue(parsed.value);
    if (formatOnSuccess) {
      jsonInputEl.value = stringifyPretty(parsed.value);
    }
    return true;
  }

  function autoFormatFromInput() {
    const current = jsonInputEl.value;
    if (!current.trim()) return;
    if (current === lastFormattedText) return;

    const parsed = safeJsonParse(current);
    if (!parsed.ok) return;

    lastErrorToastText = "";
    setRootValue(parsed.value);
    const pretty = stringifyPretty(parsed.value);
    jsonInputEl.value = pretty;
    lastFormattedText = pretty;
    layerStack.closeAll();
    mainPanel.setMode("view");
    mainPanel.render();
  }

  function showParseErrorToastIfNeeded() {
    const current = jsonInputEl.value;
    if (!current.trim()) return;
    if (current === lastFormattedText) return;
    const parsed = safeJsonParse(current);
    if (parsed.ok) {
      lastErrorToastText = "";
      return;
    }
    if (current === lastErrorToastText) return;
    lastErrorToastText = current;
    toast.show("JSON 解析失败，请修改后再试");
  }

  jsonInputEl.addEventListener("input", () => {
    if (autoFormatTimerId != null) {
      window.clearTimeout(autoFormatTimerId);
      autoFormatTimerId = null;
    }
    if (autoErrorToastTimerId != null) {
      window.clearTimeout(autoErrorToastTimerId);
      autoErrorToastTimerId = null;
    }
    autoFormatTimerId = window.setTimeout(() => {
      autoFormatFromInput();
    }, AUTO_FORMAT_DELAY_MS);
    autoErrorToastTimerId = window.setTimeout(() => {
      showParseErrorToastIfNeeded();
    }, AUTO_ERROR_TOAST_DELAY_MS);
  });

  jsonInputEl.addEventListener("paste", () => {
    if (autoFormatTimerId != null) {
      window.clearTimeout(autoFormatTimerId);
      autoFormatTimerId = null;
    }
    if (autoErrorToastTimerId != null) {
      window.clearTimeout(autoErrorToastTimerId);
      autoErrorToastTimerId = null;
    }
    window.setTimeout(() => {
      autoFormatFromInput();
    }, 0);
    window.setTimeout(() => {
      showParseErrorToastIfNeeded();
    }, 0);
  });

  setInputText(SAMPLE_JSON_TEXT);
  parseRootFromInput({ formatOnSuccess: true });
  lastFormattedText = jsonInputEl.value;
  mainPanel.setMode("view");
  mainPanel.render();
  setInputVisible(true);
}

boot();
