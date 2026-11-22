export const intakeScript = `
  const intakeForms = [...document.querySelectorAll("form[data-intake-form]")];
  const phases = ["materials", "evidence", "routes"];
  const phaseLabels = ["입력 내용 확인 중", "법령 근거 찾는 중", "처리 경로 비교 중"];
  const beginReview = (form, status) => {
    const panel = form.closest("[data-intake-panel]");
    if (!panel || !globalThis.crypto?.getRandomValues) return;
    const originalAction = form.getAttribute("action");
    const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, "0")).join("");
    const action = new URL(form.action);
    action.searchParams.set("progress", token);
    form.action = action.href;

    const waiting = document.createElement("section");
    waiting.className = "intake-waiting";
    waiting.tabIndex = -1;
    waiting.innerHTML = '<h1>검토 중</h1><p>검토가 끝나면 결과가 열려요.</p><ol aria-label="검토 단계"></ol>';
    const rows = phaseLabels.map(label => {
      const row = document.createElement("li");
      row.textContent = label;
      waiting.querySelector("ol").append(row);
      return row;
    });
    const announce = document.createElement("p");
    announce.setAttribute("role", "status");
    announce.className = "intake-current";
    waiting.append(announce);
    panel.after(waiting);
    document.querySelector("[data-intake-landing]")?.setAttribute("hidden", "");
    panel.hidden = true;
    status.textContent = "";
    let shown = -1;
    const display = index => {
      if (index <= shown) return;
      shown = index;
      rows.forEach((row, pos) => {
        if (pos === index) row.setAttribute("aria-current", "step");
        else row.removeAttribute("aria-current");
        row.classList.toggle("is-done", pos < index);
      });
      announce.textContent = phaseLabels[index];
    };
    display(0);
    waiting.focus();

    let stopped = false;
    let timer;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const response = await fetch("/cases/progress/" + token, { signal: controller.signal, cache: "no-store" });
        if (response.ok) display(phases.indexOf((await response.json()).step));
      } catch { /* The native submission continues even without progress updates. */ }
      if (!stopped) timer = setTimeout(poll, 350);
    };
    timer = setTimeout(poll, 200);
    const stop = restoring => {
      stopped = true;
      clearTimeout(timer);
      controller.abort();
      if (!restoring) return;
      waiting.remove();
      panel.hidden = false;
      if (originalAction === null) form.removeAttribute("action");
      else form.setAttribute("action", originalAction);
      window.removeEventListener("pagehide", onHide);
    };
    const onHide = () => stop(false);
    window.addEventListener("pagehide", onHide, { once: true });
    reviewReset.set(form, () => stop(true));
  };
  const reviewReset = new WeakMap();
  for (const form of intakeForms) {
    const landing = document.querySelector("[data-intake-landing]");
    const panel = form.closest("[data-intake-panel]");
    const start = panel && landing?.querySelector("[data-intake-start]");
    const open = focus => {
      if (start && panel) {
        landing.hidden = true;
        panel.hidden = false;
      }
      if (focus) panel?.querySelector("#intake-form-heading")?.focus();
    };
    if (start && location.hash !== "#case-intake") panel.hidden = true;
    else if (start) open(false);
    if (start) window.addEventListener("hashchange", () => {
      if (location.hash === "#case-intake" && panel.hidden) open(true);
    });
    start?.addEventListener("click", event => {
      if (event.button !== 0 || event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return;
      event.preventDefault();
      open(true);
    });
    form.querySelectorAll("[data-intake-picker], [data-intake-example], [data-intake-summary-values]")
      .forEach(node => { node.hidden = false; });
    const material = form.elements.namedItem("polymer");
    const cards = [...form.querySelectorAll("[data-intake-material]")];
    const chips = [...form.querySelectorAll("[data-intake-chips]")];
    const valueChips = [...form.querySelectorAll("[data-intake-value]")];
    const summaryValues = [...form.querySelectorAll("[data-intake-summary-value]")];
    const markMaterial = name => {
      cards.forEach(card => card.setAttribute("aria-pressed", String(card.dataset.intakeMaterial === name)));
      chips.forEach(group => { group.hidden = group.dataset.intakeChips !== name; });
    };
    const markValue = () => {
      let group;
      valueChips.forEach(chip => {
        const selected = chip.dataset.intakeValue === material.value.trim();
        chip.setAttribute("aria-pressed", String(selected));
        if (selected) group = chip.closest("[data-intake-chips]").dataset.intakeChips;
      });
      markMaterial(group);
    };
    const updateSummary = () => {
      summaryValues.forEach(node => {
        const name = node.dataset.intakeSummaryValue;
        const field = form.elements.namedItem(name);
        let value = field.value.trim();
        if (field instanceof HTMLSelectElement) value = field.selectedOptions[0].textContent;
        if (name === "massKg" && value) value += " kg";
        if (name === "assessmentDate" && value) {
          const [year, month, day] = value.split("-");
          value = year + "년 " + Number(month) + "월 " + Number(day) + "일";
        }
        const text = value || "입력 전";
        if (node.textContent !== text) node.textContent = text;
      });
    };
    material.addEventListener("input", markValue);
    material.addEventListener("change", markValue);
    form.addEventListener("input", updateSummary);
    form.addEventListener("change", updateSummary);
    window.addEventListener("pageshow", () => { markValue(); updateSummary(); });
    markValue();
    updateSummary();
    form.addEventListener("click", event => {
      const button = event.target instanceof Element && event.target.closest("button");
      if (!button) return;
      if (button.hasAttribute("data-intake-material")) markMaterial(button.dataset.intakeMaterial);
      else if (button.hasAttribute("data-intake-value")) {
        material.value = button.dataset.intakeValue;
        material.dispatchEvent(new Event("input", { bubbles: true }));
      } else if (button.hasAttribute("data-intake-example")) {
        const today = new Intl.DateTimeFormat("en", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts();
        const date = ["year", "month", "day"].map(type => today.find(part => part.type === type).value).join("-");
        let filled = false;
        for (const [name, value] of Object.entries({ polymer: "PP", description: "예시: 사출 성형 뒤 선별한 PP 부품",
          process: "사출 성형 후 선별", region: "울산", contamination: "", hazardousContact: "unknown", massKg: "", assessmentDate: date })) {
          const field = form.elements.namedItem(name);
          if (!field.value && value) {
            field.value = value;
            filled = true;
          }
        }
        markValue();
        updateSummary();
        form.querySelector("[data-intake-example-status]").textContent = filled
          ? "빈 입력란에 예시를 채웠어요. 예시 입력이에요. 실제 현장 자료가 아니에요."
          : "이미 입력한 내용은 그대로 두었어요.";
      }
    });
  }
`;
