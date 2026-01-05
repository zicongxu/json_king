import { escapeHtml } from "./html.js";

function highlightToHtml(text) {
  const s = String(text ?? "");
  let out = "";
  let i = 0;

  const isDigit = (c) => c >= "0" && c <= "9";
  const isWs = (c) => c === " " || c === "\n" || c === "\r" || c === "\t";

  while (i < s.length) {
    const ch = s[i];

    if (ch === '"') {
      let j = i + 1;
      while (j < s.length) {
        const cj = s[j];
        if (cj === "\\") {
          j += 2;
          continue;
        }
        if (cj === '"') {
          j += 1;
          break;
        }
        j += 1;
      }
      const token = s.slice(i, j);

      let k = j;
      while (k < s.length && isWs(s[k])) k += 1;
      const isKey = s[k] === ":";

      out += `<span class=\"${isKey ? "hl-k" : "hl-s"}\">${escapeHtml(token)}</span>`;
      i = j;
      continue;
    }

    if (ch === "-" || isDigit(ch)) {
      let j = i;
      if (s[j] === "-") j += 1;
      while (j < s.length && isDigit(s[j])) j += 1;
      if (s[j] === ".") {
        j += 1;
        while (j < s.length && isDigit(s[j])) j += 1;
      }
      if (s[j] === "e" || s[j] === "E") {
        j += 1;
        if (s[j] === "+" || s[j] === "-") j += 1;
        while (j < s.length && isDigit(s[j])) j += 1;
      }
      out += `<span class=\"hl-n\">${escapeHtml(s.slice(i, j))}</span>`;
      i = j;
      continue;
    }

    if (s.startsWith("true", i) || s.startsWith("false", i)) {
      const token = s.startsWith("true", i) ? "true" : "false";
      out += `<span class=\"hl-b\">${token}</span>`;
      i += token.length;
      continue;
    }

    if (s.startsWith("null", i)) {
      out += `<span class=\"hl-null\">null</span>`;
      i += 4;
      continue;
    }

    if (ch === "{" || ch === "}" || ch === "[" || ch === "]" || ch === ":" || ch === ",") {
      out += `<span class=\"hl-p\">${escapeHtml(ch)}</span>`;
      i += 1;
      continue;
    }

    out += escapeHtml(ch);
    i += 1;
  }

  return out;
}

export function bindJsonHighlight({ textareaEl, highlightEl }) {
  let rafId = null;
  let lastText = null;

  const syncScroll = () => {
    highlightEl.scrollTop = textareaEl.scrollTop;
    highlightEl.scrollLeft = textareaEl.scrollLeft;
  };

  const render = () => {
    rafId = null;
    const text = textareaEl.value;
    if (text === lastText) return;
    lastText = text;
    highlightEl.innerHTML = highlightToHtml(text) + "\n";
    syncScroll();
  };

  const schedule = () => {
    if (rafId != null) return;
    rafId = window.requestAnimationFrame(render);
  };

  textareaEl.addEventListener("input", schedule);
  textareaEl.addEventListener("scroll", syncScroll);
  window.addEventListener("resize", syncScroll);
  schedule();

  return {
    refresh() {
      schedule();
    }
  };
}

