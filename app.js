const DATA = window.DATA;
const storeKey = "standortsuche-desk-v2";

const STEPS = [
  { text: "Edikte gelesen. Keine neue Versteigerung im Suchgebiet." },
  { text: "Presse gelesen. Eine Meldung mit Ortsbezug." },
  { text: "Schwechat, GST 412/3 an den Auftrag gehängt.", parcel: "sw" },
];

const FILTERS = [
  ["alle", "Alle"],
  ["offen", "Offen"],
  ["pruefung", "Prüfung"],
  ["gespraech", "Gespräch"],
  ["abgelegt", "Abgelegt"],
];

const STAGE_LABEL = {
  offen: "Offen",
  pruefung: "Prüfung",
  gespraech: "Gespräch",
  abgelegt: "Abgelegt",
};

const state = {
  mandateId: "rz",
  view: "flaechen",
  filter: "alle",
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
  greeted: false,
};

const saved = loadStore();
Object.assign(state, saved);

const map = L.map("map", {
  zoomControl: false,
  attributionControl: true,
  zoomSnap: 0.25,
  zoomDelta: 0.25,
  wheelPxPerZoomLevel: 180,
  wheelDebounceTime: 16,
  zoomAnimation: true,
  fadeAnimation: true,
  markerZoomAnimation: true,
  inertia: true,
  inertiaDeceleration: 2800,
  easeLinearity: 0.15,
  minZoom: 8,
  maxZoom: 20,
});

map.createPane("labelPane");
map.getPane("labelPane").style.zIndex = "350";
map.getPane("labelPane").style.pointerEvents = "none";

const streets = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap",
  maxZoom: 20,
  maxNativeZoom: 19,
});
const satellite = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  {
    attribution: "Bilder &copy; Esri",
    maxZoom: 20,
    maxNativeZoom: 18,
  }
);
const labels = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
  {
    attribution: "Orte &copy; Esri",
    maxZoom: 20,
    maxNativeZoom: 19,
    pane: "labelPane",
    opacity: 0.9,
  }
);

const parcelLayer = L.layerGroup().addTo(map);
const liveLayer = L.layerGroup().addTo(map);
const planLayer = L.layerGroup().addTo(map);
const linkLayer = L.layerGroup().addTo(map);
const parcelGfx = {};
const stationGfx = {};

function loadStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(storeKey) || "{}");
    return {
      mandateId: raw.mandateId || "rz",
      revealed: !!raw.revealed,
      runAt: raw.revealed ? STEPS.length : 0,
      opened: raw.opened || {},
      stages: raw.stages || {},
      base: raw.base === "sat" ? "sat" : "map",
      layers: Object.assign({ parcels: true, live: true, plan: true }, raw.layers || {}),
    };
  } catch {
    return {};
  }
}

