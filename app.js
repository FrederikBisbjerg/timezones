"use strict";

// ---------- Time maths ----------

const partsFormatters = new Map();

/** Wall-clock parts of an instant in a zone. */
function partsIn(date, zone) {
  let f = partsFormatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    partsFormatters.set(zone, f);
  }
  const o = {};
  for (const p of f.formatToParts(date)) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second };
}

/** Minutes a zone is ahead of UTC at an instant. */
function offsetMinutes(date, zone) {
  const p = partsIn(date, zone);
  const asUTC = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asUTC - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

const pad = (n) => String(n).padStart(2, "0");

/** "2026-11-11T16:07" as read on a clock in `zone` -> the instant it refers to. */
function wallToInstant(wall, zone) {
  const [Y, M, D, h, mi] = wall.match(/\d+/g).map(Number);
  const guess = Date.UTC(Y, M - 1, D, h, mi);
  // The zone's offset a day either side; they differ only around a clock change.
  const before = offsetMinutes(new Date(guess - 86400000), zone);
  const after = offsetMinutes(new Date(guess + 86400000), zone);
  const first = new Date(guess - before * 60000);
  if (before === after || instantToWall(first, zone) === wall.slice(0, 16)) return first;
  const second = new Date(guess - after * 60000);
  if (instantToWall(second, zone) === wall.slice(0, 16)) return second;
  return first; // a time skipped by the clocks going forward: move it forward, as iOS does
}

function instantToWall(date, zone) {
  const p = partsIn(date, zone);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

/** Calendar days between the date in `zone` and the date in `source` at one instant. */
function dayOffset(date, zone, source) {
  const a = partsIn(date, zone), b = partsIn(date, source);
  return Math.round((Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(b.y, b.m - 1, b.d)) / 86400000);
}

function hoursLabel(minutes) {
  const abs = Math.abs(minutes), h = Math.floor(abs / 60), m = abs % 60;
  return m === 0 ? `${h}` : `${h}:${pad(m)}`;
}

function gmtLabel(date, zone) {
  const off = offsetMinutes(date, zone);
  return off === 0 ? "GMT" : `GMT${off < 0 ? "-" : "+"}${hoursLabel(off)}`;
}

function differenceLabel(date, zone, source, sourceName) {
  const diff = offsetMinutes(date, zone) - offsetMinutes(date, source);
  if (diff === 0) return `same as ${sourceName}`;
  return `${hoursLabel(diff)}h ${diff > 0 ? "ahead of" : "behind"} ${sourceName}`;
}

function isValidZone(zone) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); return true; } catch { return false; }
}

const timeFormatters = new Map(), dayFormatters = new Map();
function timeText(date, zone) {
  let f = timeFormatters.get(zone);
  if (!f) { f = new Intl.DateTimeFormat(undefined, { timeZone: zone, hour: "numeric", minute: "2-digit" }); timeFormatters.set(zone, f); }
  return f.format(date);
}
function dayText(date, zone) {
  let f = dayFormatters.get(zone);
  if (!f) { f = new Intl.DateTimeFormat(undefined, { timeZone: zone, weekday: "short", day: "numeric", month: "short" }); dayFormatters.set(zone, f); }
  return f.format(date);
}

// ---------- Catalogue and search ----------

// Browsers still use a few old spellings of zone names; show the modern city name.
const CITY_RENAMES = { Calcutta: "Kolkata", Saigon: "Ho Chi Minh", Kiev: "Kyiv", Katmandu: "Kathmandu", Rangoon: "Yangon" };
const ZONE_ALIASES = { "Asia/Calcutta": "Asia/Kolkata", "Asia/Saigon": "Asia/Ho_Chi_Minh", "Europe/Kiev": "Europe/Kyiv", "Asia/Katmandu": "Asia/Kathmandu" };

