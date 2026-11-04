const DATA = window.DATA;
const storeKey = "standortsuche-desk-v3";

const FILTERS = [
  ["alle", "Alle"],
  ["rz", "RZ"],
  ["gleis", "Gleis"],
  ["neu", "Neu"],
  ["gespraech", "Gespräch"],
];

const STAGE = { offen: "Offen", pruefung: "Prüfung", gespraech: "Gespräch", abgelegt: "Abgelegt" };

const BASE_SOURCES = [
  { name: "APG, freie Bezugsleistung", note: "Monatstabelle, Stand 1. Oktober 2026" },
  { name: "Netzentwicklungsplan 2025", note: "geplante Werke" },
  { name: "BEV Kataster", note: "Fläche und Nummer, ohne Eigentümer" },
  { name: "Grundbuch, B-Blatt", note: "erst auf Zuruf, im Beispiel 2,60 €" },
];

const PLACES = {
  klosterneuburg: [48.305, 16.326],
  korneuburg: [48.345, 16.333],
  gänserndorf: [48.339, 16.72],
  gaenserndorf: [48.339, 16.72],
  baden: [48.006, 16.234],
  mödling: [48.086, 16.289],
  moedling: [48.086, 16.289],
  wien: [48.208, 16.373],
};

const state = {
  view: "karte",
  filter: "alle",
  inspect: false,
  cover: false,
  parcelId: null,
  stationId: null,
  hover: null,
  revealed: false,
  running: false,
  runAt: 0,
  opened: {},
  stages: {},
  base: "map",
  layers: { parcels: true, live: true, plan: true },
  rightShut: false,
  extra: [],
  sources: [],
  changes: [],
};

Object.assign(state, loadStore());

const map = L.map("map", {
  zoomControl: false,
  attributionControl: true,
  zoomSnap: 0,
  zoomDelta: 1,
  wheelPxPerZoomLevel: 12,
  wheelDebounceTime: 8,
  zoomAnimation: true,
  zoomAnimationThreshold: 8,
  fadeAnimation: true,
  markerZoomAnimation: true,
  inertia: true,
  inertiaDeceleration: 1800,
  easeLinearity: 0.08,
  minZoom: 8,
  maxZoom: 20,
});

const tileBase = { updateWhenZooming: false, updateWhenIdle: true, keepBuffer: 8, maxZoom: 20 };
const streets = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", Object.assign({ attribution: "&copy; OpenStreetMap", maxNativeZoom: 19 }, tileBase));
const satellite = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  Object.assign({ attribution: "Bilder &copy; Esri", maxNativeZoom: 18 }, tileBase)
);
map.createPane("labelPane");
map.getPane("labelPane").style.zIndex = "350";
map.getPane("labelPane").style.pointerEvents = "none";
const labels = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
  Object.assign({ pane: "labelPane", opacity: 0.85, maxNativeZoom: 19 }, tileBase)
);

const parcelLayer = L.layerGroup().addTo(map);
const liveLayer = L.layerGroup().addTo(map);
const planLayer = L.layerGroup().addTo(map);
const linkLayer = L.layerGroup().addTo(map);
const parcelGfx = {};

function easeS(t) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

function glide(latlng, zoom, ms) {
  map._stop();
  const targetCenter = L.latLng(latlng);
  const targetZoom = zoom == null ? map.getZoom() : map._limitZoom(zoom);
  const from = map.project(map.getCenter());
  const to = map.project(targetCenter);
  const size = map.getSize();
  const startZoom = map._zoom;
  const w0 = Math.max(size.x, size.y);
  const w1 = w0 * map.getZoomScale(startZoom, targetZoom);
  const u1 = to.distanceTo(from) || 1;
  const rho = 1.42;
  const rho2 = rho * rho;
  const r = (i) => {
    const s1 = i ? -1 : 1;
    const s2 = i ? w1 : w0;
    const t1 = w1 * w1 - w0 * w0 + s1 * rho2 * rho2 * u1 * u1;
    const b = t1 / (2 * s2 * rho2 * u1);
    const sq = Math.sqrt(b * b + 1) - b;
    return sq < 0.000000001 ? -18 : Math.log(sq);
  };
  const sinh = (n) => (Math.exp(n) - Math.exp(-n)) / 2;
  const cosh = (n) => (Math.exp(n) + Math.exp(-n)) / 2;
  const tanh = (n) => sinh(n) / cosh(n);
  const r0 = r(0);
  const w = (s) => w0 * (cosh(r0) / cosh(r0 + rho * s));
  const u = (s) => (w0 * (cosh(r0) * tanh(r0 + rho * s) - sinh(r0))) / rho2;
  const S = (r(1) - r0) / rho;
  const duration = ms || Math.min(980, Math.max(460, Math.abs(S) * 380));
  const start = performance.now();
  map._moveStart(targetZoom !== startZoom, false);
  const frame = (now) => {
    const t = (now - start) / duration;
    if (t < 1) {
      const s = easeS(t) * S;
      map._flyToFrame = requestAnimationFrame(frame);
      map._move(
        map.unproject(from.add(to.subtract(from).multiplyBy(u(s) / u1)), startZoom),
        map.getScaleZoom(w0 / w(s), startZoom),
        { flyTo: true }
      );
    } else {
      map._move(targetCenter, targetZoom)._moveEnd(true);
    }
  };
  map._flyToFrame = requestAnimationFrame(frame);
}

function loadStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(storeKey) || "{}");
    return {
      revealed: !!raw.revealed,
      runAt: raw.revealed ? 3 : 0,
      opened: raw.opened || {},
      stages: raw.stages || {},
      base: raw.base === "sat" ? "sat" : "map",
      layers: Object.assign({ parcels: true, live: true, plan: true }, raw.layers || {}),
      rightShut: !!raw.rightShut,
      extra: raw.extra || [],
      sources: raw.sources || [],
      changes: raw.changes || [],
      filter: raw.filter || "alle",
    };
  } catch {
    return {};
  }
}

function saveStore() {
  localStorage.setItem(
    storeKey,
    JSON.stringify({
      revealed: state.revealed,
      opened: state.opened,
      stages: state.stages,
      base: state.base,
      layers: state.layers,
      rightShut: state.rightShut,
      extra: state.extra,
      sources: state.sources,
      changes: state.changes.slice(0, 16),
      filter: state.filter,
    })
  );
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function parcels() {
  return DATA.parcels.concat(state.extra);
}

function parcelById(id) {
  return parcels().find((p) => p.id === id);
}

function stationById(id) {
  return DATA.substations.find((s) => s.id === id);
}

function km(a, b) {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function fmtKm(d) {
  return d.toFixed(1).replace(".", ",") + " km";
}
function fmtHa(n) {
  return Number(n).toFixed(1).replace(".", ",") + " ha";
}
function kindLabel(kind) {
  if (kind === "bestehend") return "bestehend";
  if (kind === "ausbau") return "Ausbau";
  return "geplant";
}
function nearest(parcel, kinds) {
  return DATA.substations
    .filter((s) => kinds.includes(s.kind))
    .map((s) => ({ s, d: km(parcel, s) }))
    .sort((a, b) => a.d - b.d)[0];
}
function signalOf(p) {
  if (p.id === "sw" && !state.revealed) return "";
  return p.signal || "";
}
function stageOf(id) {
  return state.stages[id] || "offen";
}
function isNew(p) {
  return !!p.created || (p.id === "sw" && state.revealed && !!p.signal);
}
function fits(p) {
  const tags = [];
  if (!p.altlast && p.ha >= 2) tags.push("rz");
  if (!p.altlast && p.rail && p.ha >= 1.5) tags.push("gleis");
  return tags;
}
function score(p) {
  const planned = nearest(p, ["geplant", "ausbau"]);
  let s = 0;
  if (p.ha >= 2) s += 24;
  else if (p.ha >= 1.5) s += 8;
  if (planned && planned.d < 8) s += Math.round((8 - planned.d) * 4);
  if (signalOf(p)) s += 36;
  if (p.rail) s += 10;
  if (p.altlast) s -= 40;
  if (stageOf(p.id) === "gespraech") s += 8;
  if (stageOf(p.id) === "abgelegt") s -= 50;
  return s;
}
function ranked() {
  return parcels().slice().sort((a, b) => score(b) - score(a) || b.ha - a.ha);
}
function filtered() {
  return ranked().filter((p) => {
    if (state.filter === "rz") return fits(p).includes("rz");
    if (state.filter === "gleis") return fits(p).includes("gleis");
    if (state.filter === "neu") return isNew(p);
    if (state.filter === "gespraech") return stageOf(p.id) === "gespraech";
    return true;
  });
}
function marks(p) {
  const bits = [];
  if (fits(p).includes("rz")) bits.push('<span class="mark rz">RZ</span>');
  if (fits(p).includes("gleis")) bits.push('<span class="mark gleis">Gleis</span>');
  if (p.altlast) bits.push('<span class="mark warn">Altlast</span>');
  if (p.ha < 1.5) bits.push('<span class="mark">klein</span>');
  if (isNew(p)) bits.push('<span class="mark fresh">neu</span>');
  else if (stageOf(p.id) === "gespraech") bits.push('<span class="mark talk">Gespräch</span>');
  else if (stageOf(p.id) !== "offen") bits.push(`<span class="mark">${STAGE[stageOf(p.id)]}</span>`);
  return bits.join("");
}
function lineOf(p) {
  const planned = nearest(p, ["geplant", "ausbau"]);
  const bits = [fmtHa(p.ha), p.zoning];
  if (planned) bits.push(fmtKm(planned.d) + " bis " + planned.s.name);
  if (signalOf(p)) bits.push("Meldung hängt an der Akte");
  return bits.join(" · ");
}
function remember(text, parcelId) {
  state.changes.unshift({ text, parcelId: parcelId || "", at: Date.now() });
  state.changes = state.changes.slice(0, 16);
  saveStore();
}

function fly(lat, lng, minZoom) {
  glide([lat, lng], Math.max(map.getZoom(), minZoom || map.getZoom()));
}

function setBase(mode) {
  state.base = mode;
  document.body.classList.toggle("base-map", mode === "map");
  document.body.classList.toggle("base-sat", mode === "sat");
  if (mode === "sat") {
    if (map.hasLayer(streets)) map.removeLayer(streets);
    if (!map.hasLayer(satellite)) satellite.addTo(map);
    if (!map.hasLayer(labels)) labels.addTo(map);
    satellite.bringToBack();
  } else {
    if (map.hasLayer(satellite)) map.removeLayer(satellite);
    if (map.hasLayer(labels)) map.removeLayer(labels);
    if (!map.hasLayer(streets)) streets.addTo(map);
    streets.bringToBack();
  }
  document.querySelectorAll("#basemap button").forEach((btn) => btn.classList.toggle("on", btn.dataset.base === mode));
  saveStore();
}

function applyLayers() {
  const use = (layer, on) => {
    if (on && !map.hasLayer(layer)) layer.addTo(map);
    if (!on && map.hasLayer(layer)) map.removeLayer(layer);
  };
  use(parcelLayer, state.layers.parcels);
  use(liveLayer, state.layers.live);
  use(planLayer, state.layers.plan);
  document.querySelectorAll("#layers button").forEach((btn) => btn.classList.toggle("on", !!state.layers[btn.dataset.layer]));
}

function setRight(shut) {
  state.rightShut = shut;
  document.body.classList.toggle("right-shut", shut);
  const btn = document.getElementById("right-toggle");
  btn.textContent = shut ? "‹" : "›";
  btn.setAttribute("aria-label", shut ? "Rechts ausklappen" : "Rechts einklappen");
  saveStore();
  window.setTimeout(() => map.invalidateSize(), 720);
}

function drawStations() {
  liveLayer.clearLayers();
  planLayer.clearLayers();
  DATA.substations.forEach((s) => {
    const icon = L.divIcon({
      className: "pin-wrap",
      html: `<span class="pin-stack"><span class="pin ${s.kind} ${state.stationId === s.id ? "on" : ""}"></span><span class="pin-name">${esc(s.name)}</span></span>`,
      iconSize: [220, 28],
      iconAnchor: [9, 14],
    });
    const marker = L.marker([s.lat, s.lng], { icon, zIndexOffset: 200 });
    marker.bindTooltip(`<span class="tip"><b>${esc(s.name)}</b><span>${esc(kindLabel(s.kind))}</span></span>`, {
      className: "glass-tip",
      direction: "top",
      offset: [0, -8],
      opacity: 1,
    });
    marker.on("click", () => openStation(s.id));
    marker.addTo(s.kind === "bestehend" ? liveLayer : planLayer);
  });
}

function drawParcels() {
  parcelLayer.clearLayers();
  parcels().forEach((p) => {
    const hot = state.parcelId === p.id || state.hover === p.id;
    const color = p.altlast ? "#ff9d90" : isNew(p) ? "#ffc56d" : score(p) < 10 ? "#c5ced6" : "#8ee0c4";
    const circle = L.circle([p.lat, p.lng], {
      radius: Math.sqrt((p.ha * 10000) / Math.PI),
      color,
      weight: hot ? 2.6 : 2,
      opacity: 1,
      fillColor: color,
      fillOpacity: hot ? 0.34 : 0.22,
    });
    circle.on("click", () => openParcel(p.id));
    circle.addTo(parcelLayer);
    const cls = ["pin"];
    if (p.altlast) cls.push("bad");
    else if (isNew(p)) cls.push("fresh");
    else if (score(p) < 10) cls.push("weak");
    if (state.parcelId === p.id) cls.push("on");
    if (state.hover === p.id) cls.push("hot");
    const marker = L.marker([p.lat, p.lng], {
      icon: L.divIcon({
        className: "pin-wrap",
        html: `<span class="pin-stack"><span class="${cls.join(" ")}"></span><span class="pin-name">${esc(p.kg)}</span></span>`,
        iconSize: [180, 28],
        iconAnchor: [9, 14],
      }),
      zIndexOffset: hot ? 700 : 400,
    });
    marker.bindTooltip(`<span class="tip"><b>${esc(p.kg)}</b><span>GST ${esc(p.gst)} · ${esc(fmtHa(p.ha))}</span></span>`, {
      className: "glass-tip",
      direction: "top",
      offset: [0, -8],
      opacity: 1,
    });
    marker.on("click", () => openParcel(p.id));
    marker.on("mouseover", () => setHover(p.id));
    marker.on("mouseout", () => setHover(null));
    marker.addTo(parcelLayer);
    parcelGfx[p.id] = { circle, marker };
  });
}

function paintLinks() {
  linkLayer.clearLayers();
  const p = state.parcelId ? parcelById(state.parcelId) : null;
  if (!p) return;
  [nearest(p, ["bestehend"]), nearest(p, ["geplant", "ausbau"])].forEach((hit) => {
    if (!hit) return;
    const line = L.polyline(
      [
        [p.lat, p.lng],
        [hit.s.lat, hit.s.lng],
      ],
      { color: "#f4f7fb", weight: 1.5, opacity: 0.75, dashArray: "1 8" }
    );
    line.on("click", () => openStation(hit.s.id));
    line.addTo(linkLayer);
  });
}

function setHover(id) {
  if (state.hover === id) return;
  state.hover = id;
  document.querySelectorAll("#list .row").forEach((row) => row.classList.toggle("hot", row.dataset.id === id));
  parcels().forEach((p) => {
    const gfx = parcelGfx[p.id];
    if (!gfx) return;
    const hot = state.hover === p.id || state.parcelId === p.id;
    const pin = gfx.marker.getElement() && gfx.marker.getElement().querySelector(".pin");
    if (pin) pin.classList.toggle("hot", state.hover === p.id);
    gfx.circle.setStyle({ weight: hot ? 2.6 : 2, fillOpacity: hot ? 0.34 : 0.22 });
  });
}

function updateCounts() {
  const open = ranked().filter((p) => stageOf(p.id) === "offen" || stageOf(p.id) === "pruefung").length;
  const talk = ranked().filter((p) => stageOf(p.id) === "gespraech").length;
  document.getElementById("counts").textContent = open + " in Arbeit · " + talk + " Gespräch";
}

function filterButtons() {
  return `<div class="filters">${FILTERS.map(
    ([id, label]) => `<button type="button" data-filter="${id}" class="${state.filter === id ? "on" : ""}">${label}</button>`
  ).join("")}</div>`;
}

function listRows() {
  const rows = filtered();
  return (
    rows
      .map(
        (p) => `<button type="button" class="row ${state.parcelId === p.id ? "on" : ""}" data-id="${p.id}">
        <span class="row-top"><strong>${esc(p.kg)}</strong><span class="marks">${marks(p)}</span></span>
        <em>GST ${esc(p.gst)} · ${esc(lineOf(p))}</em>
      </button>`
      )
      .join("") || `<p class="quiet" style="padding:8px 10px">In diesem Filter liegt keine Fläche.</p>`
  );
}

function listPane() {
  return `<div class="dock-head">
      <div>
        <p class="kicker">Karte</p>
        <h1>${filtered().length} Möglichkeiten</h1>
      </div>
      <button type="button" class="mini" id="next">Nächste</button>
    </div>
    ${filterButtons()}
    <div id="list">${listRows()}</div>`;
}

function ledger(p) {
  const change = signalOf(p);
  return `<button type="button" class="ledger ${state.parcelId === p.id ? "on" : ""}" data-id="${p.id}">
    <span class="ledger-top"><strong>${esc(p.kg)}, GST ${esc(p.gst)}</strong><span class="marks">${marks(p)}</span></span>
    <em>${esc(lineOf(p))}${change ? " · " + esc(change) : ""}</em>
  </button>`;
}

function renderPane() {
  const pane = document.getElementById("pane");
  const top = pane.scrollTop;
  const wide = state.view !== "karte";
  document.body.classList.toggle("wide", wide);
  updateCounts();
  const open = !!(state.parcelId || state.stationId);
  if (!wide) {
    pane.innerHTML = state.inspect && open ? dossier("Zur Liste") : listPane();
  } else if (state.cover && open) {
    pane.innerHTML = dossier("Zurück");
  } else {
    const main = state.view === "akten" ? aktenSheet() : state.view === "bericht" ? reportSheet() : powerSheet();
    pane.innerHTML = `<div class="split"><div class="split-main">${main}</div></div>`;
  }
  bindPane(pane);
  if (state.parcelId) {
    const p = parcelById(state.parcelId);
    document.getElementById("chat-context").textContent = "Akte " + p.kg + ", GST " + p.gst;
  } else if (state.stationId) {
    document.getElementById("chat-context").textContent = stationById(state.stationId).name;
  } else document.getElementById("chat-context").textContent = "Alle Akten";
  pane.scrollTop = top;
}

function werkOf(p) {
  const hit = nearest(p, ["geplant", "ausbau"]) || nearest(p, ["bestehend"]);
  return hit ? fmtKm(hit.d) + " · " + hit.s.name : "—";
}

function aktenSheet() {
  const rows = filtered();
  const body = rows
    .map((p) => {
      const stage = stageOf(p.id);
      const note = signalOf(p);
      return `<button type="button" class="akten-row ${state.parcelId === p.id ? "on" : ""}" data-id="${p.id}">
        <span class="akten-name"><strong>${esc(p.kg)}</strong><em>GST ${esc(p.gst)}</em>${note ? `<em class="akten-note">${esc(note)}</em>` : ""}</span>
        <span class="marks">${marks(p)}</span>
        <span class="num">${esc(fmtHa(p.ha))}</span>
        <span>${esc(p.zoning)}</span>
        <span>${esc(werkOf(p))}</span>
        <span class="status ${stage}">${STAGE[stage]}</span>
      </button>`;
    })
    .join("") || `<p class="quiet">In diesem Filter liegt keine Akte.</p>`;
  return `<div class="akten">
    <div class="akten-bar">
      <div><p class="kicker">Liste</p><h2>Akten</h2></div>
      <span class="akten-count">${rows.length} Flächen</span>
    </div>
    ${filterButtons()}
    <div class="akten-scroll">
      <div class="akten-head"><span>Fläche</span><span>Marke</span><span>Größe</span><span>Widmung</span><span>Nächstes Werk</span><span>Stand</span></div>
      ${body}
    </div>
  </div>`;
}

function reportSheet() {
  const changes = state.changes.slice();
  if (state.revealed && !changes.some((c) => c.parcelId === "sw")) {
    changes.unshift({
      text: "Schwechat, GST 412/3. " + DATA.parcels[0].signal,
      parcelId: "sw",
    });
  }
  const changeHtml = changes.length
    ? changes.map((c) => {
        const p = c.parcelId ? parcelById(c.parcelId) : null;
        return p ? ledger(p) : `<p>${esc(c.text)}</p>`;
      }).join("")
    : `<p>Seit dem Öffnen hat sich an den Akten nichts geändert.</p>`;
  const added = state.sources.map((s) => s.name).join(", ");
  return `<div class="sheet">
    <p class="kicker">Morgenbericht</p>
    <h2>Was heute anders ist</h2>
    <p class="when">Ein Suchgebiet, alle Akten. Beispiel, keine echten Eigentümer.</p>
    <p>Die Stromlage ist unverändert. An den Werken der Austrian Power Grid ist keine freie uneingeschränkte Bezugsleistung ausgewiesen. Offene Anträge auf Bezug: 14.084 Megawatt in Niederösterreich, 927 Megawatt in Wien, als Summe je Land. Stand 1. Oktober 2026. Den Anschluss sagt der Netzbetreiber zu.</p>
    <h3>Änderungen</h3>
    ${changeHtml}
    <h3>Alle potenziellen Akten</h3>
    ${ranked().map(ledger).join("")}
    <h3>Quellen</h3>
    <p>${BASE_SOURCES.map((s) => esc(s.name)).join(" · ")}${added ? " · Im Gespräch ergänzt: " + esc(added) : ""}</p>
  </div>`;
}

function powerSheet() {
  return `<div class="sheet">
    <p class="kicker">Strom</p>
    <h2>Bezug für die Akte, nicht Einspeisung</h2>
    <p class="when">Öffentliche Tabelle, fest im Prototyp. Ein Werk anklicken öffnet es auf der ganzen Fläche.</p>
    <p>0 Megawatt freie uneingeschränkte Bezugsleistung an jedem ausgewiesenen Werk. Die Anträge sind Summen je Bundesland, nicht die freie Leistung eines einzelnen Werks. Ein Rechenzentrum braucht oft 50 bis 200 Megawatt.</p>
    <h3>Werke</h3>
    ${DATA.substations.map((s) => `<button type="button" class="ledger" data-station="${s.id}"><span class="ledger-top"><strong>${esc(s.name)}</strong><span class="mark">${esc(kindLabel(s.kind))}</span></span><em>${esc(s.note)}</em></button>`).join("")}
  </div>`;
}

function dossier(backLabel) {
  const body = state.parcelId ? parcelFile(parcelById(state.parcelId)) : `<div class="file-scroll">${stationFile(stationById(state.stationId))}</div>`;
  const nav = state.parcelId
    ? `<span class="dossier-nav"><button type="button" class="mini" id="prev">Vorherige</button><button type="button" class="mini" id="next-file">Nächste</button></span>`
    : "";
  return `<div class="dossier">
    <div class="dossier-bar">
      <button type="button" class="mini" id="back">${esc(backLabel)}</button>
      ${nav}
    </div>
    ${body}
  </div>`;
}

function whyLines(p) {
  const planned = nearest(p, ["geplant", "ausbau"]);
  const existing = nearest(p, ["bestehend"]);
  const lines = [];
  if (p.ha >= 2) lines.push(fmtHa(p.ha) + ", damit über der Schwelle von 2 ha für ein Rechenzentrum.");
  else if (p.ha >= 1.5) lines.push(fmtHa(p.ha) + ", unter 2 ha und deshalb kein Rechenzentrum, über 1,5 ha.");
  else lines.push(fmtHa(p.ha) + ", unter 1,5 ha. Die Fläche bleibt sichtbar, sie ist zu klein.");
  lines.push("Widmung im Beispiel: " + p.zoning + ".");
  lines.push(p.altlast ? "Altlast im Beispiel. Damit fällt sie für Rechenzentrum und Gleis weg." : "Keine Altlast im Beispiel.");
  lines.push(p.rail ? "Gleisanschluss im Beispiel. Damit passt sie auch zur Logistik." : "Kein Gleis im Beispiel.");
  if (planned) {
    const kind = kindLabel(planned.s.kind);
    const name = planned.s.name.toLowerCase().includes(kind.toLowerCase()) ? planned.s.name : planned.s.name + ", " + kind;
    lines.push(fmtKm(planned.d) + " bis " + name + ". " + planned.s.note);
  }
  if (existing) lines.push(fmtKm(existing.d) + " bis " + existing.s.name + ", bestehend. " + existing.s.note);
  lines.push("Öffentliche Tabelle: 0 MW freie uneingeschränkte Bezugsleistung. Die Nähe zu einem Werk ist keine Anschlusszusage.");
  if (signalOf(p)) lines.push(signalOf(p));
  return lines;
}

function fact(label, value) {
  return `<div class="fact"><span>${esc(label)}</span><strong>${value}</strong></div>`;
}

function parcelFile(p) {
  const existing = nearest(p, ["bestehend"]);
  const planned = nearest(p, ["geplant", "ausbau"]);
  const opened = state.opened[p.id];
  const stage = stageOf(p.id);
  return `
    <div class="file-scroll">
      <p class="kicker">Akte · Beispiel</p>
      <h2>${esc(p.kg)}</h2>
      <p class="marks">${marks(p)}</p>
      <div class="facts">
        ${fact("Grundstück", "GST " + esc(p.gst))}
        ${fact("Größe", esc(fmtHa(p.ha)))}
        ${fact("Widmung", esc(p.zoning))}
        ${fact("Stand", esc(STAGE[stage]))}
        ${fact("Gleis", p.rail ? "Ja, im Beispiel" : "Nein")}
        ${fact("Altlast", p.altlast ? "Ja, im Beispiel" : "Nein")}
        ${fact("Interesse", String(score(p)))}
        ${fact("Eigentümer", opened ? esc(p.owner) : "Noch nicht geholt")}
      </div>
      <h3>Warum diese Fläche</h3>
      <ul class="why">${whyLines(p).map((line) => `<li>${esc(line)}</li>`).join("")}</ul>
      <h3>Werke</h3>
      <div class="mini-row">
        <button type="button" class="mini" data-station="${existing.s.id}">${esc(fmtKm(existing.d))} · ${esc(existing.s.name)}</button>
        <button type="button" class="mini" data-station="${planned.s.id}">${esc(fmtKm(planned.d))} · ${esc(planned.s.name)}</button>
      </div>
    </div>
    <div class="file-actions">
      ${p.owner ? `<button type="button" class="pill" id="gb">${opened ? "Auszug liegt vor" : "B-Blatt, 2,60 €"}</button>` : ""}
      <button type="button" class="pill ${stage === "pruefung" ? "on" : ""}" data-stage="pruefung">Prüfung</button>
      <button type="button" class="pill ${stage === "gespraech" ? "on" : ""}" data-stage="gespraech">Gespräch</button>
      <button type="button" class="pill ${stage === "abgelegt" ? "on" : ""}" data-stage="abgelegt">Ablegen</button>
    </div>`;
}

function stationFile(s) {
  const near = parcels()
    .map((p) => ({ p, d: km(p, s) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 4);
  return `
    <p class="kicker">Werk · ${esc(kindLabel(s.kind))}</p>
    <h2>${esc(s.name)}</h2>
    <p class="meta-line">${esc(s.note)}</p>
    <p class="meta-line">0 MW freie uneingeschränkte Bezugsleistung in der öffentlichen Tabelle. Anträge: 14.084 MW Niederösterreich, 927 MW Wien, je Land. Keine Anschlusszusage.</p>
    ${near.map((hit) => `<button type="button" class="row" data-id="${hit.p.id}"><span class="row-top"><strong>${esc(hit.p.kg)}</strong></span><em>GST ${esc(hit.p.gst)} · ${esc(fmtKm(hit.d))}</em></button>`).join("")}`;
}

function bindPane(root) {
  root.querySelectorAll("#list .row").forEach((btn) => {
    btn.onmouseenter = () => setHover(btn.dataset.id);
    btn.onmouseleave = () => setHover(null);
  });
  root.querySelectorAll("[data-id]").forEach((btn) => {
    btn.onclick = () => openParcel(btn.dataset.id, state.view === "karte");
  });
  root.querySelectorAll("[data-station]").forEach((btn) => {
    btn.onclick = () => openStation(btn.dataset.station, state.view === "karte");
  });
  root.querySelectorAll("[data-filter]").forEach((btn) => {
    btn.onclick = () => {
      state.filter = btn.dataset.filter;
      saveStore();
      renderPane();
    };
  });
  const back = root.querySelector("#back");
  if (back) back.onclick = () => {
    state.inspect = false;
    state.cover = false;
    renderPane();
  };
  const next = root.querySelector("#next");
  if (next) next.onclick = nextParcel;
  const prev = root.querySelector("#prev");
  if (prev) prev.onclick = () => stepParcel(-1);
  const nextFile = root.querySelector("#next-file");
  if (nextFile) nextFile.onclick = () => stepParcel(1);
  const gb = root.querySelector("#gb");
  if (gb) {
    gb.onclick = () => {
      const id = state.parcelId;
      const p = parcelById(id);
      if (!id || state.opened[id] || !p.owner) return;
      state.opened[id] = true;
      if (stageOf(id) === "offen") state.stages[id] = "pruefung";
      remember(p.kg + ": B-Blatt im Beispiel, " + p.owner, id);
      refresh();
      addBot(p.kg + ", GST " + p.gst + ": Beispielname " + p.owner + ". Angesetzt mit 2,60 €.");
    };
  }
  root.querySelectorAll("[data-stage]").forEach((btn) => {
    btn.onclick = () => setStage(state.parcelId, btn.dataset.stage);
  });
}

function setStage(id, next) {
  const p = parcelById(id);
  if (!p) return;
  if (stageOf(id) === next) delete state.stages[id];
  else state.stages[id] = next;
  remember(p.kg + " steht auf " + STAGE[stageOf(id)] + ".", id);
  refresh();
}

function refresh() {
  renderPane();
  drawParcels();
  drawStations();
  paintLinks();
  applyLayers();
}

function openParcel(id, move) {
  state.parcelId = id;
  state.stationId = null;
  if (state.view === "karte") state.inspect = true;
  else state.cover = true;
  const p = parcelById(id);
  if (move !== false && p) fly(p.lat, p.lng, 12.25);
  refresh();
}

function openStation(id, move) {
  state.stationId = id;
  state.parcelId = null;
  if (state.view === "karte") state.inspect = true;
  else state.cover = true;
  const s = stationById(id);
  if (move !== false && s) fly(s.lat, s.lng, 11.5);
  refresh();
}

function clearFocus() {
  state.parcelId = null;
  state.stationId = null;
  state.inspect = false;
  state.cover = false;
  refresh();
}

function stepParcel(dir) {
  const rows = filtered();
  if (!rows.length) return;
  let index = rows.findIndex((p) => p.id === state.parcelId);
  if (index < 0) index = 0;
  else index = (index + dir + rows.length) % rows.length;
  openParcel(rows[index].id, state.view === "karte");
}

function nextParcel() {
  const row = ranked().find((p) => stageOf(p.id) === "offen" || stageOf(p.id) === "pruefung");
  if (row) openParcel(row.id);
}

function setView(name) {
  state.view = name;
  state.cover = false;
  if (name === "karte") state.inspect = false;
  document.querySelectorAll("#nav button").forEach((btn) => btn.classList.toggle("on", btn.dataset.view === name));
  renderPane();
  window.setTimeout(() => map.invalidateSize(), 640);
}

function setLive(text, running) {
  document.getElementById("live-text").textContent = text;
  document.getElementById("live").classList.toggle("run", running);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function playRun() {
  if (state.running || state.revealed) return;
  state.running = true;
  const steps = ["Edikte, nichts Neues.", "Presse, eine Meldung.", "Schwechat hängt an der Liste."];
  for (let i = 0; i < steps.length; i += 1) {
    state.runAt = i;
    setLive(steps[i], true);
    await sleep(800);
  }
  state.revealed = true;
  state.runAt = 3;
  state.running = false;
  remember("Schwechat, GST 412/3 neu. " + DATA.parcels[0].signal, "sw");
  setLive("Eine Akte neu.", false);
  refresh();
  addBot("Schwechat, GST 412/3 ist neu in den Akten. Anlass ist eine Beispiel-Meldung zum Sitz. Der Eigentümer steht noch nicht drin.");
}

function findParcel(q) {
  return parcels().find((p) => q.includes(p.kg.toLowerCase()) || q.includes(String(p.gst).toLowerCase()));
}

function addSource(name) {
  const clean = name.replace(/^[:\s]+/, "").slice(0, 80);
  if (!clean) return;
  state.sources.push({ name: clean });
  saveStore();
  renderPane();
}

function addAkte(kg) {
  const key = kg.toLowerCase();
  const known = parcels().find((p) => key.includes(p.kg.toLowerCase()));
  if (known) {
    openParcel(known.id);
    return known.kg + " gibt es schon. Die Akte ist offen.";
  }
  const place = Object.keys(PLACES).find((name) => key.includes(name));
  const coord = place ? PLACES[place] : [48.21 + state.extra.length * 0.02, 16.4];
  const label = place ? place.charAt(0).toUpperCase() + place.slice(1) : kg.replace(/^für |^fuer |^in /i, "").trim();
  const item = {
    id: "x" + Date.now(),
    kg: label || "Neue Fläche",
    gst: "neu",
    ha: 2,
    zoning: "noch offen",
    lat: coord[0],
    lng: coord[1],
    rail: /gleis/.test(key),
    altlast: false,
    owner: "",
    signal: "Im Gespräch angelegt. Lage und Widmung sind noch nicht belegt.",
    created: true,
  };
  state.extra.push(item);
  remember(item.kg + " als Akte angelegt.", item.id);
  openParcel(item.id);
  return item.kg + " liegt jetzt in den Akten. Die Lage ist nur ein Anhalt, bis eine Quelle sie stützt.";
}

function handle(raw) {
  const q = raw.toLowerCase().trim();
  if (/einklapp|rechts (zu|weg)|klapp.*ein/.test(q)) {
    setRight(true);
    return "Rechts ist eingeklappt.";
  }
  if (/ausklapp|rechts auf|klapp.*aus/.test(q)) {
    setRight(false);
    return "Rechts ist wieder da.";
  }
  if (/^akten$|liste groß|alle akten/.test(q)) {
    setView("akten");
    return "Die Akten liegen groß über der Karte.";
  }
  if (/bericht|morgen|was ist anders|heute/.test(q)) {
    setView("bericht");
    return state.revealed
      ? "Im Bericht steht die Stromlage, darunter die neue Akte Schwechat und alle übrigen Flächen."
      : "Der Bericht ist offen. Die Presse ist in diesem Lauf noch nicht eingehängt.";
  }
  if (/^strom$|stromlage|megawatt|bezug/.test(q)) {
    setView("strom");
    return "Strom ist offen. 0 MW freie uneingeschränkte Bezugsleistung, Anträge 14.084 MW in Niederösterreich und 927 MW in Wien. Das ist keine Anschlusszusage.";
  }
  if (/satellit|luftbild|gps/.test(q)) {
    setBase("sat");
    return "Die Karte zeigt jetzt das Luftbild.";
  }
  if (/straßenkarte|strassenkarte|normale karte|basiskarte/.test(q)) {
    setBase("map");
    return "Die Karte zeigt wieder die Straßen.";
  }
  if (/nächst|naechst/.test(q)) {
    nextParcel();
    const p = parcelById(state.parcelId);
    return p ? "Offen ist " + p.kg + ", GST " + p.gst + "." : "Nichts liegt mehr offen.";
  }
  if (/quelle/.test(q)) {
    const name = raw.replace(/.*quelle[:\s]*/i, "").trim();
    if (name && name.toLowerCase() !== "quellen") {
      addSource(name);
      return "Quelle vorgemerkt: " + name + ". Im Prototyp hole ich sie noch nicht selbst. Sie steht im Bericht.";
    }
    return "Quellen im Bericht: " + BASE_SOURCES.map((s) => s.name).concat(state.sources.map((s) => s.name)).join(", ") + ".";
  }
  if (/leg.*an|neue akte|neue fläche|neue flaeche/.test(q)) {
    return addAkte(raw.replace(/.*(?:an|akte|fläche|flaeche)\s*/i, ""));
  }
  if (/internet|such(e|en)? |schau nach|recherch/.test(q)) {
    addSource("Suche: " + raw.slice(0, 70));
    return "Die Suche ist vorgemerkt. Dieser Prototyp hat noch keine Leitung nach draußen. Im laufenden System würde das Gespräch die Quelle selbst anlegen und die Akte daraus füllen.";
  }
  const stageWord = q.match(/prüfung|pruefung|gespräch|gespraech|ablegen|abgelegt/);
  const named = findParcel(q);
  if (stageWord && (named || state.parcelId)) {
    const id = named ? named.id : state.parcelId;
    const next = /ableg/.test(q) ? "abgelegt" : /gespräch|gespraech/.test(q) ? "gespraech" : "pruefung";
    setStage(id, next);
    if (named) openParcel(id);
    return parcelById(id).kg + " steht auf " + STAGE[stageOf(id)] + ".";
  }
  if (/eigentümer|grundbuch|b-blatt|name/.test(q)) {
    const opened = Object.keys(state.opened);
    if (!opened.length) return "Noch kein Auszug. In der offenen Akte liegt der Knopf für das B-Blatt.";
    return opened
      .map((id) => {
        const p = parcelById(id);
        return p ? p.kg + ", " + p.gst + ": " + p.owner + ", Beispiel." : "";
      })
      .filter(Boolean)
      .join(" ");
  }
  const hit = named || ((/diese|die akte|hier/.test(q) && state.parcelId) ? parcelById(state.parcelId) : null);
  if (hit) {
    openParcel(hit.id);
    const existing = nearest(hit, ["bestehend"]);
    const planned = nearest(hit, ["geplant", "ausbau"]);
    const tag = fits(hit).includes("rz") && fits(hit).includes("gleis") ? "Passt auf RZ und auf Gleis." : fits(hit).includes("rz") ? "Passt auf ein Rechenzentrum." : fits(hit).includes("gleis") ? "Passt auf Logistik mit Gleis." : "Keine der beiden Marken.";
    return (
      hit.kg +
      ", GST " +
      hit.gst +
      ": " +
      fmtHa(hit.ha) +
      ", " +
      hit.zoning +
      ". " +
      fmtKm(existing.d) +
      " bis " +
      existing.s.name +
      ", " +
      fmtKm(planned.d) +
      " bis " +
      planned.s.name +
      ". " +
      tag +
      " " +
      (signalOf(hit) || "") +
      (state.opened[hit.id] ? " Eigentümer im Beispiel: " + hit.owner + "." : " Eigentümer fehlt noch.")
    );
  }
  const station = DATA.substations.find((s) => q.includes(s.name.toLowerCase().split(",")[0]));
  if (station) {
    openStation(station.id);
    return station.name + ". " + station.note;
  }
  if (/warum|oben|sort|interesse/.test(q)) {
    const top = ranked()[0];
    openParcel(top.id);
    return "Oben steht " + top.kg + ", GST " + top.gst + ". " + lineOf(top);
  }
  if (/^karte$/.test(q)) {
    setView("karte");
    return "Die Karte ist wieder frei.";
  }
  return "Dazu liegt in den Akten nichts. Eine Quelle kann ich vormerken, zum Beispiel: Quelle Firmenbuch Schwechat.";
}

function addMsg(text, kind) {
  const log = document.getElementById("chat-log");
  const el = document.createElement("div");
  el.className = "msg " + kind;
  el.textContent = text;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}

function addBot(text) {
  addMsg(text, "bot");
}

function ask(text) {
  const q = text.trim();
  if (!q) return;
  addMsg(q, "user");
  addBot(handle(q));
}

function frame() {
  const width = window.innerWidth;
  const left = width < 980 ? 320 : 390;
  const right = state.rightShut ? 40 : width < 980 ? 380 : 470;
  map.fitBounds(
    [
      [47.98, 16.22],
      [48.5, 16.66],
    ],
    { paddingTopLeft: [left, 100], paddingBottomRight: [right, 70], animate: false }
  );
}

function init() {
  document.body.classList.toggle("right-shut", state.rightShut);
  document.getElementById("right-toggle").textContent = state.rightShut ? "‹" : "›";
  document.querySelectorAll("#nav button").forEach((btn) => {
    btn.onclick = () => setView(btn.dataset.view);
  });
  document.getElementById("right-toggle").onclick = () => setRight(!state.rightShut);
  document.getElementById("live").onclick = () => setView("bericht");
  document.querySelectorAll("#basemap button").forEach((btn) => {
    btn.onclick = () => setBase(btn.dataset.base);
  });
  document.querySelectorAll("#layers button").forEach((btn) => {
    btn.onclick = () => {
      state.layers[btn.dataset.layer] = !state.layers[btn.dataset.layer];
      saveStore();
      applyLayers();
    };
  });
  document.getElementById("zoom-in").onclick = () => glide(map.getCenter(), map.getZoom() + 1, 280);
  document.getElementById("zoom-out").onclick = () => glide(map.getCenter(), map.getZoom() - 1, 280);
  document.getElementById("chat-form").onsubmit = (event) => {
    event.preventDefault();
    const input = document.getElementById("chat-input");
    ask(input.value);
    input.value = "";
  };
  document.addEventListener("keydown", (event) => {
    const input = document.getElementById("chat-input");
    if (event.key === "Escape") clearFocus();
    if (event.key === "/" && document.activeElement !== input) {
      event.preventDefault();
      input.focus();
    }
  });
  setBase(state.base);
  drawStations();
  applyLayers();
  refresh();
  frame();
  window.addEventListener("resize", () => map.invalidateSize());
  if (state.revealed) setLive("Lauf liegt vor.", false);
  else playRun();
}

init();
