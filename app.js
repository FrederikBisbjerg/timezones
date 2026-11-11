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

const textFormatters = new Map();
function formatter(kind, zone, options) {
  const key = kind + "|" + zone;
  let f = textFormatters.get(key);
  if (!f) { f = new Intl.DateTimeFormat(undefined, { timeZone: zone, ...options }); textFormatters.set(key, f); }
  return f;
}
/** "4:00 PM" or "16:00", following the 12/24-hour setting ("auto" uses the device's own). */
function timeText(date, zone, clock = "auto") {
  const options = clock === "24" ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }
    : clock === "12" ? { hour: "numeric", minute: "2-digit", hour12: true }
    : { hour: "numeric", minute: "2-digit" };
  return formatter("time" + clock, zone, options).format(date);
}
function dayText(date, zone) {
  return formatter("day", zone, { weekday: "short", day: "numeric", month: "short" }).format(date);
}
/** Whether the device's own format is 24-hour. */
function deviceUses24h() {
  return !/[AP]M/i.test(new Intl.DateTimeFormat(undefined, { hour: "numeric" }).format(new Date(2020, 0, 1, 15)));
}

/** "work" 09:00-17:59, "edge" 07:00-08:59 and 18:00-21:59, otherwise "night". */
function dayPart(date, zone) {
  const h = partsIn(date, zone).h;
  if (h >= 9 && h < 18) return "work";
  if ((h >= 7 && h < 9) || (h >= 18 && h < 22)) return "edge";
  return "night";
}
const DAY_PART_LABEL = { work: "daytime, working hours", edge: "early morning or evening", night: "night" };
// Sun = working hours, sun on the horizon = early or late, moon = night.
const DAY_PART_ICON = {
  work: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.6" fill="currentColor"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>',
  edge: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.8 16.5a5.2 5.2 0 0 1 10.4 0z" fill="currentColor"/><path d="M3 20h18M12 5v3M3.6 16.5h1.6M18.8 16.5h1.6M6 9.6l1.8 1.8M18 9.6l-1.8 1.8" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>',
  night: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.2A8.6 8.6 0 0 1 9.8 3.5a8.6 8.6 0 1 0 10.7 10.7z" fill="currentColor"/></svg>',
};

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
const CLOCK_KEY = "timezones.clock.v1";
const LOCAL = "local";
const DEFAULTS = ["Europe/Copenhagen", "Europe/London", "America/New_York", "Asia/Dubai", "Asia/Singapore"];
const STEP = 15; // slider step, minutes

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
function save(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode */ } }
function savePlaces() { save(STORE_KEY, JSON.stringify(state.places)); }
function loadClock() {
  let v = null;
  try { v = localStorage.getItem(CLOCK_KEY); } catch { /* ignore */ }
  return v === "12" || v === "24" ? v : "auto";
}

const placeId = (p) => p.name + "|" + p.zoneID;

const state = {
  places: loadPlaces(),
  live: true,           // following the real clock
  instant: Date.now(),  // the chosen moment, used when not live
  anchorKey: LOCAL,     // the row whose clock the slider and date move
  clock: loadClock(),   // "auto" | "12" | "24"
  openKey: null,       // the row currently swiped open, if any
  hintDismissed: false,
};

/** Every row on screen: the device's own zone first, then the saved places. */
function allRows() {
  const local = localZone();
  return [{ key: LOCAL, name: cityName(local), zone: local, mine: true },
    ...state.places.map((p) => ({ key: placeId(p), name: p.name, zone: p.zoneID, mine: false }))];
}
function anchorRow() { const rows = allRows(); return rows.find((r) => r.key === state.anchorKey) || rows[0]; }
function currentInstant() { return state.live ? new Date() : new Date(state.instant); }
function uses24h() { return state.clock === "24" || (state.clock === "auto" && deviceUses24h()); }

/** Choose a moment by the clock reading in one zone. */
function setWall(wall, zone) {
  state.instant = wallToInstant(wall, zone).getTime();
  state.live = false;
}

// ---------- Rendering ----------
// render() rebuilds the page when its structure changes (rows added, edit mode).
// update() only refreshes the numbers, so dragging the slider or typing a time
// never replaces the control being used.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const app = document.getElementById("app");
const $ = (sel, root = document) => root.querySelector(sel);

function isStandalone() {
  return window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}