function cityName(zone) {
  const last = zone.split("/").pop().replace(/_/g, " ");
  return CITY_RENAMES[last] || last;
}
function regionName(zone) { return zone.split("/").slice(0, -1).join(" / ").replace(/_/g, " "); }

const fold = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const CATALOG_ZONES = ZONES.filter((z) => isValidZone(z.zoneID)).map((z) => ({ ...z, isZone: true }));
const CATALOG_CITIES = (() => {
  let ids;
  try { ids = Intl.supportedValuesOf("timeZone"); } catch { ids = Object.keys(COUNTRIES); }
  const system = ids.filter((id) => id.includes("/") && !id.startsWith("Etc/")).map((id) => ({
    name: cityName(id), detail: COUNTRIES[id] || COUNTRIES[ZONE_ALIASES[id]] || regionName(id), zoneID: id,
  }));
  const seen = new Set(), out = [];
  for (const e of [...EXTRA_CITIES, ...system]) {
    if (!isValidZone(e.zoneID)) continue;
    const key = fold(e.name) + "|" + (ZONE_ALIASES[e.zoneID] || e.zoneID);
    if (!seen.has(key)) { seen.add(key); out.push({ keywords: [], isZone: false, ...e }); }
  }
  return out.sort((a, b) => fold(a.name).localeCompare(fold(b.name)));
})();

/** Best matches first: exact abbreviation or name, then prefix, then word prefix, then contains. */
function search(raw) {
  const q = fold(raw.trim());
  if (!q) return [];
  const scored = [];
  for (const e of [...CATALOG_ZONES, ...CATALOG_CITIES]) {
    const name = fold(e.name), keys = e.keywords.map(fold);
    let score = null;
    if (name === q || keys.includes(q)) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (name.includes(" " + q)) score = 2;
    else if (q.length >= 3 && (name.includes(q) || fold(e.detail).includes(q)
      || keys.some((k) => k.includes(q)) || fold(e.zoneID.replace(/_/g, " ")).includes(q))) score = 3;
    if (score !== null) scored.push([score, name, e]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
  return scored.map((s) => s[2]);
}

// ---------- State ----------

const STORE_KEY = "timezones.places.v1";
const LOCAL = "local";
const DEFAULTS = ["Europe/Copenhagen", "Europe/London", "America/New_York", "Asia/Dubai", "Asia/Singapore"];

function localZone() { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }
function sameZone(a, b) { return (ZONE_ALIASES[a] || a) === (ZONE_ALIASES[b] || b); }

function loadPlaces() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (Array.isArray(saved)) {
      return saved.filter((p) => p && typeof p.name === "string" && isValidZone(p.zoneID));
    }
  } catch { /* fall through to defaults */ }
  return DEFAULTS.filter((id) => !sameZone(id, localZone())).map((id) => ({ name: cityName(id), zoneID: id }));
}
function savePlaces() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state.places)); } catch { /* private mode */ }
}

const placeId = (p) => p.name + "|" + p.zoneID;
const nowWall = () => instantToWall(new Date(), localZone());

const state = {
  places: loadPlaces(),
  mode: "now",          // "now" | "custom"
  wall: nowWall(),      // the clock time the user entered
  sourceKey: LOCAL,     // which place that clock time belongs to
  hasPicked: false,
  editing: false,
  hintDismissed: false,
};

function sourcePlace() { return state.places.find((p) => placeId(p) === state.sourceKey); }
function sourceZone() { const p = state.mode === "custom" && sourcePlace(); return p ? p.zoneID : localZone(); }
function sourceName() { const p = state.mode === "custom" && sourcePlace(); return p ? p.name : cityName(localZone()); }
function currentInstant() { return state.mode === "now" ? new Date() : wallToInstant(state.wall, sourceZone()); }

// ---------- Rendering ----------

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const app = document.getElementById("app");

