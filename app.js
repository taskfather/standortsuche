const DATA = window.DATA;
const storeKey = "standortsuche-feedback";

const state = {
  mandateId: "rz",
  view: "karte",
  selected: null,
  revealed: false,
  running: false,
  opened: {},
  feedback: loadFeedback(),
};

const map = L.map("map", { zoomControl: true, attributionControl: true });
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap",
  maxZoom: 19,
}).addTo(map);

const parcelLayer = L.layerGroup().addTo(map);
const uwLayer = L.layerGroup().addTo(map);
const markers = {};

function loadFeedback() {
  try {
    return JSON.parse(localStorage.getItem(storeKey) || "{}");
  } catch {
    return {};
  }
}

function saveFeedback() {
  localStorage.setItem(storeKey, JSON.stringify(state.feedback));
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

function nearest(parcel, kinds) {
  const list = DATA.substations.filter((s) => kinds.includes(s.kind));
  return list
    .map((s) => ({ s, d: km(parcel, s) }))
    .sort((a, b) => a.d - b.d)[0];
}

function fmtKm(d) {
  return d.toFixed(1).replace(".", ",") + " km";
}

function mandate() {
  return DATA.mandates.find((m) => m.id === state.mandateId);
}

function signalOf(p) {
  if (p.id === "sw" && !state.revealed) return "";
  return p.signal;
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
  const mark = state.feedback[p.id];
  if (mark === "anrufen") s += 12;
  if (mark === "kenne" || mark === "uninteressant") s -= 70;
  return s;
}

function ranked() {
  return DATA.parcels.slice().sort((a, b) => score(b) - score(a) || b.ha - a.ha);
}

function reason(p) {
  if (p.altlast) return "Altlast im Beispiel. Deshalb kein Anruf.";
  const mark = state.feedback[p.id];
  if (mark === "uninteressant") return "Als uninteressant markiert.";
  if (mark === "kenne") return "Schon bekannt.";
  const sig = signalOf(p);
  if (sig) return "Meldung hängt an der Fläche.";
  const planned = nearest(p, ["geplant", "ausbau"]);
  if (planned && planned.d < 4) {
    return "Nahe am geplanten Werk " + planned.s.name + ", " + fmtKm(planned.d) + ".";
  }
  if (p.rail && mandate().wantRail) return "Gleisanschluss im Beispiel.";
  if (p.ha < mandate().minHa) return "Kleiner als der Auftrag.";
  return "Gewerbliche Fläche im Suchgebiet.";
}

function drawSubstations() {
  uwLayer.clearLayers();
  DATA.substations.forEach((s) => {
    const icon = L.divIcon({
      className: "pin-wrap",
      html: `<span class="pin ${s.kind}"></span>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
    L.marker([s.lat, s.lng], { icon, interactive: false }).addTo(uwLayer);
  });
}

function drawParcels() {
  parcelLayer.clearLayers();
  DATA.parcels.forEach((p) => {
    const cls = [
      "pin",
      state.selected === p.id ? "on" : "",
      p.id === "sw" && state.revealed ? "new" : "",
    ].filter(Boolean);
    const icon = L.divIcon({
      className: "pin-wrap",
      html: `<span class="${cls.join(" ")}"></span>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
    const marker = L.marker([p.lat, p.lng], { icon });
    marker.on("click", () => openParcel(p.id));
    marker.addTo(parcelLayer);
    markers[p.id] = marker;
  });
}

function renderList() {
  const rows = ranked();
  document.getElementById("list-note").textContent =
    rows.length + " Flächen, sortiert nach dem Auftrag. Beispiel, keine echten Eigentümer.";
  document.getElementById("list").innerHTML = rows
    .map((p) => {
      const tags = [];
      if (p.id === "sw" && state.revealed) tags.push('<span class="tag new">neu</span>');
      if (p.rail) tags.push('<span class="tag">Gleis</span>');
      if (p.altlast) tags.push('<span class="tag warn">Altlast</span>');
      const mark = state.feedback[p.id];
      if (mark === "anrufen") tags.push('<span class="tag keep">anrufen</span>');
      if (mark === "kenne") tags.push('<span class="tag">kenne ich</span>');
      if (mark === "uninteressant") tags.push('<span class="tag">uninteressant</span>');
      return `<button type="button" class="row ${state.selected === p.id ? "on" : ""}" data-id="${p.id}">
        <strong>${p.kg}, ${p.gst}</strong>
        <em>${p.ha.toFixed(1).replace(".", ",")} ha · ${reason(p)}</em>
        <span class="tags">${tags.join("")}</span>
      </button>`;
    })
    .join("");
  document.getElementById("list").querySelectorAll(".row").forEach((btn) => {
    btn.onclick = () => openParcel(btn.dataset.id);
  });
}

function openParcel(id) {
  state.selected = id;
  const p = DATA.parcels.find((x) => x.id === id);
  document.getElementById("list-wrap").hidden = true;
  document.getElementById("sheet").hidden = false;
  const existing = nearest(p, ["bestehend"]);
  const planned = nearest(p, ["geplant", "ausbau"]);
  const opened = state.opened[id];
  const mark = state.feedback[id] || "";
  const sig = signalOf(p);
  document.getElementById("sheet").innerHTML = `
    <button type="button" class="back" id="back">Zurück zur Liste</button>
    <h2>${p.kg}, GST ${p.gst}</h2>
    <p class="quiet">Beispiel. Der Name erscheint erst nach der Abfrage.</p>
    <div class="facts">
      <div><b>${p.ha.toFixed(1).replace(".", ",")} ha</b><span>Fläche</span></div>
      <div><b>${p.zoning}</b><span>Widmung</span></div>
      <div><b>${fmtKm(existing.d)}</b><span>bis ${existing.s.name}</span></div>
      <div><b>${fmtKm(planned.d)}</b><span>bis ${planned.s.name}</span></div>
    </div>
    <p class="reason">${sig || reason(p)}</p>
    ${p.altlast ? '<p class="reason">Auf dem Blatt steht eine Altlast. Die Fläche bleibt sichtbar und rutscht nach unten.</p>' : ""}
    ${p.rail ? '<p class="reason">Im Beispiel liegt ein Gleisanschluss auf der Fläche.</p>' : ""}
    <p class="reason" id="owner-line">${opened ? "Eigentümer im Beispiel: " + p.owner : "Eigentümer noch nicht abgefragt."}</p>
    <div class="actions">
      <button type="button" id="gb">${opened ? "Auszug liegt vor" : "B-Blatt holen, 2,60 €"}</button>
      <button type="button" data-mark="kenne" class="${mark === "kenne" ? "on" : ""}">Kenne ich</button>
      <button type="button" data-mark="uninteressant" class="${mark === "uninteressant" ? "on" : ""}">Uninteressant</button>
      <button type="button" data-mark="anrufen" class="${mark === "anrufen" ? "on" : ""}">Anrufen</button>
    </div>
  `;
  document.getElementById("back").onclick = () => {
    state.selected = null;
    document.getElementById("sheet").hidden = true;
    document.getElementById("list-wrap").hidden = false;
    drawParcels();
    renderList();
  };
  document.getElementById("gb").onclick = () => {
    if (state.opened[id]) return;
    state.opened[id] = true;
    openParcel(id);
  };
  document.getElementById("sheet").querySelectorAll("[data-mark]").forEach((btn) => {
    btn.onclick = () => {
      const key = btn.dataset.mark;
      state.feedback[id] = state.feedback[id] === key ? "" : key;
      if (!state.feedback[id]) delete state.feedback[id];
      saveFeedback();
      openParcel(id);
      renderList();
    };
  });
  drawParcels();
  map.panTo([p.lat, p.lng], { animate: true });
  if (state.view !== "karte") setView("karte");
}

function reportHtml() {
  const fresh = state.revealed
    ? `<p class="reveal">Schwechat, GST 412/3. ${DATA.parcels[0].signal} Die Fläche hat etwa 2,4 Hektar, Widmung Industriegebiet. Der Eigentümer ist noch nicht abgefragt.</p>`
    : "";
  return `
    <h2>Morgenbericht</h2>
    <p class="when">Beispiel für den Auftrag „${mandate().label}“.</p>
    <p>Oben auf der Karte stehen die großen gewerblichen Flächen im Suchgebiet. Die Stromlage ist unverändert: an den Werken der Austrian Power Grid ist keine freie uneingeschränkte Bezugsleistung ausgewiesen. In Niederösterreich liegen offene Anträge auf Bezug von 14.084 Megawatt, in Wien von 927 Megawatt, jeweils als Summe für das Land. Stand der öffentlichen Tabelle: 1. Oktober 2026.</p>
    <p>Flächen nahe an geplanten Werken bleiben oben, auch ohne Meldung: Deutsch-Wagram am geplanten Wien Ost, Seyring, Trumau.</p>
    ${fresh}
    <p>Eine Fläche mit Altlast in Simmering bleibt in der Liste und steht unten. Liesing ist mit 1,4 Hektar kleiner als dieser Auftrag.</p>
  `;
}

function powerHtml() {
  return `
    <h2>Stromlage</h2>
    <p class="when">Öffentliche Tabelle der Austrian Power Grid, Stand 1. Oktober 2026. Im Prototyp festgehalten, nicht live nachgeladen.</p>
    <p>Freie uneingeschränkte Bezugsleistung an jedem ausgewiesenen Umspannwerk: 0 Megawatt. Offene Anträge auf Bezug: 14.084 Megawatt in Niederösterreich, 927 Megawatt in Wien. Das sind Summen für das Bundesland, nicht die freie Leistung eines einzelnen Werks.</p>
    <p>Ein großes Rechenzentrum braucht oft 50 bis 200 Megawatt. Die Schlange ist lang. Die Zahl ist eine Momentaufnahme. Den Anschluss sagt der Netzbetreiber zu.</p>
    <p>Geplante und ausgebaute Werke, die auf der Karte liegen: Wien Ost in Deutsch-Wagram, Trumau, Seyring, Gaweinstal, weiterer Umspanner in Sarasdorf, Wien Südost.</p>
    <p>Einspeisung, also Strom ins Netz, und Bezug, also Strom für den Betrieb, sind hier getrennt. Der Auftrag braucht Bezug.</p>
  `;
}

function renderReading() {
  document.getElementById("report").innerHTML = reportHtml();
  document.getElementById("power").innerHTML = powerHtml();
}

function setView(name) {
  state.view = name;
  document.querySelectorAll("nav button").forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.view === name);
  });
  document.querySelectorAll(".view").forEach((el) => {
    el.classList.toggle("on", el.id === "view-" + name);
  });
  if (name === "karte") {
    setTimeout(() => map.invalidateSize(), 40);
  }
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
  const steps = [
    "Edikte gelesen. Keine neue Versteigerung im Suchgebiet.",
    "Presse gelesen. Eine Meldung mit Ortsbezug.",
    "Schwechat, GST 412/3 an den Auftrag gehängt.",
  ];
  for (const step of steps) {
    setLive(step, true);
    await sleep(900);
  }
  state.revealed = true;
  state.running = false;
  setLive("Lauf fertig. Eine Fläche neu.", false);
  drawParcels();
  renderList();
  renderReading();
  if (state.selected === "sw") openParcel("sw");
}

