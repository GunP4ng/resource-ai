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
    const picker = document.querySelector("[data-theme-picker]");
    if (!picker) return;
    picker.value = theme;
    picker.addEventListener("change", () => {
      if (!valid(picker.value)) return;
      theme = picker.value;
      html.dataset.theme = theme;
      try { localStorage.setItem(key, theme); } catch { /* Keep the selection for this page. */ }
    });
    picker.closest("[data-theme-control]").hidden = false;
  }, { once: true });
})();
`;
