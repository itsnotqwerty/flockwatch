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
})();
