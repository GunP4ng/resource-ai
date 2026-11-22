/** Screen-only composition. The existing report print layout remains authoritative. */
export const resultScreenStyles = `
.mobile-edit-shortcut{display:none}
@media screen{
  main:has(.report-workspace),.primary-nav:has(+main .report-workspace){max-width:var(--workspace-max)}
  .report-workspace{display:block}
  .report-workspace .case-editor{border:0;padding:0;margin-block:var(--s32)}
  .report-workspace .case-editor-body{position:static;max-height:none;overflow:visible;padding:0}
  .report-workspace .case-input-summary>p{display:block;overflow:visible;-webkit-line-clamp:unset}
  .report-workspace .case-input-summary h2{margin-top:0}
  .report-workspace .case-input-summary dl{gap:var(--s8) var(--s12);font-size:var(--secondary)}
  .report-workspace .case-input-summary dt{font-weight:600}
  .result-content,.result-followup{min-inline-size:0}
  .result-content{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--s16)}
  .result-content>*{min-inline-size:0;margin-block:0}
  .result-followup .result-disclosure{margin-top:0}
  .result-report-actions .cluster{align-items:flex-start;flex-direction:column;gap:var(--s8)}
  .result-report-actions .primary-action{margin-top:0}
  .result-content :where(#evidence,#checks,#alternatives){display:block}
  .result-overview{margin-block:var(--s24) var(--s32)}
  .result-overview .state{display:inline-block;margin:0;padding:var(--s8) var(--s12);border-radius:var(--radius);font-size:var(--secondary);line-height:1.3;background:var(--surface)}
  .result-overview .recommended{background:var(--selection)}
  .result-overview h1{margin-block:var(--s16) var(--s12)}
  .result-overview #decision-summary{font-size:var(--h3);line-height:1.5;font-weight:600;margin-block:var(--s12)}
  .result-overview .result-condition,.result-classification{font-size:var(--secondary);color:var(--muted)}
  .result-overview #next-action{margin-top:var(--s24)}
  .result-actions{display:flex;flex-wrap:wrap;align-items:center;gap:var(--s12) var(--s24)}
  .result-actions .primary-action{margin-top:0}
  .result-classification{margin-top:var(--s20)}
  #case-progress{margin-block:var(--s24)}
  #case-progress>h2{font-size:var(--h3);margin-block:var(--s24) var(--s12)}
  .guidance-stages{grid-template-columns:repeat(6,minmax(0,1fr));gap:var(--s12);margin-block:var(--s16)}
  .guidance-stages li{display:grid;align-content:start;grid-template-columns:auto minmax(0,1fr);column-gap:var(--s8);row-gap:var(--s8);border:0;padding:var(--s12) 0}
  .guidance-stages strong{font-size:var(--secondary);line-height:1.5}
  .guidance-stages span{grid-column:2;line-height:1.5}
  .stage-icon{inline-size:var(--s20);block-size:var(--s24);color:var(--action)}
  .result-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--s16);margin-block:var(--s24) var(--s32)}
  .result-metrics article{min-inline-size:0;padding:var(--s20);border-radius:var(--radius);background:var(--surface);border:var(--border) solid var(--line)}
  .result-metrics h2,#commercial-summary .result-metrics h2{font-size:var(--body);margin:0;font-weight:600;line-height:1.5}
  .result-metrics .metric-value{font-size:var(--h2);line-height:1.3;font-weight:700;margin-block:var(--s16);color:var(--action)}
  .metric-value span{font-size:var(--secondary);font-weight:600}
  .result-metrics article>p:not(.metric-value){font-size:var(--secondary);margin-block:var(--s12)}
  .result-metrics a,.result-metrics summary{font-size:var(--secondary)}
  .result-disclosure{margin-block:var(--s16)}
  .result-disclosure>summary{padding-block:var(--s12);font-weight:600;border-bottom:var(--border) solid var(--line)}
}
@media screen and (min-width:960px){
  main:has(.report-workspace),.primary-nav:has(+main .report-workspace){padding-inline:var(--s32)}
  .report-workspace{display:grid;grid-template-columns:minmax(0,1fr) var(--editor-min);grid-template-areas:"results editor" "records editor";column-gap:var(--s32);align-items:start}
  .report-workspace .case-editor{grid-area:editor;margin-block:var(--s24);padding-inline-start:var(--s20);border-inline-start:var(--border) solid var(--line)}
  .report-results{grid-area:results}
  .report-records{grid-area:records}
  .result-content{grid-template-columns:repeat(2,minmax(0,1fr));column-gap:var(--s24);align-items:start}
  .result-content>*{grid-column:1/-1}
  .result-content>#result-sources{grid-column:1;grid-row:1}
  .result-content>#result-checks{grid-column:1;grid-row:2}
  .result-content>.result-followup{grid-column:2;grid-row:1/3}
}
@media screen and (max-width:959px){
  .guidance-stages{grid-template-columns:minmax(0,1fr)}
  .guidance-stages li{grid-template-columns:auto minmax(0,1fr) auto}
  .guidance-stages span{grid-column:3}
  .result-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media screen and (max-width:600px){
  .guidance-stages li{grid-template-columns:auto minmax(0,1fr)}
  .guidance-stages span{grid-column:2}
  .result-metrics{grid-template-columns:minmax(0,1fr)}
  .result-overview #decision-summary{font-size:var(--h3)}
}
@media screen and (max-width:820px){
  .result-actions .mobile-edit-shortcut{display:inline-flex}
}
`;
