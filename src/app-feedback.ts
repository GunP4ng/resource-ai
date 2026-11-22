import { intakeScript } from "./intake-client.ts";

/** Progressive enhancement: native POST and field serialization stay native. */
export const feedbackPath = "/app-feedback.js";
export const feedbackScript = `"use strict";
(() => {
${intakeScript}
  const loginForm = document.querySelector?.("[data-login-form]");
  if (loginForm) {
    const password = loginForm.querySelector("#password");
    const toggle = loginForm.querySelector("[data-password-toggle]");
    if (password && toggle) {
      const showPassword = visible => {
        password.type = visible ? "text" : "password";
        toggle.textContent = visible ? "숨김" : "표시";
        toggle.setAttribute("aria-label", visible ? "비밀번호 숨김" : "비밀번호 표시");
      };
      toggle.hidden = false;
      toggle.addEventListener("click", () => showPassword(password.type === "password"));
      loginForm.addEventListener("submit", () => showPassword(false));
      window.addEventListener("pageshow", () => showPassword(false));
    }
    loginForm.querySelector("[role=alert]")?.focus();
  }
  const menu = document.querySelector?.("[data-menu-toggle]");
  if (menu) {
    menu.hidden = false;
    menu.setAttribute("aria-expanded", "false");
    menu.addEventListener("click", () => {
      menu.setAttribute("aria-expanded", String(menu.getAttribute("aria-expanded") !== "true"));
    });
    menu.closest("header").addEventListener("keydown", event => {
      if (event.key === "Escape" && menu.getAttribute("aria-expanded") === "true") {
        menu.setAttribute("aria-expanded", "false");
        menu.focus();
      }
    });
  }
  const revealLinkedDetail = () => {
    let target;
    if (!globalThis.location?.hash) return;
    try { target = document.getElementById(decodeURIComponent(location.hash.slice(1))); } catch { return; }
    if (!target) return;
    let detail = target.closest("details");
    if (!detail) return;
    while (detail) {
      detail.open = true;
      detail = detail.parentElement?.closest("details");
    }
    if (typeof target.scrollIntoView === "function") target.scrollIntoView();
  };
  window.addEventListener("hashchange", revealLinkedDetail);
  revealLinkedDetail();
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
    reviewReset.get(form)?.();
    reviewReset.delete(form);
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
      status.textContent = form.hasAttribute("data-login-form") ? "로그인 중입니다." : "검토 중입니다. 끝나면 결과 화면으로 이동합니다.";
      for (const button of form.querySelectorAll('[type="submit"]')) button.setAttribute("aria-disabled", "true");
      if (form.hasAttribute("data-intake-form")) beginReview(form, status);
    });
  }
  window.addEventListener("pageshow", () => {
    for (const form of forms) reset(form);
  });
})();
`;
