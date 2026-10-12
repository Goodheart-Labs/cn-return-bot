/* Small helpers for building the page's elements. */

/** Creates an element. `text` sets its text, a name the element knows as a
 *  property (className, type, checked) is set as one, and anything else
 *  becomes an attribute. */
export function element(tag, attributes = {}, children = []) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (name === "text") node.textContent = value;
    else if (name in node) node[name] = value;
    else node.setAttribute(name, value);
  }
  node.append(...children);
  return node;
}

/** A row of buttons of which exactly one is pressed. `options` is a list of
 *  [value, label] pairs. */
export function segments(options, current, choose) {
  const buttons = options.map(([value, label]) => {
    const button = element("button", { type: "button", className: "segment", text: label });
    button.setAttribute("aria-pressed", String(value === current));
    button.addEventListener("click", () => {
      for (const other of buttons) other.setAttribute("aria-pressed", String(other === button));
      choose(value);
    });
    return button;
  });
  return element("div", { className: "segments" }, buttons);
}
