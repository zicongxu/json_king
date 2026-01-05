/**
 * 结构化视图渲染：将任意 JSON 值渲染成可点击的 HTML。
 *
 * 约定：
 * - 任何“可 JSON.parse 的 string”都会带上 `.clickable` + `data-path`。
 * - 点击行为由上层（主面板 / modal）统一用事件代理处理。
 */

import { encodeDataPath, escapeHtml } from "./html.js";
import { isJsonString, isPlainObject } from "./json.js";

function renderPrimitive(value) {
  if (value === null) return `<span class="v-null">null</span>`;
  if (typeof value === "string") return `<span class="v-string">\"${escapeHtml(value)}\"</span>`;
  if (typeof value === "number") return `<span class="v-number">${escapeHtml(value)}</span>`;
  if (typeof value === "bigint") return `<span class="v-number">${escapeHtml(value)}</span>`;
  if (typeof value === "boolean") return `<span class="v-bool">${escapeHtml(value)}</span>`;
  return `<span>${escapeHtml(String(value))}</span>`;
}

function renderPrimitiveWithPath(value, path) {
  const dataPath = ` data-role="value" data-path="${encodeDataPath(path)}"`;
  if (value === null) return `<span class="v-null"${dataPath}>null</span>`;
  if (typeof value === "number") return `<span class="v-number"${dataPath}>${escapeHtml(value)}</span>`;
  if (typeof value === "bigint") return `<span class="v-number"${dataPath}>${escapeHtml(value)}</span>`;
  if (typeof value === "boolean") return `<span class="v-bool"${dataPath}>${escapeHtml(value)}</span>`;
  return `<span${dataPath}>${escapeHtml(String(value))}</span>`;
}

function isCollapsible(value) {
  return value !== null && typeof value === "object";
}

function getPathKey(path) {
  return JSON.stringify(path);
}

function renderCollapsedSummary(value) {
  if (Array.isArray(value)) {
    return `<span class="punct">[</span><span class="punct">…</span><span class="punct">]</span><span class="punct"> </span><span class="punct">(${value.length})</span>`;
  }
  if (isPlainObject(value)) {
    return `<span class="punct">{</span><span class="punct">…</span><span class="punct">}</span><span class="punct"> </span><span class="punct">(${Object.keys(value).length})</span>`;
  }
  return renderPrimitive(String(value));
}

function renderKey({ labelHtml, value, path, collapsedPaths }) {
  const isFoldable = isCollapsible(value);
  const collapsed = isFoldable && collapsedPaths && collapsedPaths.has(getPathKey(path));
  const expander = isFoldable
    ? `<span class="expander" data-action="toggle" data-path="${encodeDataPath(path)}">${
        collapsed ? "▶" : "▼"
      }</span>`
    : "";

  const keyAttrs = isFoldable
    ? ` data-collapsible="1" data-path="${encodeDataPath(path)}"`
    : ` data-path="${encodeDataPath(path)}"`;

  return `${expander}<span class="k"${keyAttrs}>${labelHtml}</span>`;
}

export function renderJson(value, path = [], indent = 0, { collapsedPaths } = {}) {
  const pad = " ".repeat(indent);

  if (isCollapsible(value) && collapsedPaths && collapsedPaths.has(getPathKey(path))) {
    return renderCollapsedSummary(value);
  }

  if (typeof value === "string") {
    const display = `\"${escapeHtml(value)}\"`;
    if (isJsonString(value)) {
      return `<span class="tooltip clickable" data-tip="点击解析 JSON" data-path="${encodeDataPath(
        path
      )}" data-role="value">${display}</span>`;
    }
    return `<span class="v-string" data-role="value" data-path="${encodeDataPath(path)}">${display}</span>`;
  }

  if (value === null || typeof value !== "object") {
    return renderPrimitiveWithPath(value, path);
  }

  if (Array.isArray(value)) {
    const lines = [];
    lines.push(`${pad}<span class="punct">[</span>`);
    value.forEach((item, idx) => {
      const comma = idx === value.length - 1 ? "" : `<span class="punct">,</span>`;
      const keyHtml = renderKey({
        labelHtml: String(idx),
        value: item,
        path: [...path, idx],
        collapsedPaths
      });
      lines.push(
        `${pad}  <div class="node">${keyHtml}<span class="punct">:</span> ${renderJson(item, [...path, idx], indent + 2, { collapsedPaths })}${comma}</div>`
      );
    });
    lines.push(`${pad}<span class="punct">]</span>`);
    return lines.join("\n");
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    const lines = [];
    lines.push(`${pad}<span class="punct">{</span>`);
    entries.forEach(([k, v], idx) => {
      const comma = idx === entries.length - 1 ? "" : `<span class="punct">,</span>`;
      const keyHtml = renderKey({
        labelHtml: `\"${escapeHtml(k)}\"`,
        value: v,
        path: [...path, k],
        collapsedPaths
      });
      lines.push(
        `${pad}  <div class="node">${keyHtml}<span class="punct">:</span> ${renderJson(v, [...path, k], indent + 2, { collapsedPaths })}${comma}</div>`
      );
    });
    lines.push(`${pad}<span class="punct">}</span>`);
    return lines.join("\n");
  }

  return renderPrimitive(String(value));
}
