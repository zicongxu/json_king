/**
 * 复制文本：优先使用 Clipboard API，不可用时降级到 textarea + execCommand。
 */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const tmp = document.createElement("textarea");
      tmp.value = text;
      tmp.setAttribute("readonly", "true");
      tmp.style.position = "fixed";
      tmp.style.left = "-9999px";
      tmp.style.top = "-9999px";
      document.body.appendChild(tmp);
      tmp.select();
      document.execCommand("copy");
      tmp.remove();
      return true;
    } catch {
      return false;
    }
  }
}

