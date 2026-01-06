/**
 * 主面板交互：结构化视图的渲染、编辑与保存。
 */

import { copyText } from "../lib/clipboard.js";
import { getAtPath, isUriString, safeJsonParse, stringifyPretty, stringifyValueForClipboard } from "../lib/json.js";
import { bindJsonHighlight } from "../lib/jsonHighlight.js";
import { renderJson } from "../lib/jsonViewer.js";

function parseDataPathFromEventTarget(target) {
  const clickable = target.closest(".clickable");
  if (!clickable) return null;
  try {
    return JSON.parse(clickable.dataset.path);
  } catch {
    return null;
  }
}

export function createMainPanel({
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
}) {
  let mode = "view";
  const collapsedPaths = new Set();

  function isBlankAreaDblClick(text, start, end) {
    const s = Math.max(0, Math.min(text.length, Number.isFinite(start) ? start : 0));
    const e = Math.max(0, Math.min(text.length, Number.isFinite(end) ? end : s));
    const selected = text.slice(Math.min(s, e), Math.max(s, e));
    if (selected.trim() !== "") return false;
    if (selected.length > 0) return true;
    if (s >= text.length) return true;
    if (/\s/.test(text[s])) return true;
    if (s > 0 && /\s/.test(text[s - 1])) return true;
    return false;
  }

  function getScrollRatio(scrollEl) {
    const max = scrollEl.scrollHeight - scrollEl.clientHeight;
    if (max <= 0) return 0;
    return scrollEl.scrollTop / max;
  }

  function clampNumber(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function getScrollAnchorFromEvent(scrollEl, e) {
    const rect = scrollEl.getBoundingClientRect();
    const offsetY = clampNumber(e.clientY - rect.top, 0, rect.height);
    const total = scrollEl.scrollHeight || 1;
    const ratio = (scrollEl.scrollTop + offsetY) / total;
    return {
      ratio: clampNumber(ratio, 0, 1),
      offsetY
    };
  }

  function ensureRootValueReady() {
    const rootValue = getRootValue();
    if (rootValue != null) return { ok: true, value: rootValue };

    const parsed = safeJsonParse(getInputText());
    if (!parsed.ok) return { ok: false, value: null };
    setRootValue(parsed.value);
    return { ok: true, value: parsed.value };
  }

  async function copyValue(value, { compact } = {}) {
    const text = stringifyValueForClipboard(value, { compact });
    const ok = await copyText(text);
    toast.show(ok ? "已复制" : "复制失败");
  }

  async function copyCurrentJson() {
    if (mode === "edit") {
      const editor = document.getElementById("mainEditor");
      const nextText = editor ? editor.value : "";
      const parsed = safeJsonParse(nextText);
      if (!parsed.ok) {
        toast.show("JSON 解析失败");
        return;
      }
      await copyValue(parsed.value, { compact: false });
      return;
    }

    const ensured = ensureRootValueReady();
    if (!ensured.ok) {
      toast.show("JSON 解析失败");
      return;
    }
    await copyValue(ensured.value, { compact: false });
  }

  function getPathKey(path) {
    return JSON.stringify(path);
  }

  function toggleCollapse(path) {
    const rootValue = getRootValue();
    const targetValue = getAtPath(rootValue, path);
    const collapsible = targetValue !== null && typeof targetValue === "object";
    if (!collapsible) return;

    const key = getPathKey(path);
    if (collapsedPaths.has(key)) {
      collapsedPaths.delete(key);
    } else {
      collapsedPaths.add(key);
    }
    render();
  }

  function setMode(nextMode) {
    mode = nextMode;
    const editing = mode === "edit";
    btnMainEditEl.style.display = editing ? "none" : "";
    if (btnMainCopyEl) btnMainCopyEl.style.display = editing ? "none" : "";
    if (btnMainCopyCompactEl) btnMainCopyCompactEl.style.display = editing ? "none" : "";
    btnMainSaveEl.style.display = editing ? "" : "none";
    if (btnMainDiffEl) btnMainDiffEl.style.display = editing ? "" : "none";
    btnMainCancelEl.style.display = editing ? "" : "none";
    if (mainHintEl) {
      mainHintEl.textContent = editing
        ? "编辑后保存将覆盖原始 JSON，并关闭所有浮层"
        : "";
    }
    if (!editing && diffOverlay) diffOverlay.close();
  }

  function render() {
    const rootValue = getRootValue();
    if (mode === "edit") {
      mainViewerEl.innerHTML = "";
      const wrap = document.createElement("div");
      wrap.className = "editor-wrap";

      const highlight = document.createElement("pre");
      highlight.className = "editor-highlight";
      highlight.setAttribute("aria-hidden", "true");

      const editor = document.createElement("textarea");
      editor.className = "editor-input";
      editor.id = "mainEditor";
      editor.spellcheck = false;
      editor.setAttribute("wrap", "off");
      editor.value = stringifyPretty(rootValue);

      wrap.appendChild(highlight);
      wrap.appendChild(editor);
      mainViewerEl.appendChild(wrap);
      bindJsonHighlight({ textareaEl: editor, highlightEl: highlight });
      return;
    }
    mainViewerEl.innerHTML = renderJson(rootValue, [], 0, { collapsedPaths });
  }

  function enterEditModeWithScrollSync(scrollSync) {
    const ensured = ensureRootValueReady();
    if (!ensured.ok) {
      toast.show("JSON 解析失败");
      return;
    }
    setMode("edit");
    render();

    setTimeout(() => {
      const editor = document.getElementById("mainEditor");
      const highlight = mainViewerEl.querySelector(".editor-highlight");
      if (!editor || !highlight) return;

      let nextTop = 0;
      if (scrollSync && scrollSync.mode === "anchor") {
        const maxTop = highlight.scrollHeight - highlight.clientHeight;
        const desiredTop = highlight.scrollHeight * scrollSync.ratio - scrollSync.offsetY;
        nextTop = clampNumber(desiredTop, 0, Math.max(0, maxTop));
      } else {
        const maxTop = highlight.scrollHeight - highlight.clientHeight;
        const ratio = scrollSync && scrollSync.mode === "ratio" ? scrollSync.value : 0;
        nextTop = maxTop > 0 ? maxTop * ratio : 0;
      }
      editor.scrollTop = nextTop;
      highlight.scrollTop = nextTop;
    }, 0);
  }

  btnMainEditEl.addEventListener("click", () => {
    const scrollRatio = getScrollRatio(mainViewerEl);
    enterEditModeWithScrollSync({ mode: "ratio", value: scrollRatio });
  });

  if (btnMainCopyEl) {
    btnMainCopyEl.addEventListener("click", async () => {
      const ensured = ensureRootValueReady();
      if (!ensured.ok) {
        toast.show("JSON 解析失败");
        return;
      }
      await copyValue(ensured.value, { compact: false });
    });
  }

  if (btnMainCopyCompactEl) {
    btnMainCopyCompactEl.addEventListener("click", async () => {
      const ensured = ensureRootValueReady();
      if (!ensured.ok) {
        toast.show("JSON 解析失败");
        return;
      }
      await copyValue(ensured.value, { compact: true });
    });
  }

  btnMainCancelEl.addEventListener("click", () => {
    setMode("view");
    render();
  });

  btnMainSaveEl.addEventListener("click", () => {
    saveFromEditor();
  });

  if (btnMainDiffEl) {
    btnMainDiffEl.addEventListener("click", () => {
      const ensured = ensureRootValueReady();
      if (!ensured.ok) {
        toast.show("JSON 解析失败");
        return;
      }
      const editor = document.getElementById("mainEditor");
      if (!editor) return;
      if (!diffOverlay) return;
      diffOverlay.open({ title: "配置 Diff", baseText: stringifyPretty(ensured.value), nextText: editor.value || "" });
    });
  }

  function saveFromEditor() {
    const editor = document.getElementById("mainEditor");
    const scrollRatio = editor ? getScrollRatio(editor) : 0;
    const nextText = editor ? editor.value : "";
    const parsed = safeJsonParse(nextText);
    if (!parsed.ok) {
      toast.show("JSON 解析失败");
      return;
    }
    setRootValue(parsed.value);
    setInputText(stringifyPretty(parsed.value));
    layerStack.closeAll();
    setMode("view");
    render();
    setTimeout(() => {
      const max = mainViewerEl.scrollHeight - mainViewerEl.clientHeight;
      mainViewerEl.scrollTop = max > 0 ? max * scrollRatio : 0;
    }, 0);
    toast.show("已保存");
  }

  mainViewerEl.addEventListener("click", (e) => {
    if (mode === "edit") return;

    const toggleEl = e.target.closest('[data-action="toggle"]');
    if (toggleEl) {
      try {
        const path = JSON.parse(toggleEl.dataset.path);
        toggleCollapse(path);
      } catch {}
      return;
    }

    const path = parseDataPathFromEventTarget(e.target);
    if (!path) return;
    layerStack.openFromRoot(path);
  });

  mainViewerEl.addEventListener("dblclick", (e) => {
    if (mode === "edit") return;
    const keyEl = e.target.closest('.k[data-collapsible="1"]');
    if (!keyEl) return;
    try {
      const path = JSON.parse(keyEl.dataset.path);
      toggleCollapse(path);
    } catch {}
  });

  mainViewerEl.addEventListener("dblclick", (e) => {
    if (mode === "edit") return;
    if (e.target.closest('.k, [data-role="value"], .expander, [data-action]')) return;
    const anchor = getScrollAnchorFromEvent(mainViewerEl, e);
    enterEditModeWithScrollSync({ mode: "anchor", ratio: anchor.ratio, offsetY: anchor.offsetY });
  });

  mainViewerEl.addEventListener("dblclick", (e) => {
    if (mode !== "edit") return;
    const editor = e.target.closest("textarea");
    if (!editor || editor.id !== "mainEditor") return;
    setTimeout(() => {
      const text = editor.value || "";
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      if (!isBlankAreaDblClick(text, start, end)) return;
      saveFromEditor();
    }, 0);
  });

  mainViewerEl.addEventListener("contextmenu", (e) => {
    if (mode === "edit") return;

    const valueEl = e.target.closest('[data-role="value"]');
    if (valueEl) {
      let path = null;
      try {
        path = JSON.parse(valueEl.dataset.path);
      } catch {
        path = null;
      }
      if (!path) return;

      const ensured = ensureRootValueReady();
      if (!ensured.ok) {
        toast.show("JSON 解析失败");
        return;
      }

      const value = getAtPath(ensured.value, path);
      if (!isUriString(value)) return;
      e.preventDefault();

      const url = String(value).trim();
      contextMenu.show({
        x: e.clientX,
        y: e.clientY,
        items: [
          {
            label: "🔗 打开",
            onSelect: () => {
              window.open(url, "_blank", "noopener,noreferrer");
            }
          },
          {
            label: "🔍 解析",
            onSelect: () => {
              const target = `https://url.web.bytedance.net/?url=${encodeURIComponent(url)}`;
              window.open(target, "_blank", "noopener,noreferrer");
            }
          }
        ]
      });
      return;
    }

    const keyEl = e.target.closest(".k");
    if (!keyEl) return;
    e.preventDefault();

    const ensured = ensureRootValueReady();
    if (!ensured.ok) {
      toast.show("JSON 解析失败");
      return;
    }

    let path = null;
    try {
      path = JSON.parse(keyEl.dataset.path);
    } catch {
      path = null;
    }
    if (!path) return;
    const value = getAtPath(ensured.value, path);

    contextMenu.show({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: "📋 复制", onSelect: () => copyValue(value, { compact: false }) },
        { label: "📦 压缩复制", onSelect: () => copyValue(value, { compact: true }) },
        { label: "✏️ 编辑", onSelect: () => layerStack.editFromRoot(path) }
      ]
    });
  });

  setMode("view");

  return {
    render,
    setMode,
    cancelIfEditing() {
      if (mode !== "edit") return false;
      setMode("view");
      render();
      return true;
    },
    async copyCurrentJson() {
      await copyCurrentJson();
      return true;
    },
    saveIfEditing() {
      if (mode !== "edit") return false;
      saveFromEditor();
      return true;
    }
  };
}
