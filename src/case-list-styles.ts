export const caseListStyles = `
.case-counts{list-style:none;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--s12);margin:var(--s24) 0;padding:0}
.case-counts li{display:flex;align-items:baseline;justify-content:space-between;gap:var(--s8);padding:var(--s16);border:var(--border) solid var(--line);border-radius:var(--radius);background:var(--surface);color:var(--muted)}
.case-counts strong{color:var(--ink);font-variant-numeric:tabular-nums}
.case-filters{display:flex;flex-wrap:wrap;gap:var(--s8);margin-block:var(--s24)}
.case-filters a{display:inline-flex;align-items:center;justify-content:center;min-height:var(--target);padding:var(--s8) var(--s16);border-radius:var(--radius)}
.case-filters a[aria-current="page"]{background:var(--selection);color:var(--ink);font-weight:700;text-decoration:none}
.case-filters a:hover{background:var(--selection);text-decoration:underline}
.case-filters a:active{color:var(--focus)}
.case-table{table-layout:fixed;width:100%;margin-block:var(--s24)}
@media screen and (min-width:769px){
  #case-title{width:38%}
  #case-status{width:14%}
  #case-deadline{width:26%}
  #case-actions{width:22%}
}
.case-table h2{margin:0;font-size:var(--h3);overflow-wrap:anywhere}
.case-badge{display:inline-block;padding:var(--s8) var(--s12);border-radius:var(--radius);font-size:var(--secondary);font-weight:600}
.case-badge-recommendation{background:var(--selection);color:var(--ink)}
.case-badge-information{background:color-mix(in srgb,var(--question) 14%,var(--bg));color:var(--question)}
.case-badge-hold{background:color-mix(in srgb,var(--held) 14%,var(--bg));color:var(--held)}
.case-badge-unknown{background:var(--bg);color:var(--muted)}
.case-card-links{display:flex;flex-wrap:wrap;gap:var(--s8) var(--s16)}
.case-card-links a{display:inline-flex;align-items:center;min-height:var(--target)}
.case-empty{padding:var(--s20);border:var(--border) solid var(--line);border-radius:var(--radius);background:var(--surface)}
@media screen and (max-width:768px){
  .case-counts{grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s8)}
  .case-filters a{flex:1 1 auto}
  .case-table,.case-table tbody{display:block}
  .case-list .case-table thead{display:table-header-group;position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
  .case-table tbody{display:grid;gap:var(--s16)}
  .case-table tr{display:grid;min-width:0;padding:var(--s16);border:var(--border) solid var(--line);border-radius:var(--radius);background:var(--surface)}
  .case-table td{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:var(--s12);min-width:0;padding:var(--s8) 0;border:0}
  .case-table td::before{content:attr(data-label);margin:0;color:var(--muted);font-size:var(--secondary);font-weight:600}
  .case-table td>*{min-width:0}
  .case-table .case-badge{justify-self:start}
}
`;
