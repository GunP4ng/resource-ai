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
.workspace-nav,.workspace-heading{display:none}
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
  .workspace-nav{display:flex;margin-block:var(--s16);font-size:var(--secondary)}
  .mobile-editor-shortcut{display:none}
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
`;
