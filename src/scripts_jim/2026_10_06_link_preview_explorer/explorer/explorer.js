/* The explorer's controls. apps.js defines the apps (APPS) and the text a
 * preview shows (LINK). This file draws the image picker, the crop overlay and
 * the mock-ups, and redraws them when the reader picks something. */

const OPTIONS = [
  {
    id: "current",
    name: "Before",
    tag: "Live until GOO-389",
    blurb: "The card from PR #549: a white card with the logo, the name, the headline, the pitch and three rating pills.",
  },
  {
    id: "a-headline",
    name: "A. Homepage headline",
    tag: "Picked",
    blurb: "The logo, the name and the homepage headline in one centred stack, on white like the homepage.",
  },
  {
    id: "a-headline-distilled",
    name: "A, distilled",
    tag: "/impeccable distill",
    blurb: "Only the logo and the headline. The apps print the name and the domain themselves.",
  },
  {
    id: "b-note",
    name: "B. A note on a passage",
    tag: "Truer to the design",
    blurb: "A marked claim in an article and the extension's note card below it, with the rating buttons.",
  },
  {
    id: "b-note-distilled",
    name: "B, distilled",
    tag: "/impeccable distill",
    blurb: "Only the marked claim and the note: one soft fill, no cards, no shadow, no brand row.",
  },
];

/* The image's own size, so the crop overlay can work in its pixels. */
const IMAGE = { width: 1200, height: 630 };
/* The middle square that a square crop keeps, and the smaller square inside
 * it that the new options keep their content in. */
const SAFE_SIDE = 560;

const state = {
  optionId: readStored("optionId", OPTIONS[0].id),
  view: readStored("view", "apps"),
  appId: readStored("appId", APPS[0].id),
};

function readStored(key, fallback) {
  try {
    return localStorage.getItem(`lpe:${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}

function store(key, value) {
  state[key] = value;
  try {
    localStorage.setItem(`lpe:${key}`, value);
  } catch {
    /* Private windows may refuse storage. The page works without it. */
  }
}

const imageUrl = (optionId) => `../images/${optionId}.png`;
const optionById = (id) => OPTIONS.find((option) => option.id === id) ?? OPTIONS[0];

function renderOptions() {
  const container = document.getElementById("options");
  container.innerHTML = OPTIONS.map(
    (option) => `
      <button class="option" data-option="${option.id}" aria-pressed="${option.id === state.optionId}">
        <img src="${imageUrl(option.id)}" alt="">
        <span class="tag">${option.tag}</span>
        <b>${option.name}</b>
        <span>${option.blurb}</span>
      </button>`,
  ).join("");
  container.querySelectorAll(".option").forEach((button) => {
    button.addEventListener("click", () => {
      store("optionId", button.dataset.option);
      render();
    });
  });
}

function percentBox(left, top, width, height) {
  const toX = (value) => `${(value / IMAGE.width) * 100}%`;
  const toY = (value) => `${(value / IMAGE.height) * 100}%`;
  return `left:${toX(left)};top:${toY(top)};width:${toX(width)};height:${toY(height)}`;
}

function renderCrops() {
  const square = IMAGE.height;
  const twoOneHeight = IMAGE.width / 2;
  document.getElementById("crop-stage").innerHTML = `
    <img src="${imageUrl(state.optionId)}" alt="The selected preview image at full size">
    <div class="crop-box crop-twoone" style="${percentBox(0, (IMAGE.height - twoOneHeight) / 2, IMAGE.width, twoOneHeight)}"><span>2:1 crop</span></div>
    <div class="crop-box crop-square" style="${percentBox((IMAGE.width - square) / 2, 0, square, square)}"><span>Square crop</span></div>
    <div class="crop-box crop-safe" style="${percentBox((IMAGE.width - SAFE_SIDE) / 2, (IMAGE.height - SAFE_SIDE) / 2, SAFE_SIDE, SAFE_SIDE)}"><span>Safe area</span></div>`;
}

function rulesHtml(app) {
  return app.rules
    .map((rule) => {
      const badge = rule.confidence ? `<span class="confidence ${rule.confidence}">${rule.confidence}</span>` : "";
      const source = rule.source ? ` <a class="src" href="${rule.source}" target="_blank" rel="noreferrer">source</a>` : "";
      return `<li>${rule.text}${badge}${source}</li>`;
    })
    .join("");
}

function mockHtml(app, option, { showRules = true } = {}) {
  return `
    <article class="mock">
      <div class="mock-head"><h3>${app.name}</h3><span class="opt-name">${option.name}</span></div>
      <div class="stage" style="background:${app.stageBackground}">${app.render(imageUrl(option.id))}</div>
      ${showRules ? `<ul class="rules">${rulesHtml(app)}</ul>` : ""}
    </article>`;
}

function renderMocks() {
  const container = document.getElementById("mocks");
  const selectWrap = document.getElementById("app-select-wrap");
  selectWrap.hidden = state.view !== "compare";
  if (state.view === "compare") {
    const app = APPS.find((candidate) => candidate.id === state.appId) ?? APPS[0];
    /* Every card shows the same app, so its rules are listed once, under the
     * first card. */
    container.innerHTML = OPTIONS.map((option, index) => mockHtml(app, option, { showRules: index === 0 })).join("");
  } else {
    const option = optionById(state.optionId);
    container.innerHTML = APPS.map((app) => mockHtml(app, option)).join("");
  }
}

function renderViewSwitch() {
  document.querySelectorAll(".view-switch button").forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.view === state.view));
  });
}

function render() {
  renderOptions();
  renderCrops();
  renderViewSwitch();
  renderMocks();
}

function setUpControls() {
  document.querySelectorAll(".view-switch button").forEach((button) => {
    button.addEventListener("click", () => {
      store("view", button.dataset.view);
      render();
    });
  });
  const select = document.getElementById("app-select");
  select.innerHTML = APPS.map((app) => `<option value="${app.id}">${app.name}</option>`).join("");
  select.value = state.appId;
  select.addEventListener("change", () => {
    store("appId", select.value);
    renderMocks();
  });
  document.getElementById("explain").innerHTML = EXPLANATION;
}

setUpControls();
render();
