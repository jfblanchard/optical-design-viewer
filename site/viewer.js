// Lens Viewer: renders the static bundle written by `aiod export-viewer`.
// Data comes from manifest.js (window.LENS_MANIFEST, works from file://) or, failing that,
// manifest.json over http. Nothing is computed here.

"use strict";

const FAMILY_NAMES = {
  double_gauss: "Double-Gauss",
  cooke_triplet: "Cooke triplet",
  tessar: "Tessar",
  sonnar: "Sonnar",
  petzval: "Petzval",
  telephoto: "Telephoto",
  wide_angle_symmetric: "Symmetric wide angle",
  eyepiece: "Eyepieces",
  microscope: "Microscopes",
  microscope_objective: "Microscope objectives",
  telescope: "Telescopes",
  relay: "Relays",
};
// Photographic forms first, then visual instruments; unknown families sort after, by name.
const FAMILY_ORDER = Object.keys(FAMILY_NAMES);

const SEIDEL_NAMES = {
  S1_spherical: "S I spherical",
  S2_coma: "S II coma",
  S3_astig: "S III astigmatism",
  S4_petzval: "S IV Petzval",
  S5_distortion: "S V distortion",
  CL_axial_color: "C L axial color",
  CT_lateral_color: "C T lateral color",
};

const FIELD_UNITS = {
  angle: "deg",
  object_height: "mm object",
  paraxial_image_height: "mm image",
  real_image_height: "mm image",
};

// Center views by key. Each takes a design entry and returns an element. "2d" shows the
// precomputed cross-section; a later "3d" view can lathe `design.surfaces` (radius, conic,
// asphere, z, semi_diameter per surface) into Three.js geometry and register itself here.
const VIEWS = {
  "2d": (d) => figure(d.images.layout, `${d.title}: cross-section and ray trace`),
};

let manifest = null;
const byId = new Map();

const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k);
  return e;
}