function zoneRow(name, zone, instant, isSource, extra = "") {
  const src = sourceZone();
  const gmt = gmtLabel(instant, zone);
  const sub = isSource ? gmt : `${gmt} · ${differenceLabel(instant, zone, src, sourceName())}`;
  const n = dayOffset(instant, zone, src);
  const day = dayText(instant, zone) + (n === 0 ? "" : ` (${n > 0 ? "+" : "−"}${Math.abs(n)} day${Math.abs(n) === 1 ? "" : "s"})`);
  return `<div class="row zone">${extra}
    <div class="grow"><div class="name">${esc(name)}</div><div class="sub">${esc(sub)}</div></div>
    <div class="right"><div class="time">${esc(timeText(instant, zone))}</div>
    <div class="day${n === 0 ? "" : " shift"}">${esc(day)}</div></div></div>`;
}

function isStandalone() {
  return window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}
function isIOS() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function render() {
  const instant = currentInstant();
  const local = localZone();
  const custom = state.mode === "custom";
  const editing = state.editing && state.places.length > 0;
  let html = `<div class="bar">
      ${state.places.length ? `<button class="pill${editing ? " done" : ""}" data-act="edit">${editing ? "Done" : "Edit"}</button>` : "<span></span>"}
      <button class="pill icon" data-act="add" aria-label="Add time zone or city">+</button>
    </div>
    <h1>Time Zones</h1>
    <div class="seg">
      <button data-act="mode" data-mode="now" aria-pressed="${!custom}">Now</button>
      <button data-act="mode" data-mode="custom" aria-pressed="${custom}">Pick a time</button>
    </div>`;

  if (custom) {
    html += `<div class="card">
      <label class="row"><span class="grow">Time</span>
        <input class="field" id="wall" type="datetime-local" value="${esc(state.wall)}" required></label>
      <label class="row"><span class="grow">In time zone</span>
        <select class="field" id="source">
          <option value="${LOCAL}"${state.sourceKey === LOCAL ? " selected" : ""}>${esc(cityName(local))} (yours)</option>
          ${state.places.map((p) => `<option value="${esc(placeId(p))}"${state.sourceKey === placeId(p) ? " selected" : ""}>${esc(p.name)}</option>`).join("")}
        </select></label>
      <div class="row"><button class="link" data-act="reset">Reset to current time</button></div>
    </div>`;
  }

  html += `<div class="label">Your time zone</div><div class="card">
    ${zoneRow(cityName(local), local, instant, !custom || state.sourceKey === LOCAL)}</div>
    <div class="label">Other time zones</div><div class="card">`;
  state.places.forEach((p, i) => {
    const controls = editing ? `<button class="del" data-act="delete" data-i="${i}" aria-label="Remove ${esc(p.name)}">−</button>` : "";
    const row = zoneRow(p.name, p.zoneID, instant, custom && state.sourceKey === placeId(p), controls);
    const move = editing ? `<div class="move">
        <button data-act="up" data-i="${i}" ${i === 0 ? "disabled" : ""} aria-label="Move ${esc(p.name)} up">▲</button>
        <button data-act="down" data-i="${i}" ${i === state.places.length - 1 ? "disabled" : ""} aria-label="Move ${esc(p.name)} down">▼</button>
      </div>` : "";
    html += row.replace(/<\/div>$/, move + "</div>");
  });
  html += `<button class="row link add" data-act="add" style="width:100%"><span class="plus">+</span>Add time zone or city</button></div>`;

  if (!isStandalone() && !state.hintDismissed) {
    const how = isIOS()
      ? "tap <b>Share</b>, then <b>Add to Home Screen</b>"
      : "open the browser menu and choose <b>Install</b> or <b>Add to Home screen</b>";
    html += `<div class="hint"><span class="grow">To use this like an app, ${how}.</span>
      <button data-act="hint" aria-label="Dismiss">×</button></div>`;
  }
  app.innerHTML = html;
}

// ---------- Actions ----------