function saveStore() {
  localStorage.setItem(
    storeKey,
    JSON.stringify({
      mandateId: state.mandateId,
      revealed: state.revealed,
      opened: state.opened,
      stages: state.stages,
      base: state.base,
      layers: state.layers,
    })
  );
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function km(a, b) {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLng = (b.lng - a.lng) * r;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function fmtKm(d) {
  return d.toFixed(1).replace(".", ",") + " km";
}

function fmtHa(n) {
  return n.toFixed(1).replace(".", ",") + " ha";
}

function mandate() {
  return DATA.mandates.find((m) => m.id === state.mandateId) || DATA.mandates[0];
}

function parcelById(id) {
  return DATA.parcels.find((p) => p.id === id);
}

function stationById(id) {
  return DATA.substations.find((s) => s.id === id);
}

function kindLabel(kind) {
  if (kind === "bestehend") return "bestehend";
  if (kind === "ausbau") return "Ausbau";
  return "geplant";
}

function nearest(parcel, kinds) {
  const list = DATA.substations.filter((s) => kinds.includes(s.kind));
  return list
    .map((s) => ({ s, d: km(parcel, s) }))
    .sort((a, b) => a.d - b.d)[0];
}

function signalOf(p) {
  if (p.id === "sw" && !state.revealed) return "";
  return p.signal;
}

function stageOf(id) {
  return state.stages[id] || "offen";
}

function score(p) {
  const m = mandate();
  const planned = nearest(p, ["geplant", "ausbau"]);
  let s = 0;
  if (p.ha >= m.minHa) s += 30;
  else s -= 20;
  if (planned && planned.d < 4) s += Math.round((4 - planned.d) * 8);
  if (signalOf(p)) s += 36;
  if (m.wantRail && p.rail) s += 40;
  if (!m.wantRail && p.rail) s += 4;
  if (p.altlast) s -= 45;
  const stage = stageOf(p.id);
  if (stage === "gespraech") s += 12;
  if (stage === "abgelegt") s -= 70;
  return s;
}

function ranked() {
  return DATA.parcels.slice().sort((a, b) => score(b) - score(a) || b.ha - a.ha);
}

function filtered() {
  const rows = ranked();
  if (state.filter === "alle") return rows;
  return rows.filter((p) => stageOf(p.id) === state.filter);
}

function reason(p) {
  if (p.altlast) return "Altlast im Beispiel. Deshalb kein Gespräch.";
  if (stageOf(p.id) === "abgelegt") return "Abgelegt.";
  const sig = signalOf(p);
  if (sig) return "Meldung hängt an der Fläche.";
  const planned = nearest(p, ["geplant", "ausbau"]);
  if (planned && planned.d < 4) return "Nahe am geplanten Werk " + planned.s.name + ", " + fmtKm(planned.d) + ".";
  if (p.rail && mandate().wantRail) return "Gleisanschluss im Beispiel.";
  if (p.ha < mandate().minHa) return "Kleiner als der Auftrag.";
  return "Gewerbliche Fläche im Suchgebiet.";
}

function factors(p) {
  const m = mandate();
  const planned = nearest(p, ["geplant", "ausbau"]);
  const existing = nearest(p, ["bestehend"]);
  const lines = [];
  lines.push(
    p.ha >= m.minHa
      ? fmtHa(p.ha) + " liegt über der Grenze von " + fmtHa(m.minHa) + "."
      : fmtHa(p.ha) + " liegt unter der Grenze von " + fmtHa(m.minHa) + "."
  );
  if (planned) lines.push(fmtKm(planned.d) + " bis " + planned.s.name + ".");
  if (existing) lines.push(fmtKm(existing.d) + " bis " + existing.s.name + ".");
  if (signalOf(p)) lines.push(signalOf(p));
  if (m.wantRail) lines.push(p.rail ? "Gleisanschluss im Beispiel." : "Kein Gleisanschluss im Beispiel.");
  else if (p.rail) lines.push("Gleisanschluss im Beispiel, für diesen Auftrag nicht verlangt.");
  if (p.altlast) lines.push("Altlast im Beispiel. Die Fläche bleibt sichtbar und rutscht nach unten.");
  if (stageOf(p.id) === "gespraech") lines.push("Gespräch ist vorgemerkt.");
  if (stageOf(p.id) === "abgelegt") lines.push("Die Fläche ist abgelegt.");
  return lines;
}

function pinClass(p) {
  const classes = ["pin"];
  if (p.altlast) classes.push("bad");
  else if (p.id === "sw" && state.revealed) classes.push("fresh");
  else if (score(p) < 20) classes.push("weak");
  if (state.parcelId === p.id) classes.push("on");
  if (state.hover === p.id) classes.push("hot");
  return classes.join(" ");
}

function fly(lat, lng, minZoom) {
  const zoom = Math.max(map.getZoom(), minZoom);
  map.flyTo([lat, lng], zoom, { duration: 0.85, easeLinearity: 0.2 });
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
  document.querySelectorAll("#basemap button").forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.base === mode);
  });
  saveStore();
}

function applyLayers() {
  const set = (layer, on) => {
    if (on && !map.hasLayer(layer)) layer.addTo(map);
    if (!on && map.hasLayer(layer)) map.removeLayer(layer);
  };
  set(parcelLayer, state.layers.parcels);
  set(liveLayer, state.layers.live);
  set(planLayer, state.layers.plan);
  document.querySelectorAll("#layers button").forEach((btn) => {
    btn.classList.toggle("on", !!state.layers[btn.dataset.layer]);
  });
}

