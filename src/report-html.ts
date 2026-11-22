import { reportStyles } from "./report-styles.ts";
import { themePath } from "./app-theme.ts";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}
export function safeLink(value: string): string | null {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && url.username === "" && url.password === "" ? escapeHtml(url.href) : null;
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}
export const list = (items: readonly string[]): string => `<ul>${items.map((v) => `<li>${escapeHtml(v)}</li>`).join("")}</ul>`;
export const reportFooter = "<footer>Re:Source · 폐자원 처리 의사결정 지원. 처리·계약은 현장 담당자 승인 후 실행하세요.</footer>";
const themeOptions = [
  ["system", "시스템", '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>'],
  ["light", "라이트", '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>'],
  ["dark", "다크", '<path d="M20.9 13.4A9 9 0 0 1 10.6 3.1a9 9 0 1 0 10.3 10.3Z"/>'],
] as const;
const themeControl = `<div class="theme-control" data-theme-control role="radiogroup" aria-label="화면 테마" hidden>${themeOptions.map(([value, label, icon]) =>
  `<label class="theme-segment"><input type="radio" name="screen-theme" value="${value}" aria-label="${label}"><span class="theme-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icon}</svg></span><span class="theme-tooltip" aria-hidden="true">${label}</span></label>`
).join("")}</div>`;

export function page(title: string, body: string, layout: "document" | "workspace" | "commercial" = "document", footer = reportFooter): string {
  const layoutClass = layout === "workspace" ? "workspace-shell" : layout === "commercial" ? "commercial-shell" : "";
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} · Re:Source</title><script src="${themePath}"></script><style>
${reportStyles}  </style><script src="/app-feedback.js" defer></script></head><body><a class="skip-link" href="#content">본문으로 이동</a><header class="site-header screen-only"><div class="site-header-inner">
  <a class="site-brand" href="/">Re:Source AI</a>
  <button type="button" class="site-menu-toggle" data-menu-toggle aria-controls="site-menu" aria-expanded="true" hidden><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg><span>메뉴</span></button>
  <div id="site-menu" class="site-menu"><nav class="primary-nav" aria-label="주 메뉴"><a href="/#case-intake">새 검토</a><a href="/cases">내 사례</a><a href="/help">도움말</a></nav>${themeControl}</div>
</div></header><main id="content" class="site-content ${layoutClass}" tabindex="-1">${body}${footer}</main></body></html>`;
}