function answer(raw) {
  const q = raw.toLowerCase();
  if (/bericht|morgen|heute/.test(q)) {
    return state.revealed
      ? "Im Morgenbericht steht die Stromlage und die neue Fläche Schwechat, GST 412/3. Der Anlass ist eine Beispiel-Meldung: ein Sitz wurde von der Adresse wegverlegt. Der Eigentümer ist noch nicht abgefragt."
      : "Der Morgenbericht hat die Stromlage und die Flächen an den geplanten Werken. Die Presse ist in diesem Lauf noch nicht eingehängt.";
  }
  if (/strom|megawatt|umspann|anschluss|bezug/.test(q)) {
    return "Stand 1. Oktober 2026: 0 Megawatt freie uneingeschränkte Bezugsleistung. Offene Anträge auf Bezug: 14.084 Megawatt in Niederösterreich, 927 in Wien, als Summe je Land. Geplant und auf der Karte: Wien Ost in Deutsch-Wagram, Trumau, Seyring, Gaweinstal, Ausbau Sarasdorf. Das ist keine Anschlusszusage.";
  }
  if (/eigentümer|grundbuch|name/.test(q)) {
    const opened = Object.keys(state.opened);
    if (!opened.length) {
      return "Noch kein Auszug. Auf dem Flächenblatt steht der Knopf, 2,60 Euro für das B-Blatt. Vorher nennt die Seite keinen Namen.";
    }
    return opened
      .map((id) => {
        const p = DATA.parcels.find((x) => x.id === id);
        return p.kg + ", " + p.gst + ": " + p.owner + ", Beispiel.";
      })
      .join(" ");
  }
  const hit = DATA.parcels.find((p) => q.includes(p.kg.toLowerCase()) || q.includes(p.gst.toLowerCase()));
  if (hit) {
    const existing = nearest(hit, ["bestehend"]);
    const planned = nearest(hit, ["geplant", "ausbau"]);
    const sig = signalOf(hit);
    return (
      hit.kg +
      ", GST " +
      hit.gst +
      ": " +
      hit.ha.toFixed(1).replace(".", ",") +
      " ha, " +
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
      (sig || reason(hit)) +
      (state.opened[hit.id] ? " Eigentümer im Beispiel: " + hit.owner + "." : " Eigentümer noch nicht abgefragt.")
    );
  }
  if (/warum|oben|liste|sort/.test(q)) {
    const top = ranked()[0];
    return "Oben steht " + top.kg + ", " + top.gst + ". " + reason(top);
  }
  return "Dazu liegt hier nichts. Frag nach Schwechat, Deutsch-Wagram, dem Morgenbericht oder der Stromlage.";
}

