/* Builds the control panel for one candidate from its list of controls. */

const element = (tag, attributes = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (name === "text") node.textContent = value;
    else if (name in node) node[name] = value;
    else node.setAttribute(name, value);
  }
  node.append(...children);
  return node;
};

const closedSections = new Set();

function rangeRow(control, value, change) {
  const slider = element("input", { type: "range", min: control.min, max: control.max, step: control.step, value });
  const number = element("input", { type: "number", className: "number", min: control.min, max: control.max, step: control.step, value });
  slider.addEventListener("input", () => {
    number.value = slider.value;
    change(Number(slider.value));
  });
  number.addEventListener("input", () => {
    if (number.value === "" || Number.isNaN(Number(number.value))) return;
    slider.value = number.value;
    change(Number(number.value));
  });
  return [slider, number];
}

function colorRow(value, change) {
  const picker = element("input", { type: "color", value });
  const hex = element("input", { type: "text", className: "hex", value, spellcheck: false, maxLength: 7 });
  picker.setAttribute("list", "brand-colors");
  picker.addEventListener("input", () => {
    hex.value = picker.value;
    change(picker.value);
  });
  hex.addEventListener("input", () => {
    if (!/^#[0-9a-f]{6}$/i.test(hex.value)) return;
    picker.value = hex.value;
    change(hex.value.toLowerCase());
  });
  return [picker, hex];
}

function toggleRow(value, change) {
  const box = element("input", { type: "checkbox", checked: value });
  box.addEventListener("change", () => change(box.checked));
  return [box];
}

function selectRow(control, value, change) {
  const buttons = control.options.map(([optionValue, optionLabel]) => {
    const button = element("button", { type: "button", text: optionLabel, className: "segment" });
    button.setAttribute("aria-pressed", String(optionValue === value));
    button.addEventListener("click", () => {
      for (const other of buttons) other.setAttribute("aria-pressed", String(other === button));
      change(optionValue);
    });
    return button;
  });
  return [element("div", { className: "segments" }, buttons)];
}

function controlRow(control, values, defaults, handlers) {
  if (control.type === "action") {
    const button = element("button", { type: "button", className: "action", text: control.label });
    button.addEventListener("click", () => handlers.onAction(control));
    return element("div", { className: "row row-action" }, [button]);
  }
  const row = element("div", { className: `row row-${control.type}` });
  const reset = element("button", { type: "button", className: "reset", text: "Reset", title: "Back to the default value" });
  const markChanged = (value) => row.classList.toggle("changed", value !== defaults[control.key]);
  const change = (value) => {
    markChanged(value);
    handlers.onChange(control.key, value);
  };
  const value = values[control.key];
  const inputs =
    control.type === "range" ? rangeRow(control, value, change) : control.type === "color" ? colorRow(value, change) : control.type === "toggle" ? toggleRow(value, change) : selectRow(control, value, change);
  reset.addEventListener("click", () => handlers.onReset(control.key));
  markChanged(value);
  row.append(element("span", { className: "row-label", text: control.label }), ...inputs, reset);
  row.dataset.key = control.key;
  return row;
}

/** Draws the whole panel. Call it again after anything other than a plain
 *  value change: another candidate, a preset, a reset, an action. */
export function renderControls(container, candidate, values, handlers) {
  const rowsWithRules = [];
  const sections = candidate.sections.map((section) => {
    const rows = section.controls.map((control) => {
      const row = controlRow(control, values, candidate.defaults, handlers);
      if (control.visible) rowsWithRules.push({ row, visible: control.visible });
      return row;
    });
    const details = element("details", { open: !closedSections.has(section.title) }, [element("summary", { text: section.title }), ...rows]);
    details.addEventListener("toggle", () => (details.open ? closedSections.delete(section.title) : closedSections.add(section.title)));
    return details;
  });
  container.replaceChildren(...sections);
  const applyRules = (current) => {
    for (const { row, visible } of rowsWithRules) row.hidden = !visible(current);
  };
  applyRules(values);
  return applyRules;
}
