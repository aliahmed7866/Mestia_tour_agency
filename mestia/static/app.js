"use strict";
document.documentElement.classList.add("js");

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
