/**
 * 递归解析层管理：负责 overlay + modal stack + 递归保存。
 */

import { escapeHtml } from "../lib/html.js";
import { copyText } from "../lib/clipboard.js";
import {
  getAtPath,
  isUriString,
  isJsonString,
  joinFullPath,
  safeJsonParse,
  setAtPath,
  stringifyPretty,
  stringifyValueForClipboard
} from "../lib/json.js";
import { renderJson } from "../lib/jsonViewer.js";
import { bindJsonHighlight } from "../lib/jsonHighlight.js";

function parseDataPathFromEventTarget(target) {
  const clickable = target.closest(".clickable");
  if (!clickable) return null;
  try {
    return JSON.parse(clickable.dataset.path);
  } catch {
    return null;
  }
}

function getPathKey(path) {
  return JSON.stringify(path);
}

function syncTitlePathDisplay(modalEl) {
  const titleEl = modalEl.querySelector("[data-modal-title]");
  const actionsEl = modalEl.querySelector("[data-modal-actions]");
  const pathBtn = modalEl.querySelector("[data-action='copyFullPath']");
  if (!titleEl || !actionsEl || !pathBtn) return;

  const fullPath = String(pathBtn.dataset.fullPath || "");
  const headerEl = titleEl.closest(".modal-header");
  if (!headerEl) return;

  const headerWidth = headerEl.clientWidth;
  const actionsWidth = actionsEl.getBoundingClientRect().width;
  const available = headerWidth - actionsWidth - 24;

  if (available < 220) {
    pathBtn.textContent = "…";
  } else {
    pathBtn.textContent = fullPath;
  }
}

/**
 * @typedef {Object} Layer
 * @property {string} title
 * @property {string} fullPath
 * @property {number} parentLayerIndex
 * @property {Array<string|number>} parentKeyPath
 * @property {any} parsedValue
 * @property {"view"|"edit"} mode
 * @property {string} editorText
 */

