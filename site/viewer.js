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
  return el("div", { class: "figure" }, el("img", { src, alt }));
}

function kv(rows) {
  return el("table", { class: "kv" },
    rows.filter((r) => r).map(([k, v, text]) =>
      el("tr", {}, el("td", {}, k), el("td", text ? { class: "text" } : {}, v))));
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
    el("div", { class: "family" },
      el("h2", {}, `${familyName(f)} (${groups.get(f).length})`),
      groups.get(f)
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((d) => el("button", { "data-id": d.id, title: d.title, onclick: () => (location.hash = d.id) },
          shortTitle(d))))));
}

function shortTitle(d) {
  // patent cards end with the citation ("..., US 3,874,771 Example 5"); the list wants the lens name
  return d.title.replace(/, [A-Z]{2} [\d ,]+ Example \w+$/, "");
}

// --------------------------------------------------------------------------- center

function renderCenter(d) {
  const notes = [];
  if (d.system.configurations > 1) {
    notes.push(el("li", { class: "warn" }, `Multi-config (${d.system.configurations} configurations): showing first.`));
  }
  for (const n of d.notes.filter((n) => !n.startsWith("multi-config"))) notes.push(el("li", {}, n));
  for (const n of manifest.caveats || []) notes.push(el("li", {}, n));

  $("view").replaceChildren(
    el("h1", {}, d.title),
    el("p", { class: "meta" },
      `${familyName(d.family)}${d.subtype ? " · " + d.subtype.replace(/_/g, " ") : ""}`
      + ` · ${d.form.elements} elements in ${d.form.groups} groups`
      + (d.system.afocal ? " · afocal" : "")),
    VIEWS["2d"](d),
    d.design_notes ? el("p", { class: "prose" }, d.design_notes) : null,
    notes.length ? el("ul", { class: "notes" }, notes) : null,
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

  const specs = kv([
    !sys.afocal && ["EFL", `${fmt(fo.efl)} mm`],
    !sys.afocal && ["F/#", fmt(fo.fno, 3)],
    ["EPD", `${fmt(fo.epd)} mm`],
    d.spec.hfov_deg != null && ["Half field", `${fmt(d.spec.hfov_deg, 3)}°`],
    d.spec.apparent_hfov_deg != null && ["Apparent half field", `${fmt(d.spec.apparent_hfov_deg, 3)}°`],
    d.spec.magnifying_power != null && ["Magnifying power", `${fmt(d.spec.magnifying_power, 3)}×`],
    d.spec.na != null && ["NA", fmt(d.spec.na, 3)],
    !sys.afocal && ["BFL", `${fmt(fo.bfl)} mm`],
    ["Length (first to last surface)", `${fmt(fo.ttl)} mm`],
    ["Elements / groups", `${d.form.elements} / ${d.form.groups}`],
    d.form.sequence && ["Sequence", d.form.sequence],
    d.form.stop && ["Stop", d.form.stop, true],
    ["Field", `${sys.field.values.map((v) => fmt(v, 3)).join(", ")} ${fieldUnit}`],
    ["Conjugate", `${d.spec.conjugate}${sys.afocal ? ` (measured through an ideal f = ${sys.analysis_f} mm lens)` : ""}`, true],
  ]);

  const seidel = kv([
    ...Object.entries(SEIDEL_NAMES).map(([k, name]) => [name, fmt(d.metrics.seidel[k])]),
    ["Petzval sum", `${fmt(d.metrics.petzval_sum_per_mm)} /mm`],
  ]);

  const spots = kv(spot.fields.map((f, i) => [`${fmt(f, 3)} ${fieldUnit}`, `${fmt(spot.values[i], 3)} ${spot.unit}`]));

  const img = (key, alt) => (d.images[key] ? el("img", { class: "plot", src: d.images[key], alt }) : null);

  $("panel").replaceChildren(
    el("h2", {}, "Specs"), specs,
    el("h2", {}, "Seidel sums"), seidel,
    el("h2", {}, "RMS spot per field"), spots, img("spot", "RMS spot per field"),
    el("h2", {}, "MTF"),
    img("mtf", "MTF") || el("p", { class: "fine" }, (d.notes.find((n) => n.startsWith("MTF")) || "MTF not available.")),
    el("h2", {}, "Distortion"),
    kv([["At full field", `${fmt(dist.max_pct, 3)} %`]]),
    img("distortion", "Distortion vs field"),
    el("h2", {}, "Source"),
    el("div", { class: "cite" },
      el("p", {}, src.ref),
      el("p", {}, src.locator),
      src.url ? el("p", {}, el("a", { href: src.url, rel: "noopener" }, "source file"),
        src.accessed ? ` (accessed ${src.accessed})` : "") : null,
      el("p", {}, `License: ${src.license} · validation: ${d.validation_level}${d.verified ? "" : " (gate not passed)"}`),
      el("p", {}, Object.values(d.files).map((f) =>
        el("a", { href: f, download: "", style: "margin-right:0.75rem" }, f.split("/").pop()))),
      el("p", {}, d.tags.map((t) => el("span", { class: "tag" }, t)))),
  );
}

// --------------------------------------------------------------------------- routing

function show(id) {
  const d = byId.get(id);
  for (const b of document.querySelectorAll(".family button")) b.classList.toggle("on", b.dataset.id === id);
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
    show(location.hash.slice(1));
  })
  .catch((e) => {
    $("count").textContent = `Could not load the design data (${e.message}). Run \`aiod export-viewer\` first.`;
  });
