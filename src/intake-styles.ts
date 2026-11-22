/** Screen-only intake primitives extend DESIGN.md's existing forest palette and spacing scale. */
export const intakeStyles = `
@media screen {
  :root {
    --intake-measure: 1280px;
    --intake-display: 60px;
    --intake-illustration: 64px;
    --intake-textarea: 136px;
  }
  main:has(.intake-form) { max-width: var(--intake-measure); }
  .intake-landing {
    min-height: calc(100dvh - var(--s48));
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--s32);
    margin: 0;
    padding-block: var(--s48);
    text-align: center;
  }
  .intake-landing h1 {
    color: var(--action);
    font-size: var(--intake-display);
    letter-spacing: -.03em;
    margin: 0;
  }
  .intake-landing .primary-action { margin: 0; padding: var(--s16) var(--s32); }
  .intake-panel { margin-block: var(--s32); scroll-margin-block-start: var(--s24); }
  .intake-heading { margin: 0 0 var(--s12); }
  .intake-intro { margin: 0 0 var(--s32); color: var(--muted); }
  .intake-form { width: 100%; }
  .intake-layout { display: grid; grid-template-columns: minmax(0,2fr) minmax(0,1fr); gap: var(--s32); align-items: start; }
  .intake-fields { min-width: 0; display: grid; gap: var(--s48); }
  .intake-section { border: 0; padding: 0; margin: 0; min-inline-size: 0; }
  .intake-section-title { font-size: var(--h2); line-height: 1.3; font-weight: 700; padding: 0; margin-bottom: var(--s24); max-width: 100%; }
  .intake-section>.intake-field:first-of-type,.intake-section>.intake-pair:first-of-type>.intake-field { margin-top: 0; }
  .intake-materials { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: var(--s12); }
  .intake-form .intake-material { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--s8); margin: 0; padding: var(--s16) var(--s8); background: var(--surface); color: var(--action); border-color: var(--line); font-weight: 600; min-width: 0; }
  .intake-material svg { width: var(--intake-illustration); height: var(--intake-illustration); flex: none; }
  .intake-selected { font-size: var(--secondary); visibility: hidden; }
  .intake-material[aria-pressed="true"] { background: var(--selection); }
  .intake-material[aria-pressed="true"] .intake-selected { visibility: visible; }
  .intake-chips { display: flex; gap: var(--s8); flex-wrap: wrap; margin-top: var(--s16); }
  .intake-chips button { margin: 0; max-width: 100%; font-weight: 600; }
  .intake-chips [aria-pressed="true"] { background: var(--selection); color: var(--ink); }
  .intake-field { margin-top: var(--s24); min-width: 0; }
  .intake-field label { margin: 0 0 var(--s8); font-weight: 600; }
  .intake-optional,.intake-required { font-size: var(--secondary); color: var(--muted); font-weight: 400; margin-inline-start: var(--s8); }
  .intake-field textarea { min-height: var(--intake-textarea); }
  .intake-help { margin: var(--s8) 0 0; font-size: var(--secondary); color: var(--muted); }
  .intake-pair { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: var(--s24); align-items: start; }
  .intake-summary { position: sticky; top: var(--s24); min-width: 0; padding: var(--s24); background: var(--surface); border: var(--border) solid var(--line); border-radius: var(--radius); }
  .intake-summary h2 { font-size: var(--h3); margin: 0 0 var(--s20); }
  .intake-summary-values { display: grid; grid-template-columns: minmax(0,1fr); gap: var(--s12); margin: 0; font-size: var(--secondary); }
  .intake-summary-values>div { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1.5fr); gap: var(--s12); align-items: start; }
  .intake-summary-values dt { color: var(--muted); }
  .intake-summary-values dd { min-width: 0; margin: 0; font-weight: 600; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
  .intake-actions { display: grid; gap: var(--s12); margin-top: var(--s24); }
  .intake-actions button { width: 100%; margin: 0; }
  .intake-example-status:empty { display: none; }
  .intake-form button:hover { background: var(--selection); color: var(--ink); }
  .intake-form button:disabled,.intake-form button[aria-disabled="true"] { background: var(--surface); color: var(--muted); cursor: progress; }
  .intake-form :focus-visible,.intake-landing :focus-visible { outline: var(--focus-width) solid var(--focus); outline-offset: var(--focus-offset); }
  .intake-form [hidden],.intake-landing[hidden],.intake-panel[hidden] { display: none; }
}
@media screen and (max-width:959px) {
  .intake-layout { grid-template-columns: minmax(0,1fr); gap: var(--s32); }
  .intake-summary { position: static; }
  .intake-pair { grid-template-columns: minmax(0,1fr); gap: 0; }
  .intake-section>.intake-pair:first-of-type>.intake-field + .intake-field { margin-top: var(--s24); }
  .intake-summary-values>div { grid-template-columns: minmax(0,1fr) minmax(0,2fr); }
  .intake-summary-values dd { display: block; overflow: visible; }
  .intake-actions { grid-template-columns: repeat(2,minmax(0,1fr)); }
}
@media screen and (min-width:960px) and (max-width:1199px) {
  .intake-materials { grid-template-columns: repeat(2,minmax(0,1fr)); }
}
@media screen and (max-height:799px) {
  .intake-summary { position: static; }
}
@media screen and (max-width:600px) {
  .intake-landing h1 { font-size: var(--h2); letter-spacing: 0; }
  .intake-landing { gap: var(--s24); }
  .intake-heading { font-size: var(--h2); }
  .intake-section-title { font-size: var(--h3); }
  .intake-fields { gap: var(--s32); }
  .intake-materials { grid-template-columns: repeat(2,minmax(0,1fr)); }
  .intake-form .intake-material { padding: var(--s12); }
  .intake-material svg { width: var(--s32); height: var(--s32); }
  .intake-summary { padding: var(--s20); }
  .intake-summary-values>div { grid-template-columns: minmax(0,1fr) minmax(0,1.5fr); }
  .intake-actions { grid-template-columns: minmax(0,1fr); }
}
`;
