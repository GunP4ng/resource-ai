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

/** Reading layer loaded after the theme tokens: one column of evenly spaced cards with clearly expandable sections. */
export const resultReadabilityStyles = `
@media screen{
  .report-results :is(h2){font-size:var(--h3);margin-block:var(--s24) var(--s12)}
  .report-results :is(h3){font-size:18px;margin-block:var(--s20) var(--s8)}
  .report-results :is(p,li,dd,blockquote),.report-records :is(p,li,dd){max-inline-size:70ch}
  .result-overview,#case-reasons,#case-progress,.result-content>section,.result-report-actions,.report-workspace .case-editor-body{
    background:var(--raised);border-radius:var(--radius);box-shadow:var(--elevation);padding:var(--s24)
  }
  :is(.result-overview,#case-reasons,#case-progress,.result-content>section,.result-report-actions)>:first-child{margin-block-start:0}
  :is(.result-overview,#case-reasons,#case-progress,.result-content>section,.result-report-actions)>:last-child{margin-block-end:0}
  .result-overview,#case-reasons,#case-progress,.result-metrics{margin-block:var(--s16)}
  .result-overview{margin-block-start:var(--s24)}
  .result-overview h1{font-size:clamp(28px,3vw,36px)}
  .result-overview #decision-summary{font-size:20px;line-height:1.5}
  .result-overview .result-condition,.result-classification{font-size:var(--secondary);color:var(--muted)}
  .result-overview #next-action{margin-block:var(--s20) var(--s16);padding:var(--s12) var(--s16);background:var(--selection);border-radius:var(--button-radius);font-size:17px}
  .result-classification{margin-block:var(--s16) 0}
  #case-reasons li{margin-block:var(--s12)}
  .detected-hazard-terms{padding:var(--s8) var(--s12);background:var(--held-bg);color:var(--held);border-radius:var(--button-radius)}
  .result-metrics article{padding:var(--s20)}
  .result-metrics h2,#commercial-summary .result-metrics h2{font-size:var(--body);margin:0}
  .report-results .notice{max-inline-size:none}
  .result-content .result-disclosure{margin-block:0}
  .result-metrics .metric-value,.result-metrics .metric-value:not(:has(span)){margin-block:var(--s8)}
  .result-metrics article>p:not(.metric-value){font-size:var(--secondary);line-height:1.6}
  .result-content{grid-template-columns:minmax(0,1fr);gap:var(--s16)}
  .result-content>*,.result-content>#result-sources,.result-content>#result-checks,.result-content>.result-followup{grid-column:1;grid-row:auto}
  .result-followup{display:grid;gap:var(--s16)}
  .result-followup>*{margin-block:0}
  .result-report-actions{display:flex;flex-wrap:wrap;align-items:center;gap:var(--s8) var(--s12)}
  .result-report-actions h2{flex-basis:100%;font-size:var(--body);margin:0 0 var(--s8)}
  .result-report-actions p,.result-report-actions .cluster{display:contents}
  .result-report-actions a{min-height:var(--target);margin:0;padding:var(--s8) var(--s16);border:1px solid var(--line);border-radius:var(--button-radius);background:var(--quiet);color:var(--ink);font-weight:600;text-decoration:none}
  .result-report-actions a:hover{background:var(--selection);color:var(--focus)}
  .site-content details{background:var(--raised);border:1px solid var(--line);border-radius:var(--radius);padding-inline:var(--s16)}
  .site-content details>summary{display:flex;align-items:center;justify-content:space-between;gap:var(--s12);list-style:none;margin-inline:calc(-1 * var(--s16));padding:var(--s12) var(--s16);border:0;border-radius:var(--radius);font-weight:650}
  .site-content details>summary::-webkit-details-marker{display:none}
  .site-content details>summary::after{content:"";flex:none;inline-size:9px;block-size:9px;margin-inline:var(--s8) 4px;border:solid var(--muted);border-width:0 2px 2px 0;transform:translateY(-3px) rotate(45deg)}
  .site-content details[open]>summary::after{transform:translateY(2px) rotate(-135deg)}
  .site-content details>summary:hover{background:var(--selection);color:var(--focus)}
  .site-content details[open]{padding-block-end:var(--s16)}
  .site-content details[open]>summary{margin-block-end:var(--s12);border-block-end:1px solid var(--line);border-end-start-radius:0;border-end-end-radius:0}
  .site-content details details{background:var(--quiet);margin-block:var(--s12)}
  .report-records>details,.report-results>details{margin-block:var(--s16)}
  .report-workspace .case-editor{border:0;padding:0}
  .report-workspace .case-editor h2{font-size:var(--h3)}
  .report-workspace .case-editor label{font-weight:600}
  .report-workspace .case-editor .notice{font-size:var(--secondary)}
}
@media screen and (max-width:600px){
  .result-overview,#case-reasons,#case-progress,.result-content>section,.result-report-actions,.report-workspace .case-editor-body{padding:var(--s20)}
  .result-actions .primary-action{width:100%}
  .guidance-stages{grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s8)}
  .result-report-actions a{flex:1 1 calc(50% - var(--s12));justify-content:center;text-align:center}
}
`;