function drawStations() {
  liveLayer.clearLayers();
  planLayer.clearLayers();
  DATA.substations.forEach((s) => {
    const on = state.stationId === s.id ? " on" : "";
    const icon = L.divIcon({
      className: "pin-wrap",
      html: `<span class="pin ${s.kind} station${on}"></span>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });
    const marker = L.marker([s.lat, s.lng], { icon, zIndexOffset: 200 });
    marker.bindTooltip(
      `<span class="tip"><b>${esc(s.name)}</b><span>${esc(kindLabel(s.kind))}</span></span>`,
      { className: "glass-tip", direction: "top", offset: [0, -8], opacity: 1 }
    );
    marker.on("click", () => openStation(s.id));
    marker.addTo(s.kind === "bestehend" ? liveLayer : planLayer);
    stationGfx[s.id] = marker;
  });
}

function drawParcels() {
  parcelLayer.clearLayers();
  DATA.parcels.forEach((p) => {
    const selected = state.parcelId === p.id || state.hover === p.id;
    const color = p.altlast ? "#ff9d90" : p.id === "sw" && state.revealed ? "#ffc56d" : score(p) < 20 ? "#c5ced6" : "#8ee0c4";
    const circle = L.circle([p.lat, p.lng], {
      radius: Math.sqrt((p.ha * 10000) / Math.PI),
      color,
      weight: selected ? 2.4 : 1.4,
      opacity: 0.95,
      fillColor: color,
      fillOpacity: selected ? 0.34 : 0.18,
    });
    circle.on("click", () => openParcel(p.id));
    circle.addTo(parcelLayer);
    const icon = L.divIcon({
      className: "pin-wrap",
      html: `<span class="${pinClass(p)}"></span>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    });
    const marker = L.marker([p.lat, p.lng], { icon, zIndexOffset: selected ? 800 : 400 });
    marker.bindTooltip(
      `<span class="tip"><b>${esc(p.kg)}, ${esc(p.gst)}</b><span>${esc(fmtHa(p.ha))} · ${esc(p.zoning)}</span></span>`,
      { className: "glass-tip", direction: "top", offset: [0, -10], opacity: 1 }
    );
    marker.on("click", () => openParcel(p.id));
    marker.on("mouseover", () => setHover(p.id));
    marker.on("mouseout", () => setHover(null));
    marker.addTo(parcelLayer);
    parcelGfx[p.id] = { circle, marker };
  });
}

function paintLinks() {
  linkLayer.clearLayers();
  if (!state.parcelId) return;
  const p = parcelById(state.parcelId);
  [nearest(p, ["bestehend"]), nearest(p, ["geplant", "ausbau"])].forEach((hit) => {
    if (!hit) return;
    const line = L.polyline(
      [
        [p.lat, p.lng],
        [hit.s.lat, hit.s.lng],
      ],
      { color: "#f4f7fb", weight: 1.6, opacity: 0.8, dashArray: "1 8", lineCap: "round" }
    );
    line.on("click", () => openStation(hit.s.id));
    line.addTo(linkLayer);
  });
}

function setHover(id) {
  if (state.hover === id) return;
  state.hover = id;
  document.querySelectorAll("#list .row").forEach((row) => row.classList.toggle("hot", row.dataset.id === id));
  DATA.parcels.forEach((p) => {
    const gfx = parcelGfx[p.id];
    if (!gfx) return;
    const hot = state.hover === p.id || state.parcelId === p.id;
    const pin = gfx.marker.getElement() && gfx.marker.getElement().querySelector(".pin");
    if (pin) pin.classList.toggle("hot", state.hover === p.id);
    gfx.circle.setStyle({ weight: hot ? 2.4 : 1.4, fillOpacity: hot ? 0.34 : 0.18 });
  });
}

function renderMandate() {
  const m = mandate();
  document.getElementById("mandate-title").textContent = m.label;
  document.getElementById("mandate-meta").textContent =
    m.place + " · " + m.brief + " " + m.power + ". Beispiel.";
  document.getElementById("mandate").value = m.id;
}

function renderCounts() {
  const rows = ranked();
  const open = rows.filter((p) => stageOf(p.id) === "offen" || stageOf(p.id) === "pruefung").length;
  const talk = rows.filter((p) => stageOf(p.id) === "gespraech").length;
  document.getElementById("counts").textContent = open + " in Arbeit · " + talk + " Gespräch";
}

function renderFilters() {
  document.getElementById("filters").innerHTML = FILTERS.map(
    ([id, label]) => `<button type="button" data-filter="${id}" class="${state.filter === id ? "on" : ""}">${label}</button>`
  ).join("");
  document.querySelectorAll("#filters button").forEach((btn) => {
    btn.onclick = () => {
      state.filter = btn.dataset.filter;
      renderFilters();
      renderList();
    };
  });
}

