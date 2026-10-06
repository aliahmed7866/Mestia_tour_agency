"use strict";
document.documentElement.classList.add("js");

const stayChoice = document.querySelector('[data-add-stay]');
if (stayChoice) {
  const dates = document.querySelector('[data-stay-dates]');
  const arrival = dates.querySelector('[name=bundle_check_in]');
  const departure = dates.querySelector('[name=bundle_check_out]');
  const updateStay = () => {
    dates.hidden = !stayChoice.checked;
    dates.querySelectorAll('input').forEach(input => {
      input.disabled = !stayChoice.checked;
      input.required = stayChoice.checked;
    });
    if (arrival.value) {
      const next = new Date(`${arrival.value}T12:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      departure.min = next.toISOString().slice(0, 10);
    } else departure.removeAttribute('min');
  };
  stayChoice.addEventListener('change', updateStay);
  arrival.addEventListener('change', updateStay);
  updateStay();
}

const menuButton = document.querySelector(".menu-toggle");
const navigation = document.querySelector("#site-nav");
if (menuButton && navigation) {
  menuButton.addEventListener("click", () => {
    const isOpen = menuButton.getAttribute("aria-expanded") === "true";
    menuButton.setAttribute("aria-expanded", String(!isOpen));
    navigation.classList.toggle("is-open", !isOpen);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && navigation.classList.contains("is-open")) {
      navigation.classList.remove("is-open");
      menuButton.setAttribute("aria-expanded", "false");
      menuButton.focus();
    }
  });
}

const requestForm = document.querySelector("[data-request-form]");
if (requestForm) {
  const kind = requestForm.querySelector("#kind");
  const serviceSelect = requestForm.querySelector("[data-service-select]");
  const recap = requestForm.querySelector("[data-trip-recap]");
  const updateTrip = () => {
    if (!serviceSelect || !recap) return;
    const option = serviceSelect.selectedOptions[0];
    const hasTrip = Boolean(option && option.value);
    recap.hidden = !hasTrip;
    if (!hasTrip) return;
    recap.querySelector("[data-trip-title]").textContent = option.dataset.title;
    recap.querySelector("[data-trip-facts]").textContent = [option.dataset.base, option.dataset.duration].filter(Boolean).join(" · ");
    recap.querySelector("[data-trip-image]").src = option.dataset.image;
  };
  const updateFields = () => {
    requestForm.querySelectorAll("[data-kind-panel]").forEach((panel) => {
      const applies = panel.dataset.kindPanel.split(" ").includes(kind.value);
      panel.hidden = !applies;
      panel.querySelectorAll("input, select, textarea").forEach((field) => {
        field.disabled = !applies;
      });
    });
    requestForm.querySelectorAll("[data-required-kind]").forEach((field) => {
      field.required = !field.disabled && field.dataset.requiredKind.split(" ").includes(kind.value);
    });
    requestForm.querySelectorAll("[data-kind-choice]").forEach((choice) => {
      if (choice.dataset.kindChoice === kind.value) choice.setAttribute("aria-current", "page");
      else choice.removeAttribute("aria-current");
    });
    if (serviceSelect) {
      Array.from(serviceSelect.options).forEach((option) => {
        const applies = !option.value || kind.value === "combined" || option.dataset.kind === kind.value;
        option.hidden = !applies;
        option.disabled = !applies;
        if (!applies && option.selected) serviceSelect.value = "";
      });
      updateTrip();
    }
  };
  requestForm.querySelectorAll("[data-kind-choice]").forEach((choice) => {
    choice.addEventListener("click", (event) => {
      // Preserve normal link behaviour for opening another tab or window.
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      kind.value = choice.dataset.kindChoice;
      updateFields();
      if (kind.value === "combined") requestForm.querySelector(".enquiry-extras").open = true;
    });
  });
  kind.addEventListener("change", updateFields);
  if (serviceSelect) serviceSelect.addEventListener("change", updateTrip);
  updateFields();

  const checkIn = requestForm.querySelector("#check_in");
  const checkOut = requestForm.querySelector("#check_out");
  const updateCheckOut = () => {
    if (!checkIn || !checkOut) return;
    if (!checkIn.value) { checkOut.removeAttribute("min"); return; }
    const date = new Date(`${checkIn.value}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return;
    date.setUTCDate(date.getUTCDate() + 1);
    checkOut.min = date.toISOString().slice(0, 10);
  };
  if (checkIn) checkIn.addEventListener("change", updateCheckOut);
  updateCheckOut();
}

// QR-based business links cannot carry a click-to-chat message reliably.
// Keep an editable draft and copy only after the guest explicitly clicks.
document.querySelectorAll("[data-activity-message]").forEach((draft) => {
  const message = draft.querySelector("[data-activity-message-text]");
  const button = draft.querySelector("[data-copy-activity-message]");
  const status = draft.querySelector("[data-copy-status]");
  if (!message || !button || !status) return;
  button.hidden = false;
  button.addEventListener("click", async () => {
    let copied = false;
    button.disabled = true;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(message.value);
        copied = true;
      }
    } catch (_) {
      // Clipboard permission may be unavailable in a local Termux preview.
    }
    if (!copied) {
      message.focus();
      message.select();
      try {
        copied = Boolean(document.execCommand && document.execCommand("copy"));
      } catch (_) {
        // Leave the text selected for the phone's native Copy action.
      }
    }
    status.textContent = copied ? button.dataset.copySuccess : button.dataset.copyManual;
    button.disabled = false;
    if (copied) button.focus();
  });
});

// Date checks complement the server validation; never invent travel dates.
if (requestForm) {
  const field = name => requestForm.elements.namedItem(name);
  const validateDates = () => {
    for (const [startName, endName] of [['check_in','check_out'], ['bundle_check_in','bundle_check_out']]) {
      const start = field(startName), end = field(endName);
      if (!start || !end) continue;
      end.setCustomValidity(!end.disabled && start.value && end.value && end.value <= start.value ? requestForm.dataset.dateError : '');
    }
    const tour = field('request_date'), arrival = field('bundle_check_in'), departure = field('bundle_check_out');
    if (tour) tour.setCustomValidity(stayChoice?.checked && arrival?.value && departure?.value && tour.value &&
      (tour.value < arrival.value || tour.value > departure.value) ? requestForm.dataset.bundleError : '');
  };
  requestForm.addEventListener('input', validateDates);
  requestForm.addEventListener('change', validateDates);
  validateDates();
  // Reveal invalid optional fields before the browser moves focus to them.
  requestForm.addEventListener('invalid', event => {
    let parent = event.target.parentElement;
    while (parent && parent !== requestForm) {
      if (parent.tagName === 'DETAILS') parent.open = true;
      parent = parent.parentElement;
    }
  }, true);
  const send = requestForm.querySelector('button[type=submit]');
  const label = send?.textContent;
  requestForm.addEventListener('submit', event => {
    if (requestForm.dataset.sendingNow) { event.preventDefault(); return; }
    requestForm.dataset.sendingNow = 'true';
    if (send) { send.disabled = true; send.textContent = requestForm.dataset.sending; }
  });
  window.addEventListener('pageshow', () => {
    if (!requestForm.dataset.sendingNow) return;
    delete requestForm.dataset.sendingNow;
    if (send) { send.disabled = false; send.textContent = label; }
  });
}
