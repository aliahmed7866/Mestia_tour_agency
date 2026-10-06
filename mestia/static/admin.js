"use strict";

// The server validates every form; these controls only shorten repetitive entry.
document.querySelectorAll("[data-add-row]").forEach((button) => {
  button.addEventListener("click", () => {
    const target = document.getElementById(button.dataset.addRow);
    const hidden = target.querySelector('[data-repeat-row][hidden]');
    if (hidden) {
      hidden.hidden = false;
      hidden.querySelector('input,select,textarea').focus();
      return;
    }
    const rows = target.querySelectorAll("[data-repeat-row]");
    const maximum = target.id === "quote-items" ? 30 : 100;
    if (rows.length >= maximum) return;
    const clone = rows[rows.length - 1].cloneNode(true);
    clone.querySelector("[data-row-number]").textContent = String(rows.length + 1);
    clone.querySelectorAll("input,textarea,select").forEach((field) => {
      field.required = false;
      delete field.dataset.edited;
      if (field.name.endsWith("start") || field.name.endsWith("end")) field.value = "";
      if (field.name.endsWith("title") || field.name.endsWith("inclusions")) field.value = "";
      else if (field.name.endsWith("quantity")) field.value = "1";
      else if (field.name.endsWith("price")) field.value = "0";
      else if (field.tagName === "SELECT") field.selectedIndex = 0;
    });
    const priceBasis = clone.querySelector('[data-price-basis]');
    if (priceBasis) priceBasis.textContent = '';
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

// Keep the no-JavaScript form complete; reveal extra blank rows as needed.
document.querySelectorAll('#quote-items [data-repeat-row]').forEach((row, index) => {
  row.hidden = index > 0 && !row.querySelector('[name=item_title]').value;
});
document.querySelectorAll('#quote-allocations [data-repeat-row]').forEach((row, index) => {
  row.hidden = index > 0 && !row.querySelector('[name=allocation_resource]').value;
});
const quoteItems = document.querySelector('#quote-items');
if (quoteItems) {
  const fill = (select) => {
    const option = select.selectedOptions[0];
    const basis = select.closest('[data-repeat-row]').querySelector('[data-price-basis]');
    if (basis) basis.textContent = option?.value ? [option.dataset.priceBasis, option.dataset.currency].filter(Boolean).join(' · ') : '';
    if (!option || !option.value) return;
    const row = select.closest('[data-repeat-row]');
    for (const [name, key] of [['item_title','title'], ['item_kind','kind'], ['item_price','price'], ['item_inclusions','inclusions']]) {
      const field = row.querySelector(`[name=${name}]`);
      // A catalogue reference determines type on the server too.
      if (field && (!field.dataset.edited || name === 'item_kind')) field.value = option.dataset[key] || '';
      if (field && name === 'item_price') field.required = true;
    }
  };
  quoteItems.addEventListener('input', event => {
    if (event.target.matches('input,textarea,select') && event.target.name !== 'item_service_id') event.target.dataset.edited = 'true';
  });
  quoteItems.addEventListener('change', event => {
    if (event.target.name === 'item_service_id') fill(event.target);
  });
  quoteItems.querySelectorAll('[name=item_service_id]').forEach(fill);
}