function renderList() {
  const rows = filtered();
  document.getElementById("list").innerHTML = rows.length
    ? rows
        .map((p) => {
          const stage = stageOf(p.id);
          const tagClass = p.id === "sw" && state.revealed && stage === "offen" ? "fresh" : stage === "gespraech" ? "talk" : p.altlast ? "warn" : "";
          const tag = p.id === "sw" && state.revealed && stage === "offen" ? "neu" : STAGE_LABEL[stage];
          const sc = score(p);
          const scClass = sc < 0 ? "bad" : sc < 20 ? "low" : "";
          return `<button type="button" class="row ${state.parcelId === p.id ? "on" : ""}" data-id="${p.id}">
            <span class="score ${scClass}">${sc}</span>
            <span>
              <strong>${esc(p.kg)}</strong>
              <em>GST ${esc(p.gst)} · ${esc(fmtHa(p.ha))} · ${esc(reason(p))}</em>
            </span>
            <span class="tag ${tagClass}">${esc(tag)}</span>
          </button>`;
        })
        .join("")
    : `<p class="quiet" style="padding:12px">In dieser Stufe liegt keine Fläche.</p>`;
  document.querySelectorAll("#list .row").forEach((btn) => {
    btn.onclick = () => openParcel(btn.dataset.id);
    btn.onmouseenter = () => setHover(btn.dataset.id);
    btn.onmouseleave = () => setHover(null);
  });
}

function renderRun() {
  const visible = state.running ? state.runAt + 1 : state.runAt;
  document.getElementById("runlog").innerHTML =
    `<p>Heute</p>` +
    STEPS.slice(0, visible).map((step, index) => {
      const cls = index < state.runAt ? "done" : "now";
      return `<button type="button" class="run-step ${cls}" data-step="${index}">${esc(step.text)}</button>`;
    }).join("");
  document.querySelectorAll(".run-step").forEach((btn) => {
    btn.onclick = () => {
      const step = STEPS[Number(btn.dataset.step)];
      if (step && step.parcel && state.revealed) openParcel(step.parcel);
    };
  });
}

function stageButtons(id) {
  const stage = stageOf(id);
  return ["pruefung", "gespraech", "abgelegt"]
    .map((key) => {
      const label = key === "pruefung" ? "In Prüfung" : key === "gespraech" ? "Gespräch" : "Ablegen";
      return `<button type="button" class="pill ${stage === key ? "on" : ""}" data-stage="${key}">${label}</button>`;
    })
    .join("");
}

function renderFile() {
  const dock = document.getElementById("dock-right");
  const file = document.getElementById("file");
  dock.classList.toggle("idle", !state.parcelId && !state.stationId);
  if (state.parcelId) file.innerHTML = parcelFile(parcelById(state.parcelId));
  else if (state.stationId) file.innerHTML = `<div class="file-scroll">${stationFile(stationById(state.stationId))}</div>`;
  else {
    file.innerHTML = `<div class="file-scroll"><div class="empty"><p class="kicker">Akte</p><h2>Fläche oder Werk wählen</h2><p>Klicke auf der Karte, in der Liste oder auf eine Linie zwischen Fläche und Werk.</p></div></div>`;
  }
  wireFile();
  const ctx = document.getElementById("chat-context");
  if (state.parcelId) {
    const p = parcelById(state.parcelId);
    ctx.textContent = p.kg + ", GST " + p.gst;
  } else if (state.stationId) {
    ctx.textContent = stationById(state.stationId).name;
  } else ctx.textContent = "Zum ganzen Auftrag";
}