function isIOS() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function rowHTML(r, index) {
  const i = index - 1; // index into state.places
  const isAnchor = r.key === anchorRow().key;
  const time = isAnchor
    ? `<input class="time timein" type="time" step="60" aria-label="Time in ${esc(r.name)}">`
    : `<button class="time" data-act="settime" aria-label="Set the time in ${esc(r.name)}"></button>`;
  const row = `<div class="row zone${isAnchor ? " anchor" : ""}" data-key="${esc(r.key)}" data-act="anchor">
    <span class="part" role="img"></span>
    <div class="grow"><div class="name">${esc(r.name)}</div><div class="sub"></div></div>
    <div class="right">${time}<div class="day"></div></div>
  </div>`;
  if (r.mine) return `<div class="swipe">${row}</div>`;
  // Swiping a saved place left reveals these, as in iOS lists.
  return `<div class="swipe" data-swipe data-key="${esc(r.key)}">
    <div class="actions">
      <button class="act" data-act="up" data-i="${i}" ${i === 0 ? "disabled" : ""} aria-label="Move ${esc(r.name)} up">▲</button>
      <button class="act" data-act="down" data-i="${i}" ${i === state.places.length - 1 ? "disabled" : ""} aria-label="Move ${esc(r.name)} down">▼</button>
      <button class="act danger" data-act="delete" data-i="${i}" aria-label="Remove ${esc(r.name)}">Delete</button>
    </div>${row}</div>`;
}

function render() {
  const rows = allRows();
  if (!rows.some((r) => r.key === state.anchorKey)) state.anchorKey = LOCAL;
  const h24 = uses24h();
  const ticks = h24 ? ["00", "06", "12", "18", "24"] : ["12 AM", "6 AM", "12 PM", "6 PM", "12 AM"];

  let html = `<h1>Time Zones</h1>
    <div class="card picker">
      <div class="pickhead">
        <div class="datestep">
          <button class="step" data-act="day" data-d="-1" aria-label="Previous day">‹</button>
          <button class="date" data-act="date" id="dateLabel" aria-label="Choose a date"></button>
          <button class="step" data-act="day" data-d="1" aria-label="Next day">›</button>
          <input type="date" id="dateInput" tabindex="-1" aria-hidden="true">
        </div>
        <button class="now" data-act="now" id="nowBtn"></button>
      </div>
      <input class="slider" id="slider" type="range" min="0" max="${1440 - STEP}" step="${STEP}" aria-label="Time of day">
      <div class="ticks">${ticks.map((t) => `<span>${t}</span>`).join("")}</div>
      <div class="caption" id="anchorLabel"></div>
    </div>

    <div class="card list">${rows.map((r, n) => rowHTML(r, n)).join("")}
      <button class="row link add" data-act="add"><span class="plus">+</span>Add time zone or city</button>
    </div>

    <button class="share" data-act="share">Share these times</button>
    <div class="foot">${state.places.length ? "Swipe a city left to move or remove it. " : ""}<button class="link" data-act="clock">${h24 ? "Use 12-hour time" : "Use 24-hour time"}</button></div>`;

  if (!isStandalone() && !state.hintDismissed) {
    const how = isIOS()
      ? "tap <b>Share</b> in Safari, then <b>Add to Home Screen</b>"
      : "open the browser menu and choose <b>Install</b> or <b>Add to Home screen</b>";
    html += `<div class="hint"><span class="grow">To use this like an app, ${how}.</span>
      <button data-act="hint" aria-label="Dismiss">×</button></div>`;
  }
  app.innerHTML = html;
  // Keep a swiped-open row open across a redraw (e.g. after moving it up or down).
  const open = state.openKey && app.querySelector(`.swipe[data-key="${CSS.escape(state.openKey)}"]`);
  if (open) { open.classList.add("open"); setOffset(open, -ACTIONS_W, false); } else { state.openKey = null; }
  update();
}

