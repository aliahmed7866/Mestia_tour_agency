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
  const updateFields = () => {
    requestForm.querySelectorAll("[data-kind-panel]").forEach((panel) => {
      const applies = panel.dataset.kindPanel.split(" ").includes(kind.value);
      panel.hidden = !applies;
      panel.querySelectorAll("input, select, textarea").forEach((field) => {
        field.disabled = !applies;
      });
    });
    ["check_in", "check_out"].forEach((id) => {
      requestForm.querySelector(`#${id}`).required = kind.value === "stay";
    });
    ["start_local", "end_local"].forEach((id) => {
      requestForm.querySelector(`#${id}`).required = kind.value !== "stay";
    });
    ["pickup", "destination"].forEach((id) => {
      requestForm.querySelector(`#${id}`).required = kind.value === "taxi";
    });
  };
  kind.addEventListener("change", updateFields);
  updateFields();

  const checkIn = requestForm.querySelector("#check_in");
  const checkOut = requestForm.querySelector("#check_out");
  const updateCheckOut = () => {
    if (!checkIn.value) { checkOut.removeAttribute("min"); return; }
    const date = new Date(`${checkIn.value}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    checkOut.min = date.toISOString().slice(0, 10);
  };
  checkIn.addEventListener("change", updateCheckOut);
  updateCheckOut();
}
