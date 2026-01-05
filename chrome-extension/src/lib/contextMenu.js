export function createContextMenu() {
  const el = document.createElement("div");
  el.className = "context-menu";
  el.setAttribute("role", "menu");
  el.style.display = "none";
  document.body.appendChild(el);

  let open = false;

  function hide() {
    if (!open) return;
    open = false;
    el.style.display = "none";
    el.innerHTML = "";
  }

  function show({ x, y, items }) {
    el.innerHTML = "";
    for (const item of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "context-menu-item";
      btn.textContent = item.label;
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        hide();
        await item.onSelect();
      });
      el.appendChild(btn);
    }

    el.style.display = "block";
    el.style.left = "0px";
    el.style.top = "0px";

    const margin = 8;
    const rect = el.getBoundingClientRect();
    const maxX = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxY = Math.max(margin, window.innerHeight - rect.height - margin);
    const left = Math.min(Math.max(margin, x), maxX);
    const top = Math.min(Math.max(margin, y), maxY);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;

    open = true;
  }

  document.addEventListener(
    "click",
    (e) => {
      if (!open) return;
      if (e.target && el.contains(e.target)) return;
      hide();
    },
    true
  );

  document.addEventListener("keydown", (e) => {
    if (!open) return;
    if (e.key !== "Escape") return;
    hide();
  });

  window.addEventListener("blur", hide);
  window.addEventListener("resize", hide);
  window.addEventListener("scroll", hide, true);

  return {
    show,
    hide
  };
}

