import { escapeHtml, page } from "./report-html.ts";

function loginLayout(content: string): string {
  return page("로그인", `<div class="login-content">
    <div class="login-intro"><p class="login-brand">Re:Source AI</p>
      <p>폐자원 처리 방향을 검토하고 사례를 관리하세요.</p></div>
    <section class="login-card" aria-labelledby="login-heading">${content}</section>
    <p class="login-help">계정이 필요하면 운영자에게 문의해 주세요.</p>
  </div>`, "login", "");
}

export function loginPage(error?: string): string {
  return loginLayout(`<h1 id="login-heading">로그인</h1>
    <p class="login-description">발급받은 계정으로 시작하세요.</p>
    <form method="post" action="/login" data-login-form>
      ${error ? `<p class="notice login-error" id="login-error" role="alert" tabindex="-1">${escapeHtml(error)}</p>` : ""}
      <div class="login-field"><label for="username">아이디</label>
        <input id="username" name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required maxlength="64"${error ? ' aria-describedby="login-error"' : ""}></div>
      <div class="login-field"><label for="password">비밀번호</label>
        <div class="login-password"><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="1024"${error ? ' aria-describedby="login-error"' : ""}>
          <button type="button" class="secondary-action login-password-toggle" data-password-toggle aria-controls="password" aria-label="비밀번호 표시" hidden>표시</button></div></div>
      <button class="login-submit" type="submit">로그인</button>
    </form>`);
}

export function loginRequiredPage(): string {
  return loginLayout(`<h1 id="login-heading">로그인해 주세요</h1>
    <p class="login-description">로그인하면 새 검토를 시작하고 저장한 사례를 볼 수 있어요.</p>
    <a class="primary-action login-submit" href="/login">로그인</a>`);
}
