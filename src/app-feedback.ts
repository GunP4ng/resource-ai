/** Progressive enhancement: native POST and field serialization stay native. */
export const feedbackPath = "/app-feedback.js";
export const feedbackScript = `"use strict";
(() => {
  const openedForPrint = new Set();
  window.addEventListener("beforeprint", () => {
    for (const detail of document.querySelectorAll("details")) {
      if (!detail.open) {
        openedForPrint.add(detail);
        detail.open = true;
      }
    }
  });
  window.addEventListener("afterprint", () => {
    for (const detail of openedForPrint) detail.open = false;
    openedForPrint.clear();
  });
  window.addEventListener("click", event => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest('button[type="button"][data-inquiry-print]');
    if (button && button.closest("[data-inquiry-sheet]")) window.print();
  });
  const pending = new WeakSet();
  const forms = [...document.querySelectorAll('form[method="post"]')];
  const reset = form => {
    pending.delete(form);
    form.removeAttribute("aria-busy");
    for (const button of form.querySelectorAll('[type="submit"]')) button.removeAttribute("aria-disabled");
    const status = form.querySelector(".form-status");
    if (status) status.textContent = "";
  };
  for (const form of forms) {
    const status = document.createElement("p");
    status.className = "form-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    form.append(status);
    form.addEventListener("submit", event => {
      if (event.defaultPrevented) return;
      if (pending.has(form)) {
        event.preventDefault();
        return;
      }
      pending.add(form);
      form.setAttribute("aria-busy", "true");
      status.textContent = "처리 중입니다. 완료되면 결과 화면으로 이동합니다.";
      for (const button of form.querySelectorAll('[type="submit"]')) button.setAttribute("aria-disabled", "true");
    });
  }
  window.addEventListener("pageshow", () => {
    for (const form of forms) reset(form);
  });
})();
`;