function familyName(f) {
  return FAMILY_NAMES[f] || f.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function fmt(x, digits = 4) {
  if (x == null || Number.isNaN(x)) return "n/a";
  if (x === 0) return "0";
  const a = Math.abs(x);
  if (a >= 1e5 || a < 1e-3) return x.toExponential(2);
  return Number(x.toPrecision(digits)).toString();
}

function figure(src, alt) {
  return el("button", { class: "figure", title: "Enlarge", onclick: () => zoom(src, alt) }, el("img", { src, alt }));
}

function kv(rows) {
  return el("table", { class: "kv" },
    rows.filter((r) => r).map(([k, v, text]) =>
      el("tr", {}, el("td", {}, k), el("td", text ? { class: "text" } : {}, v))));
}

// Short always-on numbers: label over value, two to a row; `wide` rows span both columns.
function stats(rows) {
  return el("dl", { class: "stats" },
    rows.filter((r) => r).map(([k, v, wide]) =>
      el("div", wide ? { class: "wide" } : {}, el("dt", {}, k), el("dd", {}, v))));
}

// Collapsible right-panel section. Shut by default; whichever ones the reader opens stay open
// from design to design (and across visits).
const OPEN_KEY = "lensviewer.open";
const store = {  // localStorage can be absent or throw (privacy modes); then state lasts the visit
  get: () => { try { return JSON.parse(localStorage.getItem(OPEN_KEY)) || []; } catch { return []; } },
  set: (v) => { try { localStorage.setItem(OPEN_KEY, JSON.stringify(v)); } catch { /* keep in memory */ } },
};
const openSections = new Set(store.get());

function section(key, title, ...body) {
  const d = el("details", { class: "sec" }, el("summary", {}, title), el("div", { class: "body" }, ...body));
  d.open = openSections.has(key);
  d.addEventListener("toggle", () => {
    d.open ? openSections.add(key) : openSections.delete(key);
    store.set([...openSections]);
  });
  return d;
}

// --------------------------------------------------------------------------- plot zoom

function zoom(src, caption) {
  $("zoom-img").src = src;
  $("zoom-img").alt = caption;
  $("zoom-cap").textContent = caption;
  $("zoom").showModal();
}

// --------------------------------------------------------------------------- left list

function renderList() {
  const groups = new Map();
  for (const d of manifest.designs) {
    if (!groups.has(d.family)) groups.set(d.family, []);
    groups.get(d.family).push(d);
  }
  const rank = (f) => (FAMILY_ORDER.includes(f) ? FAMILY_ORDER.indexOf(f) : 1e3);
  const fams = [...groups.keys()].sort((a, b) => rank(a) - rank(b) || familyName(a).localeCompare(familyName(b)));
  $("list").replaceChildren(...fams.map((f) =>
    el("details", { class: "sec family" },
      el("summary", {}, familyName(f), el("span", { class: "n" }, String(groups.get(f).length))),
      el("div", { class: "body" },
        groups.get(f)
          .sort((a, b) => a.title.localeCompare(b.title))
          .map((d) => el("button", { "data-id": d.id, title: d.title, onclick: () => (location.hash = d.id) },
            shortTitle(d)))))));
}

function shortTitle(d) {
  // patent cards end with the citation ("..., US 3,874,771 Example 5"); the list wants the lens name
  return d.title.replace(/, [A-Z]{2} [\d ,]+ Example \w+$/, "");
}

// --------------------------------------------------------------------------- center

const PLOTS = [["spot", "Spot diagram"], ["fan", "Ray fan"], ["mtf", "MTF"]];

function renderCenter(d) {
  const fo = d.metrics.first_order;
  const sys = d.system;
  const meta = [
    familyName(d.family),
    `${d.form.elements} elements`,
    `${d.form.groups} groups`,
    sys.afocal ? "afocal" : `EFL ${fmt(fo.efl)} mm`,
    !sys.afocal && `f/${fmt(fo.fno, 3)}`,
    d.spec.magnifying_power != null && `${fmt(d.spec.magnifying_power, 3)}×`,
  ].filter(Boolean).join(" · ");

  const have = PLOTS.filter(([k]) => d.images[k]);
  const plots = have.length
    ? el("div", { class: "plots" }, PLOTS.map(([k, name]) => d.images[k]
      ? el("button", { class: "tile", title: `Enlarge ${name}`, onclick: () => zoom(d.images[k], `${shortTitle(d)}: ${name}`) },
        el("img", { src: d.images[k], alt: name }), el("span", {}, name))
      : el("div", { class: "tile none" }, el("span", {}, `${name}: not available`))))
    : el("p", { class: "fine plots-none" },
      d.notes.find((n) => n.startsWith("MTF")) || "No performance plots for this design.");

  $("view").replaceChildren(
    el("header", { class: "head" },
      el("h1", {}, shortTitle(d)),
      el("p", { class: "meta" }, meta,
        sys.configurations > 1 ? el("span", { class: "warn" }, ` · multi-config: showing 1 of ${sys.configurations}`) : null)),
    VIEWS["2d"](d),
    plots,
  );
}

// --------------------------------------------------------------------------- right panel

function renderPanel(d) {
  const fo = d.metrics.first_order;
  const sys = d.system;
  const fieldUnit = FIELD_UNITS[sys.field.type] || "";
  const spot = d.metrics.rms_spot;
  const dist = d.metrics.distortion;
  const src = d.source;

  const head = stats([
    !sys.afocal && ["EFL", `${fmt(fo.efl)} mm`],
    !sys.afocal && ["F/#", fmt(fo.fno, 3)],
    ["EPD", `${fmt(fo.epd)} mm`],
    d.spec.hfov_deg != null && ["Half field", `${fmt(d.spec.hfov_deg, 3)}°`],
    d.spec.apparent_hfov_deg != null && ["Apparent half field", `${fmt(d.spec.apparent_hfov_deg, 3)}°`],
    d.spec.magnifying_power != null && ["Magnifying power", `${fmt(d.spec.magnifying_power, 3)}×`],
    d.spec.na != null && ["NA", fmt(d.spec.na, 3)],
    !sys.afocal && ["BFL", `${fmt(fo.bfl)} mm`],
    ["Vertex length", `${fmt(fo.ttl)} mm`],
    ["Elements / groups", `${d.form.elements} / ${d.form.groups}`],
    d.form.sequence && ["Sequence", d.form.sequence, true],
  ]);

  const system = kv([
    d.form.stop && ["Stop", d.form.stop, true],
    ["Field", `${sys.field.values.map((v) => fmt(v, 3)).join(", ")} ${fieldUnit}`],
    ["Conjugate", `${d.spec.conjugate}${sys.afocal ? ` (measured through an ideal f = ${sys.analysis_f} mm lens)` : ""}`, true],
  ]);

  const seidel = kv([
    ...Object.entries(SEIDEL_NAMES).map(([k, name]) => [name, fmt(d.metrics.seidel[k])]),
    ["Petzval sum", `${fmt(d.metrics.petzval_sum_per_mm)} /mm`],
  ]);

  const spots = kv([
    ...spot.fields.map((f, i) => [`${fmt(f, 3)} ${fieldUnit}`, `${fmt(spot.values[i], 3)} ${spot.unit}`]),
    ["Distortion at full field", `${fmt(dist.max_pct, 3)} %`],
  ]);

  const notes = d.notes.filter((n) => !n.startsWith("multi-config"));

  $("panel").replaceChildren(
    el("h2", {}, "Specs"), head,
    section("system", "Stop, field, conjugate", system),
    section("seidel", "Seidel sums", seidel),
    section("spot", "RMS spot per field", spots),
    d.design_notes || notes.length
      ? section("notes", "Notes",
        d.design_notes ? el("p", { class: "prose" }, d.design_notes) : null,
        notes.length ? el("ul", { class: "notes" }, notes.map((n) => el("li", {}, n))) : null)
      : null,
    section("source", "Source",
      el("div", { class: "cite" },
        el("p", {}, src.ref),
        el("p", {}, src.locator),
        src.url ? el("p", {}, el("a", { href: src.url, rel: "noopener" }, "source file"),
          src.accessed ? ` (accessed ${src.accessed})` : "") : null)),
    section("provenance", "Provenance",
      el("div", { class: "cite" },
        el("p", {}, `License: ${src.license} · validation: ${d.validation_level}${d.verified ? "" : " (gate not passed)"}`),
        el("p", {}, Object.values(d.files).map((f) =>
          el("a", { href: f, download: "", class: "file" }, f.split("/").pop()))),
        el("p", {}, d.tags.map((t) => el("span", { class: "tag" }, t))),
        (manifest.caveats || []).length ? el("ul", { class: "notes" }, manifest.caveats.map((n) => el("li", {}, n))) : null)),
  );
}

// --------------------------------------------------------------------------- routing

function show(id) {
  const d = byId.get(id);
  for (const b of document.querySelectorAll(".family button")) {
    const on = b.dataset.id === id;
    b.classList.toggle("on", on);
    if (on) b.closest("details").open = true;  // the reader always sees which design is up
  }
  $("landing").hidden = !!d;
  $("view").hidden = !d;
  $("panel").hidden = !d;
  if (!d) return;
  renderCenter(d);
  renderPanel(d);
  $("center").scrollTop = 0;
  $("panel").scrollTop = 0;
  document.title = `${shortTitle(d)} · Lens Viewer`;
}

async function load() {
  if (window.LENS_MANIFEST) return window.LENS_MANIFEST;
  const r = await fetch("manifest.json");
  if (!r.ok) throw new Error(`manifest.json: HTTP ${r.status}`);
  return r.json();
}

load()
  .then((m) => {
    manifest = m;
    for (const d of m.designs) byId.set(d.id, d);
    $("count").textContent = `${m.count} designs in ${Object.keys(m.families).length} families.`;
    renderList();
    window.addEventListener("hashchange", () => show(location.hash.slice(1)));
    $("zoom").addEventListener("click", () => $("zoom").close());  // click anywhere closes; ESC is native
    show(location.hash.slice(1));
  })
  .catch((e) => {
    $("count").textContent = `Could not load the design data (${e.message}). Run \`aiod export-viewer\` first.`;
  });
