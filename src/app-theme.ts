export const themePath = "/app-theme.js";

export const themeScript = `"use strict";
(() => {
  const key = "resource-ai-theme";
  const html = document.documentElement;
  const valid = value => value === "light" || value === "dark" || value === "system";
  let theme = "system";
  try {
    const saved = localStorage.getItem(key);
    if (valid(saved)) theme = saved;
  } catch { /* Storage may be unavailable; the OS preference still works. */ }
  html.dataset.theme = theme;

  document.addEventListener("DOMContentLoaded", () => {
    const control = document.querySelector("[data-theme-control]");
    if (!control) return;
    const selected = control.querySelector('input[value="' + theme + '"]');
    if (selected) selected.checked = true;
    control.addEventListener("change", event => {
      const choice = event.target;
      if (!(choice instanceof HTMLInputElement) || !choice.checked || !valid(choice.value)) return;
      theme = choice.value;
      html.dataset.theme = theme;
      try { localStorage.setItem(key, theme); } catch { /* Keep the selection for this page. */ }
    });
    control.hidden = false;
  }, { once: true });
})();
`;
