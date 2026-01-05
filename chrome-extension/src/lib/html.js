/**
 * HTML 转义，防止将 JSON 内容直接注入到 DOM 时造成结构错乱或 XSS。
 */
export function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * 将 path（数组）安全编码到 data-* 属性里。
 */
export function encodeDataPath(path) {
  return escapeHtml(JSON.stringify(path));
}