function addMsg(text, kind) {
  const log = document.getElementById("chat-log");
  const el = document.createElement("div");
  el.className = "msg " + (kind || "");
  el.textContent = text;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}

function ask(text) {
  const q = text.trim();
  if (!q) return;
  addMsg(q, "user");
  addMsg(answer(q), "");
}

function init() {
  const select = document.getElementById("mandate");
  select.innerHTML = DATA.mandates
    .map((m) => `<option value="${m.id}">${m.label}</option>`)
    .join("");
  select.onchange = () => {
    state.mandateId = select.value;
    renderList();
    renderReading();
  };
  document.querySelectorAll("nav button").forEach((btn) => {
    btn.onclick = () => setView(btn.dataset.view);
  });
  const chips = ["Warum steht eine Fläche oben?", "Was steht im Morgenbericht?", "Wie ist die Stromlage?"];
  document.getElementById("chips").innerHTML = chips
    .map((c) => `<button type="button">${c}</button>`)
    .join("");
  document.getElementById("chips").querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => ask(btn.textContent);
  });
  document.getElementById("chat-form").onsubmit = (event) => {
    event.preventDefault();
    const input = document.getElementById("chat-input");
    ask(input.value);
    input.value = "";
  };
  addMsg("Frag nach einer Fläche, dem Morgenbericht oder der Stromlage.", "");
  drawSubstations();
  drawParcels();
  map.fitBounds([[47.98, 16.22], [48.5, 16.66]], { padding: [28, 28] });
  setTimeout(() => map.invalidateSize(), 80);
  renderList();
  renderReading();
  playRun();
}

init();