function update(fromSlider = false) {
  const t = currentInstant();
  const rows = allRows();
  const anchor = anchorRow();
  const local = rows[0];
  const anchorParts = partsIn(t, anchor.zone);

  $("#anchorLabel").textContent = `Slider sets the time in ${anchor.name}`;
  $("#dateLabel").textContent = dayText(t, anchor.zone);
  $("#dateInput").value = instantToWall(t, anchor.zone).slice(0, 10);
  const now = $("#nowBtn");
  now.textContent = state.live ? "● Live" : "Now";
  now.classList.toggle("live", state.live);
  now.setAttribute("aria-label", state.live ? "Showing the current time" : "Back to the current time");
  const slider = $("#slider");
  if (!fromSlider) slider.value = anchorParts.h * 60 + anchorParts.mi;
  slider.setAttribute("aria-valuetext", `${timeText(t, anchor.zone, state.clock)} in ${anchor.name}`);

  for (const r of rows) {
    const el = app.querySelector(`.zone[data-key="${CSS.escape(r.key)}"]`);
    if (!el) continue;
    const gmt = gmtLabel(t, r.zone);
    $(".sub", el).textContent = r.mine ? `${gmt} · your time zone` : `${gmt} · ${differenceLabel(t, r.zone, local.zone, "you")}`;
    const time = $(".time", el);
    if (time.tagName === "INPUT") {
      if (document.activeElement !== time) time.value = instantToWall(t, r.zone).slice(11);
    } else {
      time.textContent = timeText(t, r.zone, state.clock);
    }
    const n = dayOffset(t, r.zone, anchor.zone);
    const day = $(".day", el);
    day.textContent = dayText(t, r.zone) + (n === 0 ? "" : ` ${n > 0 ? "+" : "−"}${Math.abs(n)}d`);
    day.title = n === 0 ? "" : `${Math.abs(n)} day${Math.abs(n) === 1 ? "" : "s"} ${n > 0 ? "after" : "before"} ${anchor.name}`;
    day.classList.toggle("shift", n !== 0);
    const part = dayPart(t, r.zone);
    const dot = $(".part", el);
    if (dot.dataset.part !== part) { dot.dataset.part = part; dot.innerHTML = DAY_PART_ICON[part]; }
    dot.className = "part " + part;
    dot.setAttribute("aria-label", DAY_PART_LABEL[part]);
    dot.title = DAY_PART_LABEL[part];
  }
}

// ---------- Actions ----------

function openPicker(input) {
  if (!input) return;
  input.focus();
  try { if (input.showPicker) input.showPicker(); } catch { /* not allowed here; focus is enough */ }
}

function setAnchor(key) {
  if (state.anchorKey === key) return false;
  state.anchorKey = key;
  render();
  return true;
}