export function createLayerStack({
  overlayEl,
  modalStackEl,
  toast,
  contextMenu,
  getRootValue,
  setRootValue,
  onRootRendered,
  diffOverlay
}) {
  /** @type {Layer[]} */
  const layers = [];

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

  function enterLayerEditMode(modalEl, layerIndex, scrollSync) {
    const current = layers[layerIndex];
    if (!current) return;
    current.mode = "edit";
    current.editorText = stringifyPretty(current.parsedValue);
    renderModal(modalEl, layerIndex);

    setTimeout(() => {
      const nextBodyEl = modalEl.querySelector("[data-modal-body]");
      if (!nextBodyEl) return;
      const editor = nextBodyEl.querySelector("textarea");
      const highlight = nextBodyEl.querySelector(".editor-highlight");
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

  async function copyValue(value, { compact } = {}) {
    const text = stringifyValueForClipboard(value, { compact });
    const ok = await copyText(text);
    toast.show(ok ? "已复制" : "复制失败");
  }

  function saveLayerFromEditor(idx, modalEl) {
    const current = layers[idx];
    if (!current) return false;
    const editor = modalEl.querySelector("textarea");
    const scrollRatio = editor ? getScrollRatio(editor) : 0;
    const nextText = editor ? editor.value : "";
    const parsed = safeJsonParse(nextText);
    if (!parsed.ok) {
      toast.show("JSON 解析失败");
      return true;
    }

    current.parsedValue = parsed.value;
    current.mode = "view";
    current.editorText = "";

    closeAfter(idx);
    syncUpFrom(idx);
    onRootRendered();
    for (let i = 0; i < layers.length; i += 1) {
      const modal = modalStackEl.children[i];
      if (modal) renderModal(modal, i);
    }
    window.requestAnimationFrame(() => {
      const bodyEl = modalEl.querySelector("[data-modal-body]");
      if (!bodyEl) return;
      const max = bodyEl.scrollHeight - bodyEl.clientHeight;
      bodyEl.scrollTop = max > 0 ? max * scrollRatio : 0;
    });
    toast.show("已保存");
    return true;
  }

  function updateOverlayVisibility() {
    const open = layers.length > 0;
    overlayEl.classList.toggle("open", open);
    overlayEl.setAttribute("aria-hidden", open ? "false" : "true");
  }

  function closeAll() {
    layers.splice(0, layers.length);
    modalStackEl.innerHTML = "";
    updateOverlayVisibility();
  }

  function closeAfter(index) {
    while (layers.length - 1 > index) {
      layers.pop();
      const lastModal = modalStackEl.lastElementChild;
      if (lastModal) lastModal.remove();
    }
    updateOverlayVisibility();
  }

  function closeTop() {
    if (!layers.length) return;
    layers.pop();
    const lastModal = modalStackEl.lastElementChild;
    if (lastModal) lastModal.remove();
    updateOverlayVisibility();
  }

  function syncUpFrom(layerIndex) {
    let root = getRootValue();
    for (let i = layerIndex; i >= 0; i -= 1) {
      const layer = layers[i];
      const parent = layer.parentLayerIndex === -1 ? root : layers[layer.parentLayerIndex].parsedValue;
      const nextValue = layer.kind === "parse" ? JSON.stringify(layer.parsedValue) : layer.parsedValue;
      if (!layer.parentKeyPath.length) {
        if (layer.parentLayerIndex === -1) {
          root = nextValue;
        } else {
          layers[layer.parentLayerIndex].parsedValue = nextValue;
        }
        continue;
      }
      setAtPath(parent, layer.parentKeyPath, nextValue);
    }
    setRootValue(root);
  }

  function renderModal(modalEl, layerIndex) {
    const layer = layers[layerIndex];
    if (!layer) return;

    modalEl.dataset.layerIndex = String(layerIndex);
    modalEl.style.zIndex = String(100 + layerIndex + 1);

    const titleEl = modalEl.querySelector("[data-modal-title]");
    if (titleEl) {
      titleEl.innerHTML = "";
      const prefix = document.createElement("span");
      const verb = layer.kind === "parse" ? "解析" : "编辑";
      prefix.textContent = `第 ${layerIndex + 1} 层${verb} -`;
      const pathBtn = document.createElement("button");
      pathBtn.type = "button";
      pathBtn.className = "modal-title-path";
      pathBtn.dataset.action = "copyFullPath";
      pathBtn.dataset.fullPath = layer.fullPath;
      pathBtn.textContent = layer.fullPath;
      pathBtn.title = layer.fullPath;
      titleEl.appendChild(prefix);
      titleEl.appendChild(pathBtn);
    }

    const actionsEl = modalEl.querySelector("[data-modal-actions]");
    if (actionsEl) {
      actionsEl.innerHTML = "";

      if (layer.mode === "view") {
        const copyBtn = document.createElement("button");
        copyBtn.className = "btn";
        copyBtn.type = "button";
        copyBtn.dataset.action = "copy";
        copyBtn.textContent = "📋 复制";
        actionsEl.appendChild(copyBtn);

        const copyCompactBtn = document.createElement("button");
        copyCompactBtn.className = "btn";
        copyCompactBtn.type = "button";
        copyCompactBtn.dataset.action = "copyCompact";
        copyCompactBtn.textContent = "📦 压缩复制";
        actionsEl.appendChild(copyCompactBtn);

        const editBtn = document.createElement("button");
        editBtn.className = "btn";
        editBtn.type = "button";
        editBtn.dataset.action = "edit";
        editBtn.textContent = "✏️ 编辑";
        actionsEl.appendChild(editBtn);
      } else {
        const saveBtn = document.createElement("button");
        saveBtn.className = "btn primary";
        saveBtn.type = "button";
        saveBtn.dataset.action = "save";
        saveBtn.textContent = "✅ 保存";
        actionsEl.appendChild(saveBtn);

        const diffBtn = document.createElement("button");
        diffBtn.className = "btn";
        diffBtn.type = "button";
        diffBtn.dataset.action = "diff";
        diffBtn.textContent = "🔍 Diff";
        actionsEl.appendChild(diffBtn);

        const cancelBtn = document.createElement("button");
        cancelBtn.className = "btn";
        cancelBtn.type = "button";
        cancelBtn.dataset.action = "cancel";
        cancelBtn.textContent = "↩️ 取消";
        actionsEl.appendChild(cancelBtn);
      }

      const closeBtn = document.createElement("button");
      closeBtn.className = "close";
      closeBtn.type = "button";
      closeBtn.dataset.action = "close";
      closeBtn.setAttribute("aria-label", "关闭");
      closeBtn.textContent = "×";
      actionsEl.appendChild(closeBtn);
    }

    window.requestAnimationFrame(() => syncTitlePathDisplay(modalEl));

    const bodyEl = modalEl.querySelector("[data-modal-body]");
    if (!bodyEl) return;
    bodyEl.innerHTML = "";

    if (layer.mode === "edit") {
      const wrap = document.createElement("div");
      wrap.className = "editor-wrap";

      const highlight = document.createElement("pre");
      highlight.className = "editor-highlight";
      highlight.setAttribute("aria-hidden", "true");

      const editor = document.createElement("textarea");
      editor.className = "editor-input";
      editor.spellcheck = false;
      editor.setAttribute("wrap", "off");
      editor.value = layer.editorText;

      wrap.appendChild(highlight);
      wrap.appendChild(editor);
      bodyEl.appendChild(wrap);
      bindJsonHighlight({ textareaEl: editor, highlightEl: highlight });
      return;
    }

    bodyEl.innerHTML = renderJson(layer.parsedValue, [], 0, { collapsedPaths: layer.collapsedPaths });
  }

  function buildModal(layerIndex) {
    const layer = layers[layerIndex];
    const modalEl = document.createElement("div");
    modalEl.className = "modal";
    modalEl.innerHTML = `
      <div class="modal-header">
        <div class="modal-title" data-modal-title>${escapeHtml(layer.title)}</div>
        <div class="modal-actions" data-modal-actions></div>
      </div>
      <div class="modal-body" data-modal-body></div>
    `;

    modalEl.addEventListener("click", async (e) => {
      const actionEl = e.target.closest("[data-action]");
      if (actionEl) {
        e.stopPropagation();
        const idx = Number(modalEl.dataset.layerIndex);
        const current = layers[idx];
        if (!current) return;

        const action = actionEl.dataset.action;
        if (action === "copyFullPath") {
          const ok = await copyText(current.fullPath);
          toast.show(ok ? "已复制" : "复制失败");
          return;
        }
        if (action === "toggle") {
          try {
            const path = JSON.parse(actionEl.dataset.path);
            const targetValue = getAtPath(current.parsedValue, path);
            const collapsible = targetValue !== null && typeof targetValue === "object";
            if (!collapsible) return;
            const key = getPathKey(path);
            if (current.collapsedPaths.has(key)) {
              current.collapsedPaths.delete(key);
            } else {
              current.collapsedPaths.add(key);
            }
            renderModal(modalEl, idx);
          } catch {}
          return;
        }

        if (action === "close") {
          closeTop();
          return;
        }

        if (action === "edit") {
          const bodyEl = modalEl.querySelector("[data-modal-body]");
          const scrollRatio = bodyEl ? getScrollRatio(bodyEl) : 0;
          enterLayerEditMode(modalEl, idx, { mode: "ratio", value: scrollRatio });
          return;
        }

        if (action === "copy") {
          await copyValue(current.parsedValue, { compact: false });
          return;
        }

        if (action === "copyCompact") {
          await copyValue(current.parsedValue, { compact: true });
          return;
        }

        if (action === "cancel") {
          current.mode = "view";
          current.editorText = "";
          renderModal(modalEl, idx);
          return;
        }

        if (action === "diff") {
          if (!diffOverlay) return;
          const editor = modalEl.querySelector("textarea");
          if (!editor) return;
          const title = `第 ${idx + 1} 层 Diff - ${current.fullPath}`;
          diffOverlay.open({ title, baseText: stringifyPretty(current.parsedValue), nextText: editor.value || "" });
          return;
        }

        if (action === "save") {
          saveLayerFromEditor(idx, modalEl);
          return;
        }
      }

      const path = parseDataPathFromEventTarget(e.target);
      if (!path) return;
      const idx = Number(modalEl.dataset.layerIndex);
      openLayerFrom(idx, path);
    });

    modalEl.addEventListener("contextmenu", (e) => {
      const valueEl = e.target.closest('[data-role="value"]');
      if (valueEl) {
        let path = null;
        try {
          path = JSON.parse(valueEl.dataset.path);
        } catch {
          path = null;
        }
        if (!path) return;

        const idx = Number(modalEl.dataset.layerIndex);
        const current = layers[idx];
        if (!current) return;

        const value = getAtPath(current.parsedValue, path);
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
      const idx = Number(modalEl.dataset.layerIndex);
      const current = layers[idx];
      if (!current) return;
      let path = null;
      try {
        path = JSON.parse(keyEl.dataset.path);
      } catch {
        path = null;
      }
      if (!path) return;
      const value = getAtPath(current.parsedValue, path);
      contextMenu.show({
        x: e.clientX,
        y: e.clientY,
        items: [
          { label: "📋 复制", onSelect: () => copyValue(value, { compact: false }) },
          { label: "📦 压缩复制", onSelect: () => copyValue(value, { compact: true }) },
          { label: "✏️ 编辑", onSelect: () => openValueEditorFrom(idx, path) }
        ]
      });
    });

    modalEl.addEventListener("dblclick", (e) => {
      const idx = Number(modalEl.dataset.layerIndex);
      const current = layers[idx];
      if (!current) return;

      if (current.mode === "edit") {
        const editor = e.target.closest("textarea");
        if (!editor) return;
        setTimeout(() => {
          const text = editor.value || "";
          const start = editor.selectionStart;
          const end = editor.selectionEnd;
          if (!isBlankAreaDblClick(text, start, end)) return;
          saveLayerFromEditor(idx, modalEl);
        }, 0);
        return;
      }

      const bodyEl = e.target.closest("[data-modal-body]");
      if (bodyEl && !e.target.closest('.k, [data-role="value"], .expander, [data-action]')) {
        const anchor = getScrollAnchorFromEvent(bodyEl, e);
        enterLayerEditMode(modalEl, idx, { mode: "anchor", ratio: anchor.ratio, offsetY: anchor.offsetY });
        return;
      }

      const keyEl = e.target.closest('.k[data-collapsible="1"]');
      if (!keyEl) return;
      try {
        const path = JSON.parse(keyEl.dataset.path);
        const targetValue = getAtPath(current.parsedValue, path);
        const collapsible = targetValue !== null && typeof targetValue === "object";
        if (!collapsible) return;
        const key = getPathKey(path);
        if (current.collapsedPaths.has(key)) {
          current.collapsedPaths.delete(key);
        } else {
          current.collapsedPaths.add(key);
        }
        renderModal(modalEl, idx);
      } catch {}
    });

    renderModal(modalEl, layerIndex);
    return modalEl;
  }

  function openLayerFrom(parentLayerIndex, relPath) {
    const base = parentLayerIndex === -1 ? getRootValue() : layers[parentLayerIndex].parsedValue;
    const raw = getAtPath(base, relPath);
    if (!isJsonString(raw)) {
      toast.show("不可解析");
      return;
    }

    const parsed = safeJsonParse(String(raw).trim());
    if (!parsed.ok) {
      toast.show("不可解析");
      return;
    }

    const level = layers.length + 1;
    const parentFullPath = parentLayerIndex === -1 ? "" : layers[parentLayerIndex].fullPath;
    const fullPath = joinFullPath(parentFullPath, relPath);

    layers.push({
      title: `第 ${level} 层解析 - ${fullPath}`,
      fullPath,
      parentLayerIndex,
      parentKeyPath: relPath,
      kind: "parse",
      parsedValue: parsed.value,
      mode: "view",
      editorText: "",
      collapsedPaths: new Set()
    });

    const modalEl = buildModal(layers.length - 1);
    modalStackEl.appendChild(modalEl);
    updateOverlayVisibility();
  }

  function openValueEditorFrom(parentLayerIndex, relPath) {
    const base = parentLayerIndex === -1 ? getRootValue() : layers[parentLayerIndex].parsedValue;
    if (base == null) {
      toast.show("JSON 解析失败");
      return;
    }
    const value = getAtPath(base, relPath);
    const editorText = typeof value === "undefined" ? "null" : stringifyPretty(value);

    const level = layers.length + 1;
    const parentFullPath = parentLayerIndex === -1 ? "" : layers[parentLayerIndex].fullPath;
    const fullPath = joinFullPath(parentFullPath, relPath);

    layers.push({
      title: `第 ${level} 层编辑 - ${fullPath}`,
      fullPath,
      parentLayerIndex,
      parentKeyPath: relPath,
      kind: "value",
      parsedValue: value,
      mode: "edit",
      editorText,
      collapsedPaths: new Set()
    });

    const modalEl = buildModal(layers.length - 1);
    modalStackEl.appendChild(modalEl);
    updateOverlayVisibility();
  }

  overlayEl.addEventListener("click", (e) => {
    if (e.target !== overlayEl) return;
    closeTop();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!layers.length) return;

    const idx = layers.length - 1;
    const current = layers[idx];
    if (current && current.mode === "edit") {
      current.mode = "view";
      current.editorText = "";
      if (diffOverlay) diffOverlay.close();
      const modalEl = modalStackEl.lastElementChild;
      if (modalEl) renderModal(modalEl, idx);
      e.preventDefault();
      return;
    }
    closeTop();
  });

  window.addEventListener("resize", () => {
    for (let i = 0; i < modalStackEl.children.length; i += 1) {
      const modalEl = modalStackEl.children[i];
      if (modalEl) syncTitlePathDisplay(modalEl);
    }
  });

  return {
    closeAll,
    cancelTopIfEditing() {
      if (!layers.length) return false;
      const idx = layers.length - 1;
      const current = layers[idx];
      if (!current || current.mode !== "edit") return false;
      current.mode = "view";
      current.editorText = "";
      if (diffOverlay) diffOverlay.close();
      const modalEl = modalStackEl.lastElementChild;
      if (modalEl) renderModal(modalEl, idx);
      return true;
    },
    saveTopIfEditing() {
      if (!layers.length) return false;
      const idx = layers.length - 1;
      const current = layers[idx];
      if (!current || current.mode !== "edit") return false;
      const modalEl = modalStackEl.lastElementChild;
      if (!modalEl) return false;
      return saveLayerFromEditor(idx, modalEl);
    },
    async copyTopJson() {
      if (!layers.length) return false;
      const idx = layers.length - 1;
      const current = layers[idx];
      if (!current) return false;

      if (current.mode === "edit") {
        const modalEl = modalStackEl.lastElementChild;
        const editor = modalEl ? modalEl.querySelector("textarea") : null;
        const nextText = editor ? editor.value : "";
        const parsed = safeJsonParse(nextText);
        if (!parsed.ok) {
          toast.show("JSON 解析失败");
          return true;
        }
        await copyValue(parsed.value, { compact: false });
        return true;
      }

      await copyValue(current.parsedValue, { compact: false });
      return true;
    },
    openFromRoot(path) {
      openLayerFrom(-1, path);
    },
    openFromLayer(parentLayerIndex, path) {
      openLayerFrom(parentLayerIndex, path);
    },
    editFromRoot(path) {
      openValueEditorFrom(-1, path);
    },
    editFromLayer(parentLayerIndex, path) {
      openValueEditorFrom(parentLayerIndex, path);
    }
  };
}
