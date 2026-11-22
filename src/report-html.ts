import { reportStyles } from "./report-styles.ts";

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
export function page(title: string, body: string, layout: "document" | "workspace" | "commercial" = "document", footer = reportFooter): string {
  const layoutClass = layout === "workspace" ? "workspace-shell" : layout === "commercial" ? "commercial-shell" : "";
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} · Re:Source</title><style>
${reportStyles}  </style><script src="/app-feedback.js" defer></script></head><body><a class="skip-link" href="#content">본문으로 이동</a><header class="site-header screen-only"><div class="site-header-inner">
  <a class="site-brand" href="/">Re:Source AI</a>
  <button type="button" class="site-menu-toggle" data-menu-toggle aria-controls="site-menu" aria-expanded="true" hidden><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg><span>메뉴</span></button>
  <nav id="site-menu" class="primary-nav" aria-label="주 메뉴"><a href="/#case-intake">새 검토</a><a href="/cases">내 사례</a><a href="/help">도움말</a></nav>
</div></header><main id="content" class="site-content ${layoutClass}" tabindex="-1">${body}${footer}</main></body></html>`;
}
