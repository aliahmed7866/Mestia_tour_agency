"use strict";

// The server validates every form; these controls only shorten repetitive entry.
document.querySelectorAll("[data-add-row]").forEach((button) => {
  button.addEventListener("click", () => {
    const target = document.getElementById(button.dataset.addRow);
    const rows = target.querySelectorAll("[data-repeat-row]");
    const maximum = target.id === "quote-items" ? 30 : 100;
    if (rows.length >= maximum) return;
    const clone = rows[rows.length - 1].cloneNode(true);
    clone.querySelector("[data-row-number]").textContent = String(rows.length + 1);
    clone.querySelectorAll("input,textarea,select").forEach((field) => {
      field.required = false;
      if (field.name.endsWith("title") || field.name.endsWith("inclusions")) field.value = "";
      else if (field.name.endsWith("quantity")) field.value = "1";
      else if (field.name.endsWith("price")) field.value = "0";
      else if (field.tagName === "SELECT") field.selectedIndex = 0;
    });
    target.appendChild(clone);
    const itemCount = document.querySelectorAll("#quote-items [data-repeat-row]").length;
    document.querySelectorAll("[data-item-index]").forEach((select) => {
      const current = select.value;
      select.replaceChildren();
      for (let index = 0; index < itemCount; index += 1) {
        const option = document.createElement("option");
        option.value = String(index);
        option.textContent = `Item ${index + 1}`;
        select.appendChild(option);
      }
      select.value = current;
    });
    clone.querySelector("input,select,textarea").focus();
    if (rows.length + 1 >= maximum) button.disabled = true;
  });
});

const kind = document.querySelector("[data-request-kind]");
if (kind) {
  const updateDates = () => {
    const stay = kind.value === "stay";
    const includesStay = stay || kind.value === "combined";
    document.querySelectorAll("[data-stay-field]").forEach((label) => {
      label.hidden = !includesStay;
      label.querySelector("input").required = stay;
    });
    document.querySelectorAll("[data-timed-field]").forEach((label) => {
      label.hidden = stay;
      label.querySelector("input").required = !stay;
    });
  };
  kind.addEventListener("change", updateDates);
  updateDates();
}
