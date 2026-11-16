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
export function page(title: string, body: string): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} · Re:Source</title><style>
${reportStyles}  </style><script src="/app-feedback.js" defer></script></head><body><a class="skip-link" href="#content">본문으로 이동</a><nav class="primary-nav" aria-label="주 메뉴"><a href="/">사례 입력</a><a href="/demo/normal">합성 비교 데모</a><a href="/demo/held">합성 추가 정보 데모</a><a href="/reference">실자료 현황</a></nav><main id="content" tabindex="-1">${body}<footer>Re:Source · 조건부 의사결정 지원. 처리·계약 실행은 별도 인간 검토가 필요합니다.</footer></main></body></html>`;
}