function parcelFile(p) {
  const existing = nearest(p, ["bestehend"]);
  const planned = nearest(p, ["geplant", "ausbau"]);
  const opened = state.opened[p.id];
  return `
    <div class="file-scroll">
      <p class="kicker">Fläche · Beispiel</p>
      <h2>${esc(p.kg)}</h2>
      <p class="quiet">GST ${esc(p.gst)} · ${esc(STAGE_LABEL[stageOf(p.id)])} · ${score(p)} Punkte</p>
      <div class="facts">
        <button type="button" class="fact" data-fly="parcel"><b>${esc(fmtHa(p.ha))}</b><span>${esc(p.zoning)}</span></button>
        <button type="button" class="fact" data-station="${existing.s.id}"><b>${esc(fmtKm(existing.d))}</b><span>bis ${esc(existing.s.name)}</span></button>
        <button type="button" class="fact" data-station="${planned.s.id}"><b>${esc(fmtKm(planned.d))}</b><span>bis ${esc(planned.s.name)}</span></button>
        <div class="fact"><b>${p.rail ? "Gleis" : "Kein Gleis"}</b><span>${p.altlast ? "Altlast im Beispiel" : "Keine Altlast im Beispiel"}</span></div>
      </div>
      <ul class="factors">${factors(p).map((line) => `<li>${esc(line)}</li>`).join("")}</ul>
      <p class="note" id="owner-line">${opened ? "Eigentümer im Beispiel: " + esc(p.owner) : "Eigentümer noch nicht abgefragt. Der Name kommt erst mit dem B-Blatt."}</p>
    </div>
    <div class="actions file-actions">
      <button type="button" class="pill" id="gb">${opened ? "Auszug liegt vor" : "B-Blatt, 2,60 €"}</button>
      ${stageButtons(p.id)}
      ${stageOf(p.id) !== "offen" ? `<button type="button" class="pill" data-stage="offen">Wieder öffnen</button>` : ""}
    </div>
  `;
}

