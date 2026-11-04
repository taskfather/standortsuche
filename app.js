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

const STREET_STYLE = "https://tiles.openfreemap.org/styles/dark";
const SAT_STYLE = {
  version: 8,
  sources: {
    sat: {
      type: "raster",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      maxzoom: 18,
      attribution: "Bilder © Esri",
    },
    labels: {
      type: "raster",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      maxzoom: 19,
    },
  },
  layers: [
    { id: "sat", type: "raster", source: "sat" },
    { id: "labels", type: "raster", source: "labels", paint: { "raster-opacity": 0.9 } },
  ],
};

const map = new maplibregl.Map({
  container: "map",
  style: STREET_STYLE,
  center: [16.45, 48.2],
  zoom: 10,
  minZoom: 8,
  maxZoom: 18,
  attributionControl: { compact: false },
  dragRotate: false,
  pitchWithRotate: false,
  touchPitch: false,
  fadeDuration: 0,
  scrollZoom: true,
});
map.touchZoomRotate.disableRotation();
map.scrollZoom.setZoomRate(1 / 10);
map.scrollZoom.setWheelZoomRate(1 / 40);

const markers = { parcels: {}, live: {}, plan: {} };
let overlaysReady = false;

function easeS(t) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

function glide(center, zoom, ms) {
  const z = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), zoom));
  map.stop();
  const here = map.getCenter();
  const dist = km({ lat: here.lat, lng: here.lng }, { lat: center[1], lng: center[0] });
  const duration = ms != null ? ms : Math.min(1500, Math.max(520, 360 + dist * 48 + Math.abs(z - map.getZoom()) * 80));
  map.flyTo({ center, zoom: z, duration, curve: 1.42, essential: true, easing: easeS });
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
function changesFor(id) {
  return state.changes.filter((c) => c.parcelId === id);
}

function lineOf(p) {
  const planned = nearest(p, ["geplant", "ausbau"]);
  const latest = changesFor(p.id)[0];
  const bits = [fmtHa(p.ha), p.zoning];
  if (latest) bits.push(latest.text);
  else if (planned) bits.push(fmtKm(planned.d) + " bis " + planned.s.name);
  return bits.join(" · ");
}
function remember(text, parcelId) {
  state.changes.unshift({ text, parcelId: parcelId || "", at: Date.now() });
  state.changes = state.changes.slice(0, 16);
  saveStore();
}

function fly(lat, lng, minZoom) {
  glide([lng, lat], Math.max(map.getZoom(), minZoom || map.getZoom()));
}

function ring(lat, lng, radiusM) {
  const pts = [];
  for (let i = 0; i <= 64; i += 1) {
    const bearing = (i / 64) * Math.PI * 2;
    const dx = radiusM * Math.cos(bearing);
    const dy = radiusM * Math.sin(bearing);
    pts.push([lng + dx / (111320 * Math.cos((lat * Math.PI) / 180)), lat + dy / 111320]);
  }
  return pts;
}

function colorOf(p) {
  if (p.altlast) return "#ff9d90";
  if (isNew(p)) return "#ffc56d";
  if (score(p) < 10) return "#c5ced6";
  return "#8ee0c4";
}

function dropMarkers(bucket) {
  Object.values(markers[bucket]).forEach((marker) => marker.remove());
  markers[bucket] = {};
}

function pinButton(html, onClick) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "map-pin";
  el.innerHTML = html;
  el.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return el;
}

