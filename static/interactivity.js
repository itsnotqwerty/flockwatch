(() => {
  // Action ids make mutations idempotent on the server. This small client-side
  // guard gives immediate feedback and prevents accidental rapid resubmission.
  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.method !== "post") return;
    if (form.dataset.submitting === "true") {
      event.preventDefault();
      return;
    }
    form.dataset.submitting = "true";
    const submitter = event.submitter;
    if (submitter instanceof HTMLButtonElement) {
      submitter.disabled = true;
      submitter.setAttribute("aria-busy", "true");
      submitter.dataset.originalLabel = submitter.textContent ?? "";
      submitter.textContent = "Filing…";
    }
  });

  // Browsers may restore a page from the back-forward cache with DOM state
  // intact. Re-enable controls when that happens.
  globalThis.addEventListener("pageshow", () => {
    for (const form of document.querySelectorAll("form[data-submitting]")) {
      delete form.dataset.submitting;
      const button = form.querySelector("button[aria-busy='true']");
      if (button) {
        button.disabled = false;
        button.removeAttribute("aria-busy");
        button.textContent = button.dataset.originalLabel ?? button.textContent;
        delete button.dataset.originalLabel;
      }
    }
  });

  for (const tabs of document.querySelectorAll("[data-tabs]")) {
    const buttons = [...tabs.querySelectorAll('[role="tab"]')];
    const selectTab = (selected) => {
      for (const button of buttons) {
        const isSelected = button === selected;
        button.setAttribute("aria-selected", String(isSelected));
        button.tabIndex = isSelected ? 0 : -1;
        const panel = document.getElementById(button.getAttribute("aria-controls"));
        if (panel) panel.hidden = !isSelected;
      }
    };

    for (const [index, button] of buttons.entries()) {
      button.addEventListener("click", () => selectTab(button));
      button.addEventListener("keydown", (event) => {
        let nextIndex;
        if (event.key === "ArrowRight") nextIndex = (index + 1) % buttons.length;
        if (event.key === "ArrowLeft") nextIndex = (index - 1 + buttons.length) % buttons.length;
        if (event.key === "Home") nextIndex = 0;
        if (event.key === "End") nextIndex = buttons.length - 1;
        if (nextIndex === undefined) return;
        event.preventDefault();
        selectTab(buttons[nextIndex]);
        buttons[nextIndex].focus();
      });
    }
  }
})();