function stationFile(s) {
  const near = DATA.parcels
    .map((p) => ({ p, d: km(p, s) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 4);
  return `
    <p class="kicker">Werk · ${esc(kindLabel(s.kind))}</p>
    <h2>${esc(s.name)}</h2>
    <p>${esc(s.note)}</p>
    <p>Stand der öffentlichen Tabelle, 1. Oktober 2026: 0 MW freie uneingeschränkte Bezugsleistung. Offene Anträge auf Bezug: 14.084 MW in Niederösterreich, 927 MW in Wien, als Summe je Land. Das ist keine Anschlusszusage.</p>
    <div class="station-list">
      ${near
        .map(
          (hit) =>
            `<button type="button" class="jump" data-parcel="${hit.p.id}">${esc(hit.p.kg)}, ${esc(hit.p.gst)} · ${esc(fmtKm(hit.d))}</button>`
        )
        .join("")}
    </div>
  `;
}

function wireFile() {
  const close = document.getElementById("file");
  close.querySelectorAll("[data-parcel]").forEach((btn) => {
    btn.onclick = () => openParcel(btn.dataset.parcel);
  });
  close.querySelectorAll("[data-station]").forEach((btn) => {
    btn.onclick = () => openStation(btn.dataset.station);
  });
  const flyBtn = close.querySelector("[data-fly]");
  if (flyBtn && state.parcelId) {
    flyBtn.onclick = () => {
      const p = parcelById(state.parcelId);
      fly(p.lat, p.lng, 14);
    };
  }
  const gb = document.getElementById("gb");
  if (gb) {
    gb.onclick = () => {
      const id = state.parcelId;
      if (!id || state.opened[id]) return;
      state.opened[id] = true;
      if (stageOf(id) === "offen") state.stages[id] = "pruefung";
      saveStore();
      refresh();
      addBot(parcelById(id).kg + ", GST " + parcelById(id).gst + ": Beispielname " + parcelById(id).owner + ". Das B-Blatt ist im Prototyp mit 2,60 € angesetzt.");
    };
  }
  close.querySelectorAll("[data-stage]").forEach((btn) => {
    btn.onclick = () => {
      const id = state.parcelId;
      const next = btn.dataset.stage;
      if (stageOf(id) === next) delete state.stages[id];
      else state.stages[id] = next;
      saveStore();
      refresh();
    };
  });
}

function refresh() {
  renderMandate();
  renderCounts();
  renderList();
  renderRun();
  renderFile();
  renderReading();
  drawParcels();
  drawStations();
  paintLinks();
  applyLayers();
}

function openParcel(id) {
  state.parcelId = id;
  state.stationId = null;
  state.view = "flaechen";
  setView("flaechen");
  const p = parcelById(id);
  fly(p.lat, p.lng, 12.5);
  refresh();
}

function openStation(id) {
  state.stationId = id;
  state.parcelId = null;
  state.view = "flaechen";
  setView("flaechen");
  const s = stationById(id);
  fly(s.lat, s.lng, 12);
  refresh();
}

function clearFocus() {
  state.parcelId = null;
  state.stationId = null;
  refresh();
}

function nextParcel() {
  const row = ranked().find((p) => stageOf(p.id) === "offen" || stageOf(p.id) === "pruefung");
  if (row) openParcel(row.id);
}

function reportHtml() {
  const top = ranked().slice(0, 4);
  const fresh = state.revealed
    ? `<p class="reveal">Schwechat, GST 412/3. ${esc(DATA.parcels[0].signal)} Etwa 2,4 Hektar, Widmung Industriegebiet. Der Eigentümer ist ${state.opened.sw ? "im Beispiel abgefragt." : "noch nicht abgefragt."}</p>`
    : "";
  return `
    <p class="kicker">Morgenbericht</p>
    <h2>Was heute auf dem Tisch liegt</h2>
    <p class="when">Auftrag „${esc(mandate().label)}“. Beispiel, keine echten Eigentümer.</p>
    <p>Die Stromlage ist unverändert. An den Werken der Austrian Power Grid ist keine freie uneingeschränkte Bezugsleistung ausgewiesen. In Niederösterreich liegen offene Anträge auf Bezug von 14.084 Megawatt, in Wien von 927 Megawatt, jeweils als Summe für das Land. Stand der öffentlichen Tabelle: 1. Oktober 2026.</p>
    ${fresh}
    <p>Flächen nahe an geplanten Werken bleiben oben, auch ohne Meldung.</p>
    <div class="linkrow">
      ${top.map((p) => `<button type="button" class="jump" data-parcel="${p.id}">${esc(p.kg)}, ${esc(p.gst)}</button>`).join("")}
    </div>
    <p>Simmering bleibt wegen der Altlast sichtbar und steht unten. Was kleiner ist als der Auftrag, rutscht mit.</p>
  `;
}

function powerHtml() {
  return `
    <p class="kicker">Stromlage</p>
    <h2>Bezug, nicht Einspeisung</h2>
    <p class="when">Öffentliche Tabelle der Austrian Power Grid, Stand 1. Oktober 2026. Im Prototyp festgehalten.</p>
    <p>Freie uneingeschränkte Bezugsleistung an jedem ausgewiesenen Umspannwerk: 0 Megawatt. Offene Anträge auf Bezug: 14.084 Megawatt in Niederösterreich, 927 Megawatt in Wien. Das sind Summen für das Bundesland, nicht die freie Leistung eines einzelnen Werks.</p>
    <p>Ein großes Rechenzentrum braucht oft 50 bis 200 Megawatt. Die Schlange ist lang. Den Anschluss sagt der Netzbetreiber zu.</p>
    <p>Einspeisung, also Strom ins Netz, und Bezug, also Strom für den Betrieb, sind getrennt. Dieser Auftrag braucht Bezug.</p>
    <div class="linkrow">
      ${DATA.substations.map((s) => `<button type="button" class="jump" data-station="${s.id}">${esc(s.name)}</button>`).join("")}
    </div>
  `;
}

function renderReading() {
  document.getElementById("panel-bericht").innerHTML = reportHtml();
  document.getElementById("panel-strom").innerHTML = powerHtml();
  document.querySelectorAll(".reader [data-parcel]").forEach((btn) => {
    btn.onclick = () => openParcel(btn.dataset.parcel);
  });
  document.querySelectorAll(".reader [data-station]").forEach((btn) => {
    btn.onclick = () => openStation(btn.dataset.station);
  });
}

function setView(name) {
  state.view = name;
  document.querySelectorAll("#nav button").forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.view === name);
  });
  document.querySelectorAll(".dock-left .panel").forEach((el) => {
    el.classList.toggle("on", el.id === "panel-" + name);
  });
  setTimeout(() => map.invalidateSize(), 40);
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
  for (let i = 0; i < STEPS.length; i += 1) {
    state.runAt = i;
    setLive(STEPS[i].text, true);
    renderRun();
    await sleep(900);
  }
  state.revealed = true;
  state.runAt = STEPS.length;
  state.running = false;
  saveStore();
  setLive("Lauf fertig. Eine Fläche neu.", false);
  refresh();
  if (!state.greeted) {
    state.greeted = true;
    addBot("Schwechat, GST 412/3 hängt jetzt am Auftrag. Anlass ist eine Beispiel-Meldung zum Sitz. Der Eigentümer ist noch nicht abgefragt.", [
      { parcel: "sw", label: "Schwechat öffnen" },
    ]);
  }
}

