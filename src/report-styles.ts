export const reportStyles = `
:root{color-scheme:light dark;--bg:#fbfbfa;--ink:#252824;--muted:#535b52;--line:#737b72;--surface:#ffffff;--action:#273e31;--on-action:#ffffff;--focus:#076641;--selection:#d7e9dc;--question:#245888;--held:#8a3a16;
--body:17px;--secondary:15px;--h3:22px;--h2:28px;--h1:36px;--s8:8px;--s12:12px;--s16:16px;--s20:20px;--s24:24px;--s32:32px;--s48:48px;--target:44px;--radius:4px;--border:1px;--focus-width:2px;--focus-offset:3px}
@media(prefers-color-scheme:dark){:root{--bg:#171c19;--ink:#eef2ec;--muted:#bac5ba;--line:#8c998d;--surface:#202922;--action:#c5e5cb;--on-action:#13231a;--focus:#a4e9bf;--selection:#385c44;--question:#a9cff5;--held:#ffd0ac}}
*{box-sizing:border-box}
html{scrollbar-color:var(--line) var(--bg)}
body{margin:0;background:var(--bg);color:var(--ink);font:var(--body)/1.7 system-ui,sans-serif;word-break:keep-all;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
main{max-width:68ch;margin:auto;padding:0 var(--s20) var(--s48)}
.primary-nav{max-width:68ch;margin:auto;padding:var(--s32) var(--s20) 0}
nav,.cluster{display:flex;align-items:center;gap:var(--s12) var(--s20);flex-wrap:wrap}
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
.table-wrap{overflow-x:auto}
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
  .print-only{display:block}
  body{font-size:10.5pt;line-height:1.45}
  main{max-width:none;padding:0}
  h1,h2,h3{break-after:avoid}
  h1{font-size:21pt;margin:var(--s12) 0 var(--s8)}
  h2{font-size:16pt;margin:var(--s20) 0 var(--s8)}
  h3{font-size:12.5pt;margin:var(--s12) 0 var(--s8)}
  section{margin-block:var(--s12)}
  th,td,caption{padding:var(--s8)}
  ul,ol,p{margin-block:var(--s8)}
  li{margin-block:0}
  dl{gap:var(--s8);margin-block:var(--s8)}
  tr,section[aria-labelledby="priority-heading"] li{break-inside:avoid}
  thead{display:table-header-group}
  p{orphans:3;widows:3}
  footer{margin-top:var(--s8);padding-top:var(--s8)}
  .table-wrap{overflow:visible}
}
`;