function shiftDay(delta) {
  const zone = anchorRow().zone;
  const wall = instantToWall(currentInstant(), zone);
  const [Y, M, D] = wall.slice(0, 10).split("-").map(Number);
  const d = new Date(Date.UTC(Y, M - 1, D + delta));
  setWall(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${wall.slice(11)}`, zone);
  update();
}

function shareText() {
  const t = currentInstant();
  const rows = allRows();
  const anchor = anchorRow();
  const ordered = [anchor, ...rows.filter((r) => r.key !== anchor.key)];
  const lines = ordered.map((r) => {
    const other = dayOffset(t, r.zone, anchor.zone) !== 0 ? ` (${dayText(t, r.zone)})` : "";
    return `${timeText(t, r.zone, state.clock)} ${r.name}${other}`;
  });
  return `${dayText(t, anchor.zone)}\n${lines.join("\n")}`;
}

let toastTimer;
function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

async function share() {
  const text = shareText();
  if (navigator.share && (isIOS() || /Android/.test(navigator.userAgent))) {
    try { await navigator.share({ text }); } catch { /* cancelled */ }
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied to clipboard");
  } catch {
    window.prompt("Copy these times:", text.replace(/\n/g, " · "));
  }
}

// ---------- Swipe to move or remove ----------

const ACTIONS_W = 176;
let swipe = null, suppressClick = false;

function setOffset(el, x, animate) {
  const row = $(".zone", el);
  row.style.transition = animate ? "transform .2s ease" : "none";
  row.style.transform = x ? `translateX(${x}px)` : "";
}
function closeSwipes(except = null) {
  app.querySelectorAll(".swipe.open").forEach((el) => {
    if (el !== except) { el.classList.remove("open"); setOffset(el, 0, true); }
  });
  if (!except) state.openKey = null;
}

app.addEventListener("pointerdown", (e) => {
  suppressClick = false; // a new touch always starts clean
  if (e.target.closest(".actions")) return;
  const el = e.target.closest(".swipe[data-swipe]");
  closeSwipes(el && el.classList.contains("open") ? el : null);
  if (!el || e.target.closest("input")) return;
  const open = el.classList.contains("open");
  swipe = { el, id: e.pointerId, x: e.clientX, y: e.clientY, start: open ? -ACTIONS_W : 0, last: open ? -ACTIONS_W : 0, active: false };
});
app.addEventListener("pointermove", (e) => {
  if (!swipe || e.pointerId !== swipe.id) return;
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
  if (!swipe.active) {
    if (Math.abs(dx) < 10) return;
    if (Math.abs(dy) > Math.abs(dx)) { swipe = null; return; } // a vertical scroll, not a swipe
    swipe.active = true;
    swipe.el.classList.add("dragging");
    try { swipe.el.setPointerCapture(e.pointerId); } catch { /* fine without capture */ }
  }
  swipe.last = Math.max(-ACTIONS_W - 24, Math.min(0, swipe.start + dx));
  setOffset(swipe.el, swipe.last, false);
});
function endSwipe(e) {
  if (!swipe || (e.pointerId !== undefined && e.pointerId !== swipe.id)) return;
  const s = swipe;
  swipe = null;
  if (!s.active) return;
  s.el.classList.remove("dragging");
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 350);
  const open = s.start === 0 ? s.last < -50 : s.last < -ACTIONS_W + 50;
  s.el.classList.toggle("open", open);
  setOffset(s.el, open ? -ACTIONS_W : 0, true);
  state.openKey = open ? s.el.dataset.key : null;
}
app.addEventListener("pointerup", endSwipe);
app.addEventListener("pointercancel", endSwipe);

app.addEventListener("click", (e) => {
  if (suppressClick) { e.preventDefault(); return; }
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const i = Number(el.dataset.i);
  // Tapping a swiped-open row just closes it.
  if (!e.target.closest(".actions") && e.target.closest(".swipe.open")) { closeSwipes(); return; }
  switch (el.dataset.act) {
    case "anchor":
      if (e.target.closest("input")) return;
      setAnchor(el.dataset.key);
      return;
    case "settime": {
      const key = el.closest(".zone").dataset.key;
      setAnchor(key);
      openPicker(app.querySelector(".zone.anchor .timein"));
      return;
    }
    case "now": state.live = true; update(); return;
    case "day": shiftDay(Number(el.dataset.d)); return;
    case "date": openPicker($("#dateInput")); return;
    case "share": share(); return;
    case "clock":
      state.clock = uses24h() ? "12" : "24";
      save(CLOCK_KEY, state.clock);
      break;
    case "delete":
      if (placeId(state.places[i]) === state.anchorKey) state.anchorKey = LOCAL;
      state.places.splice(i, 1); savePlaces();
      state.openKey = null;
      break;
    case "up": if (i > 0) { state.places.splice(i - 1, 0, state.places.splice(i, 1)[0]); savePlaces(); } break;
    case "down": if (i < state.places.length - 1) { state.places.splice(i + 1, 0, state.places.splice(i, 1)[0]); savePlaces(); } break;
    case "add": openSheet(); return;
    case "hint": state.hintDismissed = true; break;
  }
  render();
});

app.addEventListener("input", (e) => {
  const zone = anchorRow().zone;
  if (e.target.id === "slider") {
    const m = Number(e.target.value);
    const date = instantToWall(currentInstant(), zone).slice(0, 10);
    setWall(`${date}T${pad(Math.floor(m / 60))}:${pad(m % 60)}`, zone);
    update(true);
  } else if (e.target.classList.contains("timein")) {
    if (!e.target.value) return;
    const date = instantToWall(currentInstant(), zone).slice(0, 10);
    setWall(`${date}T${e.target.value.slice(0, 5)}`, zone);
    update();
  } else if (e.target.id === "dateInput") {
    if (!e.target.value) return;
    setWall(`${e.target.value}T${instantToWall(currentInstant(), zone).slice(11)}`, zone);
    update();
  }
});
// Once the time field is left, show the settled value (e.g. after a skipped DST hour).
app.addEventListener("focusout", (e) => { if (e.target.classList.contains("timein")) setTimeout(update, 0); });

// ---------- Add sheet ----------

const results = document.getElementById("results"), q = document.getElementById("q");

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
  if (state.live && !document.body.classList.contains("sheet-open")) update();
}, 1000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) update(); });

render();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