function answer(raw) {
  const q = raw.toLowerCase();
  const openActions = (id, label) => [{ parcel: id, label: label || "Auf der Karte" }];
  if (/bericht|morgen|heute|lauf/.test(q)) {
    return {
      text: state.revealed
        ? "Im Bericht steht die Stromlage und die neue Fläche Schwechat, GST 412/3. Der Anlass ist eine Beispiel-Meldung: ein Sitz wurde von der Adresse wegverlegt."
        : "Der Lauf ist noch nicht durch. Im Bericht steht bisher die Stromlage und die Flächen an den geplanten Werken.",
      actions: state.revealed ? openActions("sw", "Schwechat öffnen") : [],
    };
  }
  if (/strom|megawatt|mw|umspann|anschluss|bezug|einspeis/.test(q)) {
    return {
      text: "Stand 1. Oktober 2026: 0 MW freie uneingeschränkte Bezugsleistung. Offene Anträge auf Bezug: 14.084 MW in Niederösterreich, 927 MW in Wien, als Summe je Land. Geplant auf der Karte: Wien Ost in Deutsch-Wagram, Trumau, Seyring, Gaweinstal, Ausbau Sarasdorf. Das ist keine Anschlusszusage. Der Auftrag braucht Bezug, nicht Einspeisung.",
      actions: [],
    };
  }
  if (/eigentümer|grundbuch|b-blatt|name/.test(q)) {
    const opened = Object.keys(state.opened);
    if (!opened.length) {
      return {
        text: "Noch kein Auszug. In der Akte liegt der Knopf für das B-Blatt, im Beispiel 2,60 €. Vorher steht hier kein Name.",
        actions: state.parcelId ? openActions(state.parcelId, "Akte offen lassen") : [],
      };
    }
    return {
      text: opened
        .map((id) => {
          const p = parcelById(id);
          return p.kg + ", " + p.gst + ": " + p.owner + ", Beispiel.";
        })
        .join(" "),
      actions: opened.slice(0, 2).map((id) => ({ parcel: id, label: parcelById(id).kg })),
    };
  }
  if (/nächst|naechst|arbeitsliste|was tun|offen/.test(q)) {
    const row = ranked().find((p) => stageOf(p.id) === "offen" || stageOf(p.id) === "pruefung");
    if (!row) return { text: "Keine Fläche ist noch offen oder in Prüfung.", actions: [] };
    return {
      text: "Als Nächstes liegt " + row.kg + ", GST " + row.gst + " oben. " + reason(row),
      actions: openActions(row.id, row.kg + " öffnen"),
    };
  }
  if (/gespräch|gespraech|anruf/.test(q)) {
    const rows = ranked().filter((p) => stageOf(p.id) === "gespraech");
    if (!rows.length) return { text: "Noch kein Gespräch vorgemerkt. Das stellst du in der Akte ein.", actions: [] };
    return {
      text: rows.map((p) => p.kg + ", GST " + p.gst).join("; ") + " steht auf Gespräch.",
      actions: rows.slice(0, 3).map((p) => ({ parcel: p.id, label: p.kg })),
    };
  }
  if (/logistik/.test(q) && state.mandateId !== "log") {
    return {
      text: "Der andere Auftrag sucht Logistik mit Gleis, ab 1,5 Hektar. Im Beispiel hat Himberg einen Gleisanschluss.",
      actions: [{ mandate: "log", label: "Auftrag Logistik" }],
    };
  }
  if (/rechenzentrum|server/.test(q) && state.mandateId !== "rz") {
    return {
      text: "Der Auftrag Rechenzentrum sucht ab 2 Hektar ohne Pflicht auf ein Gleis, mit Bezug in Reichweite eines Werks.",
      actions: [{ mandate: "rz", label: "Auftrag Rechenzentrum" }],
    };
  }
  const current = state.parcelId ? parcelById(state.parcelId) : state.stationId ? null : null;
  const hit =
    DATA.parcels.find((p) => q.includes(p.kg.toLowerCase()) || q.includes(String(p.gst).toLowerCase())) ||
    ((/diese|die fläche|die flaeche|hier|akte/.test(q) && current) ? current : null);
  if (hit) {
    const existing = nearest(hit, ["bestehend"]);
    const planned = nearest(hit, ["geplant", "ausbau"]);
    return {
      text:
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
        (signalOf(hit) || reason(hit)) +
        (state.opened[hit.id] ? " Eigentümer im Beispiel: " + hit.owner + "." : " Eigentümer noch nicht abgefragt.") +
        " Lage: " +
        STAGE_LABEL[stageOf(hit.id)] +
        ".",
      actions: openActions(hit.id, "Auf der Karte"),
    };
  }
  const station = DATA.substations.find((s) => q.includes(s.name.toLowerCase().split(",")[0]));
  if (station || state.stationId && /werk|dieses/.test(q)) {
    const s = station || stationById(state.stationId);
    return { text: s.name + ". " + s.note, actions: [{ station: s.id, label: "Werk öffnen" }] };
  }
  if (/warum|oben|liste|sort|punkte/.test(q)) {
    const top = ranked()[0];
    return {
      text: "Oben steht " + top.kg + ", GST " + top.gst + ", mit " + score(top) + " Punkten. " + factors(top)[0] + " " + reason(top),
      actions: openActions(top.id, top.kg + " öffnen"),
    };
  }
  return { text: "Dazu liegt in den geladenen Flächen und Werken nichts.", actions: [] };
}

