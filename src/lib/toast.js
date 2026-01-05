/**
 * 统一气泡模块：所有提示复用同一个 DOM + 定时器。
 */
export function createToast(el, { durationMs } = { durationMs: 1200 }) {
  let timer = null;

  function show(message) {
    if (!el) return;
    if (timer) {
      window.clearTimeout(timer);
      timer = null;
    }
    el.textContent = message;
    el.classList.add("show");
    timer = window.setTimeout(() => {
      el.classList.remove("show");
      timer = null;
    }, durationMs);
  }

  return { show };
}

