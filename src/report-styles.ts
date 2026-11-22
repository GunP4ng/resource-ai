import { intakeStyles } from "./intake-styles.ts";
import { caseListStyles } from "./case-list-styles.ts";
import { resultScreenStyles } from "./result-screen-styles.ts";

export const reportStyles = `
:root{color-scheme:light dark;--bg:#fbfbfa;--ink:#252824;--muted:#535b52;--line:#737b72;--surface:#ffffff;--action:#273e31;--on-action:#ffffff;--focus:#076641;--selection:#d7e9dc;--question:#245888;--held:#8a3a16;
--body:17px;--secondary:15px;--h3:22px;--h2:28px;--h1:36px;--s8:8px;--s12:12px;--s16:16px;--s20:20px;--s24:24px;--s32:32px;--s48:48px;--target:44px;--radius:4px;--border:1px;--focus-width:2px;--focus-offset:3px;
--content-measure:68ch;--workspace-max:1760px;--editor-min:320px;--editor-max:400px}
@media(prefers-color-scheme:dark){:root{--bg:#171c19;--ink:#eef2ec;--muted:#bac5ba;--line:#8c998d;--surface:#202922;--action:#c5e5cb;--on-action:#13231a;--focus:#a4e9bf;--selection:#385c44;--question:#a9cff5;--held:#ffd0ac}}
*{box-sizing:border-box}
html{scrollbar-color:var(--line) var(--bg)}
body{margin:0;background:var(--bg);color:var(--ink);font:var(--body)/1.7 system-ui,sans-serif;word-break:keep-all;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
main{max-width:var(--content-measure);margin:auto;padding:0 var(--s20) var(--s48)}
.primary-nav{max-width:var(--content-measure);margin:auto;padding:var(--s32) var(--s20) 0}
nav,.cluster{display:flex;align-items:center;gap:var(--s12) var(--s20);flex-wrap:wrap}
.guidance-stages{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--s12) var(--s16);list-style:none;padding:0}
.guidance-stages li{border-bottom:var(--border) solid var(--line);padding-block:var(--s8);margin:0}
.guidance-stages strong,.guidance-stages span{display:block}
.guidance-stages span{font-size:var(--secondary);color:var(--muted)}
@media(max-width:600px){.guidance-stages{grid-template-columns:repeat(2,minmax(0,1fr))}}
:where(a){display:inline-flex;align-items:center;vertical-align:middle;min-height:var(--target);min-width:var(--target)}
:where(nav a,.cluster a,.source-link){padding:var(--s8) 0}
h1{font-size:var(--h1);line-height:1.3;margin:var(--s24) 0 var(--s16);text-wrap:balance;word-break:keep-all}
h2{font-size:var(--h2);line-height:1.3;margin:var(--s48) 0 var(--s16);text-wrap:balance}
h3{font-size:var(--h3);line-height:1.3;margin:var(--s32) 0 var(--s12)}
h4{font-size:var(--body);font-weight:700}
p{margin:var(--s12) 0}
a{color:var(--focus);text-underline-offset:.2em}
a:hover{text-decoration-thickness:var(--focus-width)}
a:active{text-decoration-style:double}
:focus-visible{outline:var(--focus-width) solid var(--focus);outline-offset:var(--focus-offset)}
::selection{background:var(--selection);color:var(--ink)}
section{margin-block:var(--s32)}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{text-align:left;vertical-align:top;padding:var(--s12) var(--s8);border-bottom:var(--border) solid var(--line);overflow-wrap:anywhere}
caption{text-align:left;font-weight:700;padding-block:var(--s12)}
small,.muted{font-size:var(--secondary);font-weight:600;color:var(--muted)}
label{display:block;margin-top:var(--s20)}
input,textarea,select,button,.primary-action{font:inherit;border:var(--border) solid var(--line);border-radius:var(--radius);min-height:var(--target);padding:var(--s12);background:var(--surface);color:var(--ink);caret-color:var(--focus)}
input,textarea,select{width:100%;min-width:0}
textarea{min-height:136px;resize:vertical}
button,.primary-action{background:var(--action);color:var(--on-action);cursor:pointer;margin-top:var(--s24);padding-inline:var(--s20)}
.primary-action{display:inline-flex;align-items:center;justify-content:center;min-width:var(--target);text-decoration:none}
.secondary-action{background:var(--surface);color:var(--ink)}
button:hover,.primary-action:hover{text-decoration:underline}
button:active,.primary-action:active{border-style:double}
button:disabled,button[aria-disabled="true"]{cursor:progress}
.notice{padding:var(--s16);background:var(--surface)}
dl{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:var(--s12)}
dd{margin:0;font-variant-numeric:tabular-nums}
li{margin-block:var(--s8)}
.supporting-reasons{margin-inline-start:var(--s20);padding-inline-start:var(--s16);border-inline-start:var(--border) solid var(--line);color:var(--muted)}
.supporting-reasons>p{margin-block:var(--s12) var(--s8)}
#commercial-summary h2{margin-top:var(--s24)}
#summary-evidence ul{padding-inline-start:var(--s20)}
.table-wrap{overflow-x:auto}
[data-reply-comparison] table{min-width:calc(68ch - 2 * var(--s20))}
[data-reply-amount]{white-space:nowrap}
.reply-route{overflow-wrap:normal}
.case-list{max-width:100%;min-width:0}
.case-list table{min-width:0}
.case-list a{display:inline-flex;align-items:center;min-height:var(--target);min-width:var(--target)}
summary{cursor:pointer;min-height:var(--target);padding:var(--s8) 0}
footer{margin-top:var(--s48);border-top:var(--border) solid var(--line);padding-top:var(--s16)}
.print-only{display:none}
.state{font-weight:700;margin-top:var(--s32)}
.recommended{color:var(--action)}
.question{color:var(--question)}
.held,[role="alert"]{color:var(--held)}
blockquote{margin:var(--s16) 0;padding:var(--s16);background:var(--surface)}
code{font-family:ui-monospace,monospace}
.skip-link{position:absolute;transform:translateY(-200%);background:var(--surface);padding:var(--s12)}
.skip-link:focus{position:static;transform:none}
.form-status{color:var(--muted);font-weight:600}
.consent{display:flex;align-items:center;gap:var(--s12);min-height:var(--target)}
.consent input{width:auto;flex:none}
.private-photo{max-width:100%;max-height:240px;object-fit:contain}
.workspace-heading{display:none}
.case-input-summary dd{min-width:0}
@media screen and (min-width:960px){
  main.commercial-shell,.primary-nav.commercial-shell{max-width:1160px;padding-inline:var(--s32)}
  .commercial-summary-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s24);margin-block:var(--s24)}
  .commercial-summary-cards>div{background:var(--surface);border:var(--border) solid var(--line);border-radius:var(--radius);padding:var(--s20)}
  #commercial-summary .commercial-summary-cards h2{margin-top:0}
}
.report-workspace,.input-workspace,.report-results,.report-records,.input-overview,.input-support,.case-editor,.case-editor-body{min-width:0}
@media screen and (min-width:1280px){
  main.workspace-shell,.primary-nav.workspace-shell{max-width:var(--workspace-max);padding-inline:var(--s32)}
  .workspace-heading{display:block}
  .report-workspace,.input-workspace{display:grid;grid-template-columns:minmax(var(--editor-min),var(--editor-max)) minmax(0,1fr);column-gap:var(--s32);align-items:start}
  .report-workspace{grid-template-areas:"editor results" "editor records"}
  .input-workspace{grid-template-areas:"editor overview" "editor support";grid-template-rows:auto 1fr}
  .report-results{grid-area:results}
  .report-records{grid-area:records}
  .input-overview{grid-area:overview}
  .input-support{grid-area:support}
  .case-editor{grid-area:editor;align-self:stretch;border-inline-end:var(--border) solid var(--line);padding-inline-end:var(--s20)}
  .case-editor-body{position:sticky;top:var(--s24);max-height:calc(100dvh - 2 * var(--s24));overflow-y:auto;padding:var(--s8);scroll-padding-block:var(--s16)}
  .case-editor h2{font-size:var(--h3);margin-block:var(--s24) var(--s12)}
  .case-editor-body>h2:first-child{margin-top:0}
  .case-input-summary h2{margin-top:0}
  .case-input-summary dl{gap:var(--s8) var(--s12);margin-block:var(--s12);font-size:var(--secondary)}
  .case-input-summary dt{font-weight:600}
  .case-input-summary>p{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
  .workspace-shell p{max-inline-size:var(--content-measure)}
  .workspace-shell :where(h1,h2,h3,p,li,dd,summary,section,article,details){min-inline-size:0}
  .workspace-shell a{max-inline-size:100%}
  .workspace-shell :where(#evidence,#alternatives,#checks){display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:var(--s32);align-items:start}
  .workspace-shell :where(#evidence,#alternatives,#checks)>:where(h2,h3,p){grid-column:1/-1}
  .workspace-shell :where(#evidence,#alternatives)>:where(section,article){margin-block:0}
  .workspace-shell #checks>ul{margin-block:var(--s12);padding-inline-start:var(--s24)}
  .workspace-shell #remaining-checks{margin-top:var(--s12)}
  .workspace-shell #case-progress>details[open]{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:var(--s32);align-items:start}
  .workspace-shell #case-progress>details>:not(section[id^="guidance-stage-"]){grid-column:1/-1}
  .workspace-shell #case-progress>details>section[id^="guidance-stage-"]{margin-block:0}
}
@media(max-width:600px){
  dl{display:block}
  dt{font-weight:600}
  dd{margin-bottom:var(--s16)}
  .case-list thead{display:none}
  .case-list tr,.case-list td{display:block}
  .case-list td{border:0}
  .case-list td::before{content:attr(data-label);font-weight:600;margin-right:var(--s12)}
  .case-list tr{border-bottom:var(--border) solid var(--line)}
}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
@page{size:A4;margin:18mm}
@media print{
  :root{color-scheme:light;--bg:#ffffff;--ink:#252824;--muted:#535b52;--surface:#ffffff;--focus:#076641;--line:#737b72;--action:#273e31;--on-action:#ffffff;--question:#245888;--held:#8a3a16;--selection:#d7e9dc}
  nav,form,.screen-only,.skip-link{display:none}
  a{min-height:0;min-width:0}
  summary{min-height:0;padding:0;margin-block:4pt;break-after:avoid}
  .primary-action{min-height:0;padding:0;margin:0;border:0}
  blockquote{margin:6pt 0;padding:6pt 8pt}
  .print-only{display:block}
  body{font-size:10.5pt;line-height:1.45}
  main{max-width:none;padding:0}
  h1,h2,h3{break-after:avoid}
  h1{font-size:21pt;margin:var(--s12) 0 var(--s8)}
  h2{font-size:16pt;margin:var(--s20) 0 var(--s8)}
  h3{font-size:12.5pt;margin:var(--s12) 0 var(--s8)}
  section{margin-block:var(--s8)}
  #commercial-summary{break-after:page}
  #commercial-summary h2{margin-top:var(--s20)}
  th,td,caption{padding:var(--s8)}
  ul,ol,p{margin-block:4px}
  li{margin-block:0}
  dl{gap:var(--s8);margin-block:var(--s8)}
  tr,section[aria-labelledby="priority-heading"] li{break-inside:avoid}
  #advanced{break-inside:auto;break-after:avoid-page}
  #advanced p{margin-block:4pt}
  thead{display:table-header-group}
  p{orphans:3;widows:3}
  footer{margin-top:var(--s8);padding-top:var(--s8)}
  .table-wrap{overflow:visible}
  [data-reply-comparison] table{min-width:0}
}
@media screen {
  .intake-waiting{max-width:43rem;margin:var(--s48) auto;padding:clamp(1.25rem,5vw,3rem);background:var(--surface);border:1px solid var(--line);border-radius:var(--radius)}
  .intake-waiting h1{margin-top:0}
  .intake-waiting ol{display:grid;gap:var(--s12);list-style:none;padding:0;margin:var(--s24) 0}
  .intake-waiting li{padding:var(--s12) var(--s16);border:1px solid var(--line);border-radius:var(--radius)}
  .intake-waiting li::before{content:"○";margin-right:var(--s12)}
  .intake-waiting li[aria-current]{background:var(--action);color:var(--on-action);font-weight:700}
  .intake-waiting li[aria-current]::before{content:"●"}
  .intake-waiting li.is-done::before{content:"✓"}
  .intake-current{font-weight:650}
}
` + intakeStyles + caseListStyles + resultScreenStyles + `
@media screen {
  .site-header{background:var(--surface);border-block-end:1px solid var(--line)}
  .site-header-inner{max-width:1200px;margin-inline:auto;padding:0 var(--s32);display:flex;align-items:center;justify-content:space-between;gap:var(--s24);min-height:68px}
  .site-brand{color:var(--ink);font-size:1.125rem;font-weight:800;letter-spacing:-.025em;text-decoration:none;white-space:nowrap}
  .site-header .primary-nav{margin:0;padding:0;max-width:none}
  .site-header .primary-nav a{color:var(--ink);padding-inline:var(--s12);text-decoration:none}
  .site-header .primary-nav a:hover{text-decoration:underline}
  .site-menu-toggle{display:none}
  main.site-content{max-width:1200px;margin-inline:auto;padding-inline:var(--s32)}
  .help-content{max-width:var(--content-measure)}
}
@media screen and (max-width: 820px) {
  main.site-content{padding-inline:var(--s20)}
  .site-header-inner{padding-inline:var(--s20);display:grid;grid-template-columns:1fr auto;gap:0 var(--s16);min-height:60px}
  .site-menu-toggle:not([hidden]){display:inline-flex;align-items:center;justify-content:center;gap:var(--s8);color:var(--ink);background:var(--surface);padding:0 var(--s12);margin:0}
  .site-header .primary-nav{grid-column:1/-1;display:flex;flex-direction:column;align-items:stretch;gap:0;padding-block-end:var(--s8)}
  .site-menu-toggle[aria-expanded="false"]+.primary-nav{display:none}
}
@media screen {
  :root {
    --bg:#f5f5f7;--surface:#ffffff;--raised:#ffffff;--quiet:#ededf1;
    --ink:#1d1d22;--muted:#52525e;--line:#d6d6df;--control-line:#777783;
    --action:#00685e;--action-hover:#00574e;--on-action:#ffffff;--focus:#00685e;--selection:#dcefeb;
    --recommended:#23613a;--recommended-bg:#e1f3e7;
    --question:#224d86;--question-bg:#e5efff;
    --held:#833c12;--held-bg:#fcecdf;
    --elevation:0 1px 3px #17172210,0 4px 16px #1717220c;
    --font:Pretendard,-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",system-ui,sans-serif;
    --body:16px;--secondary:14px;--h1:44px;--h2:28px;--h3:22px;
    --radius:12px;--button-radius:10px;--target:44px;
  }
  body{font-family:var(--font);line-height:1.6}
  h1,h2,h3{font-weight:750;line-height:1.22}
  h1,h2{letter-spacing:-.025em}
  h1{margin-block:var(--s32) var(--s16)}
  .site-header{background:var(--surface);border-block-end-color:var(--line)}
  .site-brand{font-size:20px;font-weight:800}
  .site-header .primary-nav a{color:var(--muted);font-weight:600;border-radius:var(--button-radius)}
  .site-header .primary-nav a:hover{color:var(--focus);background:var(--selection);text-decoration:none}
  input:not([type=checkbox]),textarea,select{border-color:var(--control-line);border-radius:var(--button-radius)}
  :is(input,textarea)::placeholder{color:var(--muted);opacity:1}
  input[type=checkbox]{inline-size:20px;block-size:20px;min-height:0;accent-color:var(--action)}
  .consent{cursor:pointer}
  /* Keep navigation focus on non-interactive destinations without drawing a ring around the content. */
  :is(h1,h2,main,#case-intake,#report-results,#case-editor)[tabindex="-1"]:focus{outline:none}
  button,.primary-action{min-inline-size:var(--target);border-radius:var(--button-radius);font-weight:700}
  button:not(.secondary-action),.primary-action:not(.secondary-action){border-color:transparent}
  button:not(.secondary-action):not(.intake-material):not(.site-menu-toggle):hover,.primary-action:not(.secondary-action):hover{
    background:var(--action-hover);color:var(--on-action)
  }
  .secondary-action,.site-menu-toggle:not([hidden]),.report-workspace .case-editor button{
    background:var(--quiet);color:var(--ink);border-color:var(--line)
  }
  .secondary-action:hover,.site-menu-toggle:not([hidden]):hover,.report-workspace .case-editor button:hover{
    background:var(--selection);color:var(--focus)
  }
  .intake-form button:is(:disabled,[aria-disabled="true"]):hover{background:var(--quiet);color:var(--muted)}
  .notice,blockquote{border-radius:var(--radius)}
  .notice{background:var(--quiet)}
  .notice[role="alert"]{background:var(--held-bg)}
  .intake-landing h1{color:var(--ink);font-size:clamp(36px,5.5vw,68px);line-height:1.16}
  .intake-landing .primary-action{padding-block:var(--s12)}
  .intake-section-title{font-weight:750}
  .intake-materials{gap:var(--s16)}
  .case-editor .intake-materials{grid-template-columns:repeat(2,minmax(0,1fr))}
  .intake-form .intake-material,.intake-summary,.intake-waiting,.result-metrics article,
  .case-counts li,.case-empty,.commercial-summary-cards>div{
    background:var(--raised);border:0;box-shadow:var(--elevation);border-radius:var(--radius)
  }
  .intake-form .intake-material{color:var(--ink);padding:var(--s16) var(--s8);font-weight:700}
  .intake-material svg{color:var(--muted)}
  .intake-form .intake-material:hover,.intake-form .intake-material[aria-pressed="true"]{background:var(--selection);color:var(--focus)}
  .intake-form .intake-material[aria-pressed="true"]{box-shadow:inset 0 0 0 1px var(--focus),var(--elevation)}
  .intake-material[aria-pressed="true"] svg{color:inherit}
  .intake-chips [aria-pressed="true"]{color:var(--focus);border-color:var(--focus)}
  .intake-waiting li{background:var(--quiet);border-color:transparent}
  .intake-waiting li[aria-current]{background:var(--selection);color:var(--focus)}
  .result-overview .state,.case-badge{border-radius:999px;padding:var(--s8) var(--s16);font-weight:700}
  .result-overview .recommended,.case-badge-recommendation{color:var(--recommended);background:var(--recommended-bg)}
  .result-overview .question,.case-badge-information{color:var(--question);background:var(--question-bg)}
  .result-overview .held,.case-badge-hold{color:var(--held);background:var(--held-bg)}
  .case-badge-unknown{color:var(--muted);background:var(--quiet)}
  .result-overview h1{margin-block:var(--s16) var(--s8)}
  .result-metrics article{padding:var(--s24)}
  .result-metrics .metric-value{font-size:clamp(25px,2.5vw,34px);font-weight:760;color:var(--ink);letter-spacing:-.025em}
  .result-metrics .metric-value:not(:has(span)){font-size:var(--h3)}
  .result-metrics article>p:not(.metric-value),.metric-value span{color:var(--muted)}
  .guidance-stages li{padding:var(--s8);background:var(--quiet);border-radius:8px}
  .stage-icon{inline-size:24px;block-size:24px;color:var(--muted)}
  .guidance-stages li[data-state="available"]{background:var(--recommended-bg)}
  .guidance-stages li[data-state="available"] :is(svg,span){color:var(--recommended)}
  .guidance-stages li[data-state="partial"]{background:var(--question-bg)}
  .guidance-stages li[data-state="partial"] :is(svg,span){color:var(--question)}
  .guidance-stages strong{font-weight:750}
  .result-disclosure>summary{padding-inline:var(--s8)}
  .case-counts strong{font-size:var(--h3);font-weight:750}
  .case-table td{background:var(--raised)}
  .case-table th{color:var(--muted)}
}
@media screen and (prefers-color-scheme:dark) {
  :root {
    --bg:#17171b;--surface:#202025;--raised:#25252c;--quiet:#303039;
    --ink:#f2f2f6;--muted:#b9b9c5;--line:#474752;--control-line:#838392;
    --action:#79d6c5;--action-hover:#97e2d4;--on-action:#102c28;--focus:#8be2d2;--selection:#23433f;
    --recommended:#a8e5b9;--recommended-bg:#213d2d;
    --question:#bbd7ff;--question-bg:#243850;
    --held:#ffd0ab;--held-bg:#4b2f24;
    --elevation:0 1px 3px #00000034,0 4px 16px #00000026;
  }
}
@media screen and (min-width:960px) {
  .guidance-stages{gap:var(--s8)}
  .guidance-stages li{grid-template-columns:minmax(0,1fr);row-gap:var(--s8);padding:var(--s12)}
  .guidance-stages span{grid-column:1}
}
@media screen and (max-width:768px) {
  .case-table tr{border:0;background:var(--raised);box-shadow:var(--elevation)}
}
@media screen and (max-width:600px) {
  :root{--h1:36px}
  .result-metrics article,.intake-summary{padding:var(--s24)}
  .intake-material svg{width:40px;height:40px}
  .guidance-stages li{padding:var(--s12) var(--s16)}
}
`;