function addMsg(text, kind, actions) {
  const log = document.getElementById("chat-log");
  const el = document.createElement("div");
  el.className = "msg " + kind;
  const body = document.createElement("div");
  body.textContent = text;
  el.appendChild(body);
  (actions || []).forEach((action) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "jump";
    btn.textContent = action.label;
    btn.onclick = () => {
      if (action.parcel) openParcel(action.parcel);
      if (action.station) openStation(action.station);
      if (action.mandate) {
        state.mandateId = action.mandate;
        saveStore();
        refresh();
      }
    };
    el.appendChild(btn);
  });
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}

function addBot(text, actions) {
  addMsg(text, "bot", actions);
}

function ask(text) {
  const q = text.trim();
  if (!q) return;
  addMsg(q, "user");
  const result = answer(q);
  addBot(result.text, result.actions);
}

function frame() {
  const width = window.innerWidth;
  if (width < 860) {
    map.fitBounds(
      [
        [47.98, 16.22],
        [48.5, 16.66],
      ],
      { paddingTopLeft: [24, 140], paddingBottomRight: [24, 280], animate: false }
    );
    return;
  }
  const left = width < 1180 ? 360 : 420;
  const right = width < 1180 ? 420 : 500;
  map.fitBounds(
    [
      [47.98, 16.22],
      [48.5, 16.66],
    ],
    { paddingTopLeft: [left, 110], paddingBottomRight: [right, 80], animate: false }
  );
}

function init() {
  const select = document.getElementById("mandate");
  select.innerHTML = DATA.mandates.map((m) => `<option value="${m.id}">${esc(m.label)}</option>`).join("");
  select.value = state.mandateId;
  select.onchange = () => {
    state.mandateId = select.value;
    saveStore();
    refresh();
  };
  document.querySelectorAll("#nav button").forEach((btn) => {
    btn.onclick = () => setView(btn.dataset.view);
  });
  document.getElementById("next").onclick = nextParcel;
  document.getElementById("live").onclick = () => {
    setView("flaechen");
    document.getElementById("runlog").scrollIntoView({ block: "nearest" });
  };
  document.querySelectorAll("#basemap button").forEach((btn) => {
    btn.onclick = () => setBase(btn.dataset.base);
  });
  document.querySelectorAll("#layers button").forEach((btn) => {
    btn.onclick = () => {
      const key = btn.dataset.layer;
      state.layers[key] = !state.layers[key];
      saveStore();
      applyLayers();
    };
  });
  document.getElementById("zoom-in").onclick = () => map.setZoom(map.getZoom() + 0.25);
  document.getElementById("zoom-out").onclick = () => map.setZoom(map.getZoom() - 0.25);
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
  drawParcels();
  applyLayers();
  renderFilters();
  refresh();
  frame();
  setTimeout(() => map.invalidateSize(), 80);
  window.addEventListener("resize", () => map.invalidateSize());
  if (state.revealed) setLive("Letzter Lauf liegt vor.", false);
  else playRun();
}

init();
