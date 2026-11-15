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
  :root{color-scheme:light dark;--bg:#fbfbfa;--ink:#252824;--muted:#535b52;--line:#737b72;--surface:#fff;--action:#273e31;--on-action:#fff;--focus:#076641;--selection:#d7e9dc}
  @media(prefers-color-scheme:dark){:root{--bg:#171c19;--ink:#eef2ec;--muted:#bac5ba;--line:#8c998d;--surface:#202922;--action:#c5e5cb;--on-action:#13231a;--focus:#a4e9bf;--selection:#385c44}
}
  *{box-sizing:border-box}
html{scrollbar-color:var(--line) var(--bg)}
body{margin:0;background:var(--bg);color:var(--ink);font:1rem/1.7 system-ui,'Noto Sans KR',sans-serif;overflow-wrap:anywhere}
main{max-width:74ch;margin:auto;padding:2rem 1.25rem 4rem}
nav{display:flex;gap:1rem;flex-wrap:wrap}
nav a{padding:.5rem 0}
h1{font-size:2rem;line-height:1.25;margin:2rem 0 1rem}
h2{font-size:1.56rem;line-height:1.4;margin:3rem 0 1rem}
h3{font-size:1.25rem;margin:2rem 0 .75rem}
p{margin:.75rem 0}
a{color:var(--focus);text-underline-offset:.2em}
a:hover{text-decoration-thickness:2px}
a:active{opacity:.8}
:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
::selection{background:var(--selection);color:var(--ink)}
section{margin-block:2rem}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{text-align:left;vertical-align:top;padding:.75rem .4rem;border-bottom:1px solid var(--line);overflow-wrap:anywhere}
caption{text-align:left;font-weight:700;padding-block:.75rem}
small,.muted{color:var(--muted)}
label{display:block;margin-top:1.25rem}
input,textarea,select,button,.primary-action{font:inherit;border:1px solid var(--line);border-radius:4px;min-height:44px;padding:.65rem;background:var(--surface);color:var(--ink);caret-color:var(--focus)}
input,textarea,select{width:100%}
textarea{min-height:8rem;resize:vertical}
button,.primary-action{background:var(--action);color:var(--on-action);cursor:pointer;margin-top:1.5rem;padding-inline:1.25rem}
.primary-action{display:inline-flex;align-items:center;justify-content:center;min-width:44px;text-decoration:none}
.secondary-action{background:var(--surface);color:var(--ink)}
button:hover,.primary-action:hover{filter:brightness(1.12)}
button:active,.primary-action:active{filter:brightness(.9)}
button:disabled{opacity:.6;cursor:wait}
.notice{padding:1rem;background:var(--surface)}
dl{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:.75rem}
dd{margin:0;font-variant-numeric:tabular-nums}
li{margin-block:.4rem}
.table-wrap{overflow:auto}
.case-list{max-width:100%;min-width:0}
.case-list table{min-width:40rem}
.case-list th,.case-list td:last-child{white-space:nowrap}
summary{cursor:pointer;min-height:44px;padding:.5rem 0}
footer{margin-top:3rem;border-top:1px solid var(--line);padding-top:1rem}
.print-only{display:none}
@page{size:A4;margin:18mm}
@media print{nav,form,.screen-only{display:none}
.print-only{display:block}
body{background:white;color:#222;font-size:10.5pt;line-height:1.45}
main{max-width:none;padding:0}
h1,h2,h3{break-after:avoid}
h1{font-size:20pt;margin:.75rem 0 .5rem}
h2{font-size:15pt;margin:1.25rem 0 .5rem}
h3{font-size:12pt;margin:.75rem 0 .35rem}
section{margin-block:.75rem}
th,td{padding:.35rem .3rem}
caption{padding-block:.35rem}
ul,ol{margin-block:.4rem}
li{margin-block:.2rem}
dl{gap:.35rem;margin-block:.5rem}
tr{break-inside:avoid}
section[aria-labelledby="priority-heading"] li{break-inside:avoid}
thead{display:table-header-group}
p{margin-block:.5rem;orphans:3;widows:3}
footer{margin-top:.5rem;padding-top:.25rem}
.table-wrap{overflow:visible}
}
  </style></head><body><main><nav aria-label="주 메뉴"><a href="/">사례 입력</a><a href="/demo/normal">합성 비교 데모</a><a href="/demo/held">합성 보류 데모</a><a href="/reference">실자료 현황</a></nav>${body}<footer>Re:Source · 조건부 의사결정 지원. 처리·계약 실행은 별도 인간 검토가 필요합니다.</footer></main></body></html>`;
}
