/** Login-only screen composition; shared tokens and print styles stay authoritative. */
export const loginStyles = `
@media screen {
  :root{--login-max:440px}
  body.login-page{min-block-size:100dvh;display:flex;flex-direction:column}
  .login-header{display:flex;justify-content:flex-end;align-items:center;flex-wrap:wrap;gap:var(--s16);padding:var(--s16) var(--s24)}
  .login-header>a{color:var(--muted);font-size:var(--secondary)}
  main.site-content.login-shell{display:grid;place-items:center;flex:1;inline-size:100%;max-inline-size:none;padding:var(--s32) var(--s20) var(--s48)}
  .login-content{inline-size:100%;max-inline-size:var(--login-max);min-inline-size:0}
  .login-intro{text-align:center;margin-block-end:var(--s24)}
  .login-brand{font-size:var(--h2);font-weight:800;margin:0}
  .login-intro>p:last-child{color:var(--muted);font-size:var(--secondary);margin:var(--s8) 0 0;text-wrap:balance}
  .login-card{margin:0;padding:var(--s32);background:var(--surface);border-radius:var(--radius);box-shadow:var(--elevation)}
  .login-card h1{font-size:var(--h2);margin:0}
  .login-description{color:var(--muted);margin:var(--s8) 0 var(--s24);text-wrap:pretty}
  .login-field+.login-field{margin-block-start:var(--s20)}
  .login-field label{font-weight:600;margin:0 0 var(--s8)}
  .login-password{position:relative}
  .login-password:has(button:not([hidden])) input{padding-inline-end:calc(var(--target) + var(--s20))}
  .login-password-toggle:not([hidden]){position:absolute;inset-block:var(--border);inset-inline-end:var(--border);margin:0;inline-size:calc(var(--target) + var(--s8));padding:0;border:0;background:transparent;color:var(--muted);font-size:var(--secondary)}
  .login-password-toggle:focus-visible{outline-offset:calc(-1 * var(--focus-offset))}
  .login-submit{inline-size:100%;margin-block-start:var(--s24)}
  .login-submit[aria-disabled="true"]{background:var(--quiet);color:var(--muted)}
  .login-card .form-status{font-size:var(--secondary);margin:var(--s12) 0 0}
  .login-card .form-status:empty{display:none}
  .login-error{margin:0 0 var(--s24)}
  .login-error:focus{outline:var(--focus-width) solid var(--focus);outline-offset:var(--focus-offset)}
  .login-help{color:var(--muted);font-size:var(--secondary);text-align:center;margin:var(--s24) 0 0;text-wrap:balance}
}
@media screen and (max-width:600px){
  .login-header{padding-inline:var(--s20)}
  .login-card{padding:var(--s24)}
}
`;
