export function createDiffOverlay({ overlayEl, titleEl, closeBtnEl, summaryEl, viewEl }) {
  function setOpen(open) {
    if (!overlayEl) return;
    overlayEl.classList.toggle("open", open);
    overlayEl.setAttribute("aria-hidden", open ? "false" : "true");
    if (!open) {
      if (titleEl) titleEl.textContent = "配置 Diff";
      if (summaryEl) summaryEl.textContent = "";
      if (viewEl) viewEl.innerHTML = "";
    }
  }

  function isOpen() {
    if (!overlayEl) return false;
    return overlayEl.classList.contains("open");
  }

  function splitLines(text) {
    return String(text ?? "").split("\n");
  }

  function myersLineDiff(a, b) {
    const n = a.length;
    const m = b.length;
    const max = n + m;
    /** @type {Map<number, number>} */
    let v = new Map();
    v.set(1, 0);
    /** @type {Array<Map<number, number>>} */
    const trace = [];

    let found = false;
    for (let d = 0; d <= max; d += 1) {
      /** @type {Map<number, number>} */
      const vNext = new Map();
      for (let k = -d; k <= d; k += 2) {
        const vKMinus = v.get(k - 1);
        const vKPlus = v.get(k + 1);

        let x = 0;
        if (k === -d || (k !== d && (vKMinus ?? -1) < (vKPlus ?? -1))) {
          x = vKPlus ?? 0;
        } else {
          x = (vKMinus ?? 0) + 1;
        }
        let y = x - k;
        while (x < n && y < m && a[x] === b[y]) {
          x += 1;
          y += 1;
        }

        vNext.set(k, x);

        if (x >= n && y >= m) {
          found = true;
          break;
        }
      }
      trace.push(vNext);
      v = vNext;
      if (found) break;
    }

    let x = n;
    let y = m;
    /** @type {Array<{type: "context"|"add"|"del", line: string}>} */
    const edits = [];
    for (let d = trace.length - 1; d > 0; d -= 1) {
      const vPrev = trace[d - 1];
      const k = x - y;
      let prevK = 0;
      const prevKMinus = vPrev.get(k - 1);
      const prevKPlus = vPrev.get(k + 1);
      if (k === -d || (k !== d && (prevKMinus ?? -1) < (prevKPlus ?? -1))) {
        prevK = k + 1;
      } else {
        prevK = k - 1;
      }
      const prevX = vPrev.get(prevK) ?? 0;
      const prevY = prevX - prevK;

      while (x > prevX && y > prevY) {
        edits.push({ type: "context", line: a[x - 1] });
        x -= 1;
        y -= 1;
      }

      if (x === prevX) {
        edits.push({ type: "add", line: b[y - 1] });
        y -= 1;
      } else {
        edits.push({ type: "del", line: a[x - 1] });
        x -= 1;
      }
    }

    while (x > 0 && y > 0) {
      edits.push({ type: "context", line: a[x - 1] });
      x -= 1;
      y -= 1;
    }
    while (x > 0) {
      edits.push({ type: "del", line: a[x - 1] });
      x -= 1;
    }
    while (y > 0) {
      edits.push({ type: "add", line: b[y - 1] });
      y -= 1;
    }

    edits.reverse();
    return edits;
  }

  function renderDiff({ baseText, nextText }) {
    if (!viewEl || !summaryEl) return;
    viewEl.innerHTML = "";

    const baseLines = splitLines(baseText);
    const nextLines = splitLines(nextText);

    const tooLarge = baseLines.length + nextLines.length > 20000;
    if (tooLarge) {
      summaryEl.textContent = "内容过大，无法生成 diff";
      return;
    }

    const edits = myersLineDiff(baseLines, nextLines);
    let adds = 0;
    let dels = 0;
    for (const e of edits) {
      if (e.type === "add") adds += 1;
      if (e.type === "del") dels += 1;
    }

    if (adds === 0 && dels === 0) {
      summaryEl.textContent = "无变更";
      return;
    }

    summaryEl.textContent = `+${adds}  -${dels}`;

    const radius = 3;
    const keep = new Array(edits.length).fill(false);
    for (let i = 0; i < edits.length; i += 1) {
      if (edits[i].type === "context") continue;
      const start = Math.max(0, i - radius);
      const end = Math.min(edits.length - 1, i + radius);
      for (let j = start; j <= end; j += 1) keep[j] = true;
    }

    let skipped = false;
    for (let i = 0; i < edits.length; i += 1) {
      if (!keep[i]) {
        if (skipped) continue;
        skipped = true;
        const el = document.createElement("div");
        el.className = "diff-line diff-skip";
        el.textContent = "...";
        viewEl.appendChild(el);
        continue;
      }
      skipped = false;
      const e = edits[i];
      const el = document.createElement("div");
      el.className = `diff-line diff-${e.type}`;
      const prefix = e.type === "add" ? "+ " : e.type === "del" ? "- " : "  ";
      el.textContent = `${prefix}${e.line}`;
      viewEl.appendChild(el);
    }
  }

  function open({ title, baseText, nextText }) {
    if (titleEl) titleEl.textContent = title || "配置 Diff";
    renderDiff({ baseText, nextText });
    setOpen(true);
  }

  function close() {
    setOpen(false);
  }

  if (closeBtnEl) {
    closeBtnEl.addEventListener("click", () => {
      close();
    });
  }

  if (overlayEl) {
    overlayEl.addEventListener("click", (e) => {
      if (e.target !== overlayEl) return;
      close();
    });
  }

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape") return;
      if (!isOpen()) return;
      e.preventDefault();
      e.stopPropagation();
      close();
    },
    true
  );

  return { open, close, isOpen };
}