function addOverlay() {
  if (map.getSource("parcels")) return;
  map.addSource("parcels", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addSource("links", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({
    id: "parcel-fill",
    type: "fill",
    source: "parcels",
    paint: {
      "fill-color": ["get", "color"],
      "fill-opacity": ["case", ["==", ["get", "hot"], 1], 0.38, 0.24],
    },
  });
  map.addLayer({
    id: "parcel-line",
    type: "line",
    source: "parcels",
    paint: {
      "line-color": ["get", "color"],
      "line-width": ["case", ["==", ["get", "hot"], 1], 2.6, 1.8],
    },
  });
  map.addLayer({
    id: "links",
    type: "line",
    source: "links",
    paint: { "line-color": "#f4f7fb", "line-width": 1.6, "line-dasharray": [1, 1.6], "line-opacity": 0.8 },
  });
  map.on("click", "parcel-fill", (event) => {
    const id = event.features && event.features[0] && event.features[0].properties.id;
    if (id) openParcel(id);
  });
  map.on("mouseenter", "parcel-fill", (event) => {
    map.getCanvas().style.cursor = "pointer";
    const id = event.features && event.features[0] && event.features[0].properties.id;
    if (id) setHover(id);
  });
  map.on("mouseleave", "parcel-fill", () => {
    map.getCanvas().style.cursor = "";
    setHover(null);
  });
  map.on("click", "links", (event) => {
    const id = event.features && event.features[0] && event.features[0].properties.station;
    if (id) openStation(id);
  });
  overlaysReady = true;
}

function setBase(mode) {
  state.base = mode;
  document.body.classList.toggle("base-sat", mode === "sat");
  overlaysReady = false;
  dropMarkers("parcels");
  dropMarkers("live");
  dropMarkers("plan");
  map.setStyle(mode === "sat" ? SAT_STYLE : STREET_STYLE);
  document.querySelectorAll("#basemap button").forEach((btn) => btn.classList.toggle("on", btn.dataset.base === mode));
  saveStore();
}

function applyLayers() {
  const show = (id, on) => {
    if (!map.getLayer(id)) return;
    map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
  };
  show("parcel-fill", state.layers.parcels);
  show("parcel-line", state.layers.parcels);
  Object.values(markers.parcels).forEach((marker) => {
    marker.getElement().style.display = state.layers.parcels ? "" : "none";
  });
  Object.values(markers.live).forEach((marker) => {
    marker.getElement().style.display = state.layers.live ? "" : "none";
  });
  Object.values(markers.plan).forEach((marker) => {
    marker.getElement().style.display = state.layers.plan ? "" : "none";
  });
  document.querySelectorAll("#layers button").forEach((btn) => btn.classList.toggle("on", !!state.layers[btn.dataset.layer]));
}

function setRight(shut) {
  state.rightShut = shut;
  document.body.classList.toggle("right-shut", shut);
  const btn = document.getElementById("right-toggle");
  btn.textContent = shut ? "‹" : "›";
  btn.setAttribute("aria-label", shut ? "Rechts ausklappen" : "Rechts einklappen");
  saveStore();
  window.setTimeout(() => map.resize(), 720);
}

function drawStations() {
  if (!overlaysReady) return;
  dropMarkers("live");
  dropMarkers("plan");
  DATA.substations.forEach((s) => {
    const bucket = s.kind === "bestehend" ? "live" : "plan";
    const el = pinButton(
      `<span class="pin-stack"><span class="pin ${s.kind} ${state.stationId === s.id ? "on" : ""}"></span><span class="pin-name">${esc(s.name)}</span></span>`,
      () => openStation(s.id)
    );
    markers[bucket][s.id] = new maplibregl.Marker({ element: el, anchor: "left" }).setLngLat([s.lng, s.lat]).addTo(map);
  });
}

function parcelData() {
  return {
    type: "FeatureCollection",
    features: parcels().map((p) => ({
      type: "Feature",
      properties: {
        id: p.id,
        color: colorOf(p),
        hot: state.parcelId === p.id || state.hover === p.id ? 1 : 0,
      },
      geometry: {
        type: "Polygon",
        coordinates: [ring(p.lat, p.lng, Math.sqrt((p.ha * 10000) / Math.PI))],
      },
    })),
  };
}

function drawParcels() {
  if (!overlaysReady) return;
  const source = map.getSource("parcels");
  if (source) source.setData(parcelData());
  dropMarkers("parcels");
  parcels().forEach((p) => {
    const cls = ["pin"];
    if (p.altlast) cls.push("bad");
    else if (isNew(p)) cls.push("fresh");
    else if (score(p) < 10) cls.push("weak");
    if (state.parcelId === p.id) cls.push("on");
    if (state.hover === p.id) cls.push("hot");
    const el = pinButton(
      `<span class="pin-stack"><span class="${cls.join(" ")}"></span><span class="pin-name">${esc(p.kg)}</span></span>`,
      () => openParcel(p.id)
    );
    el.addEventListener("mouseenter", () => setHover(p.id));
    el.addEventListener("mouseleave", () => setHover(null));
    markers.parcels[p.id] = new maplibregl.Marker({ element: el, anchor: "left" }).setLngLat([p.lng, p.lat]).addTo(map);
  });
}

function paintLinks() {
  if (!overlaysReady || !map.getSource("links")) return;
  const p = state.parcelId ? parcelById(state.parcelId) : null;
  const features = [];
  if (p) {
    [nearest(p, ["bestehend"]), nearest(p, ["geplant", "ausbau"])].forEach((hit) => {
      if (!hit) return;
      features.push({
        type: "Feature",
        properties: { station: hit.s.id },
        geometry: { type: "LineString", coordinates: [[p.lng, p.lat], [hit.s.lng, hit.s.lat]] },
      });
    });
  }
  map.getSource("links").setData({ type: "FeatureCollection", features });
}

function setHover(id) {
  if (state.hover === id) return;
  state.hover = id;
  document.querySelectorAll("#list .row").forEach((row) => row.classList.toggle("hot", row.dataset.id === id));
  if (overlaysReady && map.getSource("parcels")) map.getSource("parcels").setData(parcelData());
  parcels().forEach((p) => {
    const marker = markers.parcels[p.id];
    if (!marker) return;
    const pin = marker.getElement().querySelector(".pin");
    if (pin) pin.classList.toggle("hot", state.hover === p.id);
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

function changeCards(changes) {
  if (!changes.length) return `<p class="quiet">Seit dem Öffnen hat sich an den Akten nichts geändert.</p>`;
  return `<div class="card-grid">${changes.map((c) => {
    const p = c.parcelId ? parcelById(c.parcelId) : null;
    if (!p) return `<article class="info-card"><p>${esc(c.text)}</p></article>`;
    return `<button type="button" class="info-card" data-id="${p.id}">
      <span class="marks">${marks(p)}</span>
      <strong>${esc(p.kg)}</strong>
      <em>GST ${esc(p.gst)} · ${esc(fmtHa(p.ha))}</em>
      <p>${esc(c.text)}</p>
    </button>`;
  }).join("")}</div>`;
}

function reportSheet() {
  const changes = state.changes.slice();
  if (state.revealed && !changes.some((c) => c.parcelId === "sw")) {
    changes.unshift({
      text: "Neu. " + DATA.parcels[0].signal,
      parcelId: "sw",
    });
  }
  const working = ranked().filter((p) => stageOf(p.id) === "offen" || stageOf(p.id) === "pruefung").length;
  const added = state.sources.map((s) => s.name);
  const sources = BASE_SOURCES.map((s) => s.name).concat(added);
  return `<div class="sheet brief">
    <p class="kicker">Morgenbericht</p>
    <h2>Was der Lauf gebracht hat</h2>
    <p class="when">Ein Lauf am Morgen. Ein neues Ereignis kann sofort eine Akte öffnen. Das Gespräch zeigt dieselbe Akte und fliegt auf der Karte hin.</p>
    <div class="metrics">
      <div class="metric"><span>Lauf</span><strong>${state.revealed ? "liegt vor" : state.running ? "läuft" : "bereit"}</strong></div>
      <div class="metric"><span>Änderungen</span><strong>${changes.length}</strong></div>
      <div class="metric"><span>In Arbeit</span><strong>${working}</strong></div>
    </div>
    <h3>Neu oder anders</h3>
    ${changeCards(changes)}
    <h3>Quellen</h3>
    <div class="mini-row">${sources.map((name) => `<span class="mini static">${esc(name)}</span>`).join("")}</div>
  </div>`;
}

function stationCard(s) {
  return `<button type="button" class="info-card" data-station="${s.id}">
    <span class="mark">${esc(kindLabel(s.kind))}</span>
    <strong>${esc(s.name)}</strong>
    <p>${esc(s.note)}</p>
  </button>`;
}

function powerSheet() {
  const live = DATA.substations.filter((s) => s.kind === "bestehend");
  const planned = DATA.substations.filter((s) => s.kind !== "bestehend");
  return `<div class="sheet brief">
    <p class="kicker">Strom</p>
    <h2>Bezug, nicht Einspeisung</h2>
    <p class="when">Summen je Land, nicht die freie Leistung eines einzelnen Werks. Ein Rechenzentrum braucht oft 50 bis 200 MW. Den Anschluss sagt der Netzbetreiber zu.</p>
    <div class="metrics">
      <div class="metric"><span>Frei, uneingeschränkt</span><strong>0 MW</strong></div>
      <div class="metric"><span>Anträge Niederösterreich</span><strong>14.084 MW</strong></div>
      <div class="metric"><span>Anträge Wien</span><strong>927 MW</strong></div>
    </div>
    <h3>Bestehend</h3>
    <div class="card-grid">${live.map(stationCard).join("")}</div>
    <h3>Geplant und Ausbau</h3>
    <div class="card-grid">${planned.map(stationCard).join("")}</div>
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

function deltaBlock(p) {
  const rows = changesFor(p.id);
  if (!rows.length) return "";
  return `<section class="delta"><h3>Was sich geändert hat</h3>${rows
    .map((c) => `<p>${esc(c.text)}</p>`)
    .join("")}</section>`;
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
      ${deltaBlock(p)}
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
  window.setTimeout(() => map.resize(), 640);
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
      [16.22, 47.98],
      [16.66, 48.5],
    ],
    { padding: { top: 100, bottom: 80, left, right }, duration: 0 }
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
  const nudge = (dir) => {
    const center = map.getCenter();
    glide([center.lng, center.lat], map.getZoom() + dir * 1.6, 260);
  };
  document.getElementById("zoom-in").onclick = () => nudge(1);
  document.getElementById("zoom-out").onclick = () => nudge(-1);
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
  const mount = () => {
    if (overlaysReady) return;
    try {
      addOverlay();
      drawParcels();
      drawStations();
      paintLinks();
      applyLayers();
      frame();
    } catch (err) {
      return;
    }
  };
  map.on("styledata", mount);
  map.on("idle", mount);
  if (state.base === "sat") setBase("sat");
  else document.querySelectorAll("#basemap button").forEach((btn) => btn.classList.toggle("on", btn.dataset.base === "map"));
  refresh();
  window.addEventListener("resize", () => map.resize());
  if (state.revealed) setLive("Lauf liegt vor.", false);
  else playRun();
}

init();