function setSource(key) {
  // The entered clock time is kept; only the zone it belongs to changes.
  state.sourceKey = key;
}

app.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const i = Number(el.dataset.i);
  switch (el.dataset.act) {
    case "mode":
      state.mode = el.dataset.mode;
      if (state.mode === "custom" && !state.hasPicked) { state.wall = nowWall(); state.sourceKey = LOCAL; state.hasPicked = true; }
      break;
    case "reset": state.wall = instantToWall(new Date(), sourceZone()); break;
    case "edit": state.editing = !state.editing; break;
    case "delete":
      if (placeId(state.places[i]) === state.sourceKey) setSource(LOCAL);
      state.places.splice(i, 1); savePlaces();
      if (!state.places.length) state.editing = false;
      break;
    case "up": if (i > 0) { state.places.splice(i - 1, 0, state.places.splice(i, 1)[0]); savePlaces(); } break;
    case "down": if (i < state.places.length - 1) { state.places.splice(i + 1, 0, state.places.splice(i, 1)[0]); savePlaces(); } break;
    case "add": openSheet(); return;
    case "hint": state.hintDismissed = true; break;
  }
  render();
});

app.addEventListener("change", (e) => {
  if (e.target.id === "wall") {
    if (e.target.value) state.wall = e.target.value.slice(0, 16);
    render();
  } else if (e.target.id === "source") {
    setSource(e.target.value);
    render();
  }
});

// ---------- Add sheet ----------

const sheet = document.getElementById("sheet"), results = document.getElementById("results"), q = document.getElementById("q");

function entryRow(e) {
  const added = state.places.some((p) => p.name === e.name && p.zoneID === e.zoneID);
  const codes = e.isZone ? e.keywords.join("/") + " · " : "";
  return `<button class="row pick" data-name="${esc(e.name)}" data-zone="${esc(e.zoneID)}" ${added ? "disabled" : ""}>
    <span class="grow"><div>${esc(e.name)}</div>
    <div class="sub">${esc(codes + e.detail)} · ${esc(gmtLabel(new Date(), e.zoneID))}</div></span>${added ? "<span>✓</span>" : ""}</button>`;
}

function renderResults() {
  const text = q.value.trim();
  if (!text) {
    results.innerHTML = `<div class="label">Time zones</div><div class="card">${CATALOG_ZONES.map(entryRow).join("")}</div>
      <div class="label">Cities</div><div class="card">${CATALOG_CITIES.map(entryRow).join("")}</div>`;
    return;
  }
  const found = search(text);
  results.innerHTML = found.length
    ? `<div class="card">${found.map(entryRow).join("")}</div>`
    : `<div class="empty">No results for “${esc(text)}”</div>`;
  results.scrollTop = 0;
}

function openSheet() {
  q.value = "";
  renderResults();
  document.body.classList.add("sheet-open");
  results.scrollTop = 0;
  q.focus();
}
function closeSheet() { document.body.classList.remove("sheet-open"); q.blur(); }

q.addEventListener("input", renderResults);
document.getElementById("cancel").addEventListener("click", closeSheet);
document.getElementById("shade").addEventListener("click", closeSheet);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });
results.addEventListener("click", (e) => {
  const el = e.target.closest(".pick");
  if (!el || el.disabled) return;
  state.places.push({ name: el.dataset.name, zoneID: el.dataset.zone });
  savePlaces();
  closeSheet();
  render();
});

// ---------- Keeping the clock live ----------

let lastMinute = -1;
setInterval(() => {
  const minute = Math.floor(Date.now() / 60000);
  if (minute === lastMinute) return;
  lastMinute = minute;
  // Don't redraw underneath an open picker or the add sheet.
  const busy = document.body.classList.contains("sheet-open") || ["wall", "source"].includes(document.activeElement && document.activeElement.id);
  if (state.mode === "now" && !busy) render();
}, 1000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) render(); });

render();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
