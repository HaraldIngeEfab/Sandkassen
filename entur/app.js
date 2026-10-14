// Nærmeste stoppested – statisk webapp mot Enturs åpne API-er.
// Geocoder (stedssøk):      https://api.entur.io/geocoder/v1/autocomplete
// Journey Planner v3 (GraphQL): https://api.entur.io/journey-planner/v3/graphql
// Entur krever at klienten identifiserer seg med headeren ET-Client-Name.

const CLIENT_NAME = "haraldingeefab-sandkassen-naermeste-stopp";
const GEOCODER_URL = "https://api.entur.io/geocoder/v1/autocomplete";
const JOURNEY_PLANNER_URL = "https://api.entur.io/journey-planner/v3/graphql";

const MAX_DISTANCE_M = 2000;   // søkeradius for nærmeste stoppested
const MAX_STOPS = 6;           // antall stoppesteder vi henter i nærheten
const NUM_DEPARTURES = 12;     // avganger å vise
const TIME_RANGE_S = 3 * 3600; // hvor langt fram i tid vi ser etter avganger
const REFRESH_MS = 30_000;

const MODE_LABEL = {
  bus: "Buss", coach: "Ekspressbuss", tram: "Trikk", metro: "T-bane", rail: "Tog",
  water: "Båt", air: "Fly", lift: "Taubane", cableway: "Taubane", funicular: "Kabelbane",
  trolleybus: "Trolleybuss", monorail: "Monorail", taxi: "Taxi", unknown: "Annet",
};
const MODE_ICON = {
  bus: "🚌", coach: "🚍", tram: "🚋", metro: "🚇", rail: "🚆", water: "⛴️", air: "✈️",
  lift: "🚡", cableway: "🚡", funicular: "🚞", trolleybus: "🚎", monorail: "🚝", taxi: "🚕",
};
const LAYER_LABEL = {
  venue: "Stoppested", address: "Adresse", street: "Gate", locality: "Sted",
  borough: "Bydel", county: "Fylke", region: "Region", neighbourhood: "Nabolag", localadmin: "Kommune",
};

const $ = (id) => document.getElementById(id);
const el = {
  form: $("searchForm"), input: $("searchInput"), suggestions: $("suggestions"), geoBtn: $("geoBtn"),
  status: $("status"), result: $("result"), placeName: $("placeName"), placeMeta: $("placeMeta"),
  stopName: $("stopName"), stopModes: $("stopModes"), stopDistance: $("stopDistance"), stopFacts: $("stopFacts"),
  situations: $("situations"), departures: $("departures"), noDepartures: $("noDepartures"), updatedAt: $("updatedAt"),
  autoRefresh: $("autoRefresh"), refreshBtn: $("refreshBtn"), enturLink: $("enturLink"), mapLink: $("mapLink"),
  nearbyList: $("nearbyList"),
};

const state = {
  place: null,       // { name, detail, lat, lon }
  nearby: [],        // [{ id, name, distance, transportMode }]
  current: null,     // valgt stoppested { id, distance }
  refreshTimer: null,
  suggestions: [],
  activeSuggestion: -1,
  abort: null,
};

// ---------- Hjelpere ----------

function setStatus(text, isError = false) {
  el.status.textContent = text || "";
  el.status.classList.toggle("error", Boolean(isError));
}

function fmtDistance(m) {
  if (m == null) return "";
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1).replace(".", ",")} km`;
}

function fmtClock(iso) {
  return new Date(iso).toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" });
}

function modeLabel(mode) { return MODE_LABEL[mode] || mode || "Annet"; }
function modeIcon(mode) { return MODE_ICON[mode] || "🚏"; }

function normaliseColour(c) {
  if (!c) return null;
  return c.startsWith("#") ? c : `#${c}`;
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

function make(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v != null) n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c != null) n.append(c);
  return n;
}

// ---------- Entur-kall ----------

async function geocode(text, signal) {
  const url = new URL(GEOCODER_URL);
  url.searchParams.set("text", text);
  url.searchParams.set("lang", "no");
  url.searchParams.set("size", "8");
  const res = await fetch(url, { headers: { "ET-Client-Name": CLIENT_NAME }, signal });
  if (!res.ok) throw new Error(`Geocoder svarte ${res.status}`);
  const data = await res.json();
  return (data.features || []).map((f) => {
    const p = f.properties || {};
    const [lon, lat] = f.geometry.coordinates;
    const parts = [p.locality, p.county].filter((x) => x && x !== p.name);
    return {
      id: p.id, name: p.name || p.label, detail: parts.join(", "), layer: p.layer,
      categories: p.category || [], lat, lon,
    };
  });
}

async function graphql(query, variables) {
  const res = await fetch(JOURNEY_PLANNER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "ET-Client-Name": CLIENT_NAME },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Journey Planner svarte ${res.status}`);
  const json = await res.json();
  if (json.errors && json.errors.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  return json.data;
}

const NEAREST_QUERY = `
query Nearest($lat: Float!, $lon: Float!) {
  nearest(
    latitude: $lat, longitude: $lon,
    maximumDistance: ${MAX_DISTANCE_M}, maximumResults: ${MAX_STOPS},
    filterByPlaceTypes: [stopPlace], filterByInUse: true
  ) {
    edges {
      node {
        distance
        place {
          ... on StopPlace { id name transportMode }
        }
      }
    }
  }
}`;

const STOP_QUERY = `
query Stop($id: String!) {
  stopPlace(id: $id) {
    id name description latitude longitude transportMode
    quays { id publicCode lines { id publicCode transportMode } }
    situations { summary { value language } description { value language } }
    estimatedCalls(numberOfDepartures: ${NUM_DEPARTURES}, timeRange: ${TIME_RANGE_S}) {
      realtime aimedDepartureTime expectedDepartureTime cancellation
      destinationDisplay { frontText via }
      quay { id publicCode }
      serviceJourney {
        id
        line { id publicCode name transportMode presentation { colour textColour } authority { name } }
      }
      situations { summary { value language } }
    }
  }
}`;

async function fetchNearestStops(lat, lon) {
  const data = await graphql(NEAREST_QUERY, { lat, lon });
  return (data.nearest?.edges || [])
    .map((e) => e.node)
    .filter((n) => n.place && n.place.id)
    .map((n) => ({ id: n.place.id, name: n.place.name, transportMode: n.place.transportMode || [], distance: n.distance }));
}

async function fetchStop(id) {
  const data = await graphql(STOP_QUERY, { id });
  if (!data.stopPlace) throw new Error("Fant ikke stoppestedet");
  return data.stopPlace;
}

// ---------- Søk og forslag ----------

function hideSuggestions() {
  el.suggestions.hidden = true;
  el.input.setAttribute("aria-expanded", "false");
  state.activeSuggestion = -1;
}

function renderSuggestions(list) {
  clear(el.suggestions);
  state.suggestions = list;
  state.activeSuggestion = -1;
  if (!list.length) return hideSuggestions();
  list.forEach((s, i) => {
    const kind = s.layer === "venue" && s.categories.length
      ? s.categories.map(categoryLabel).filter((v, j, a) => a.indexOf(v) === j).join(" · ")
      : LAYER_LABEL[s.layer] || "";
    const li = make("li", { role: "option", id: `sugg-${i}`, "aria-selected": "false", onmousedown: (ev) => { ev.preventDefault(); choosePlace(s); } }, [
      make("span", { class: "sname", text: s.name }),
      s.detail ? make("span", { class: "sdetail", text: s.detail }) : null,
      kind ? make("span", { class: "skind", text: kind }) : null,
    ]);
    el.suggestions.append(li);
  });
  el.suggestions.hidden = false;
  el.input.setAttribute("aria-expanded", "true");
}

function categoryLabel(cat) {
  const c = String(cat).toLowerCase();
  if (c.includes("bus") || c.includes("coach")) return "Buss";
  if (c.includes("tram")) return "Trikk";
  if (c.includes("metro")) return "T-bane";
  if (c.includes("rail")) return "Tog";
  if (c.includes("ferry") || c.includes("harbour") || c.includes("water")) return "Båt";
  if (c.includes("air")) return "Fly";
  return "Stoppested";
}

function setActiveSuggestion(idx) {
  const items = el.suggestions.children;
  if (!items.length) return;
  state.activeSuggestion = (idx + items.length) % items.length;
  for (let i = 0; i < items.length; i++) items[i].setAttribute("aria-selected", String(i === state.activeSuggestion));
  items[state.activeSuggestion].scrollIntoView({ block: "nearest" });
}

const onInput = debounce(async () => {
  const text = el.input.value.trim();
  if (state.abort) state.abort.abort();
  if (text.length < 2) return hideSuggestions();
  const controller = new AbortController();
  state.abort = controller;
  try {
    const list = await geocode(text, controller.signal);
    if (!controller.signal.aborted) renderSuggestions(list);
  } catch (err) {
    if (err.name !== "AbortError") setStatus(`Stedssøket feilet: ${err.message}`, true);
  }
}, 220);

el.input.addEventListener("input", onInput);
el.input.addEventListener("keydown", (ev) => {
  if (el.suggestions.hidden) return;
  if (ev.key === "ArrowDown") { ev.preventDefault(); setActiveSuggestion(state.activeSuggestion + 1); }
  else if (ev.key === "ArrowUp") { ev.preventDefault(); setActiveSuggestion(state.activeSuggestion - 1); }
  else if (ev.key === "Escape") hideSuggestions();
  else if (ev.key === "Enter" && state.activeSuggestion >= 0) { ev.preventDefault(); choosePlace(state.suggestions[state.activeSuggestion]); }
});
document.addEventListener("click", (ev) => { if (!el.form.contains(ev.target)) hideSuggestions(); });

el.form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const text = el.input.value.trim();
  if (!text) return;
  if (state.activeSuggestion >= 0 && state.suggestions[state.activeSuggestion]) return choosePlace(state.suggestions[state.activeSuggestion]);
  if (state.suggestions.length && !el.suggestions.hidden) return choosePlace(state.suggestions[0]);
  setStatus("Søker …");
  try {
    const list = await geocode(text);
    if (!list.length) return setStatus(`Fant ingen steder som passer «${text}».`, true);
    choosePlace(list[0]);
  } catch (err) {
    setStatus(`Stedssøket feilet: ${err.message}`, true);
  }
});

el.geoBtn.addEventListener("click", () => {
  if (!navigator.geolocation) return setStatus("Nettleseren støtter ikke posisjon.", true);
  setStatus("Henter posisjon …");
  el.geoBtn.disabled = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      el.geoBtn.disabled = false;
      choosePlace({ name: "Min posisjon", detail: `±${Math.round(pos.coords.accuracy)} m`, lat: pos.coords.latitude, lon: pos.coords.longitude });
    },
    (err) => {
      el.geoBtn.disabled = false;
      setStatus(`Fikk ikke posisjon: ${err.message}`, true);
    },
    { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
  );
});

// ---------- Velg sted → finn stoppesteder ----------

async function choosePlace(place, { updateHash = true } = {}) {
  hideSuggestions();
  state.place = place;
  el.input.value = place.name;
  el.placeName.textContent = place.name;
  el.placeMeta.textContent = place.detail ? ` – ${place.detail}` : "";
  if (updateHash) {
    const h = new URLSearchParams({ lat: place.lat.toFixed(5), lon: place.lon.toFixed(5), name: place.name });
    if (place.detail) h.set("detail", place.detail);
    history.replaceState(null, "", `#${h}`);
  }
  setStatus("Finner nærmeste stoppested …");
  stopAutoRefresh();
  try {
    const stops = await fetchNearestStops(place.lat, place.lon);
    if (!stops.length) {
      el.result.hidden = true;
      return setStatus(`Fant ingen stoppesteder med avganger innen ${fmtDistance(MAX_DISTANCE_M)} fra ${place.name}.`, true);
    }
    state.nearby = stops;
    el.result.hidden = false;
    renderNearby();
    await showStop(stops[0]);
    setStatus("");
  } catch (err) {
    setStatus(`Klarte ikke å hente stoppesteder: ${err.message}`, true);
  }
}

function renderNearby() {
  clear(el.nearbyList);
  const others = state.nearby.filter((s) => s.id !== state.current?.id);
  if (!others.length) {
    el.nearbyList.append(make("li", { class: "muted", text: "Ingen andre stoppesteder innen søkeradiusen." }));
    return;
  }
  for (const s of others) {
    const modes = s.transportMode.map((m) => `${modeIcon(m)} ${modeLabel(m)}`).join(" · ");
    el.nearbyList.append(make("li", {}, make("button", { type: "button", onclick: () => showStop(s) }, [
      make("span", {}, [make("span", { class: "nn", text: s.name }), make("span", { class: "nm", text: modes || "Stoppested" })]),
      make("span", { class: "nd", text: fmtDistance(s.distance) }),
    ])));
  }
}

// ---------- Vis stoppested ----------

async function showStop(stopRef) {
  state.current = stopRef;
  renderNearby();
  el.stopName.textContent = stopRef.name;
  el.stopDistance.textContent = fmtDistance(stopRef.distance);
  el.updatedAt.textContent = "Henter avganger …";
  try {
    const stop = await fetchStop(stopRef.id);
    if (state.current?.id !== stopRef.id) return; // bruker har valgt et annet stopp i mellomtiden
    renderStop(stop, stopRef.distance);
    startAutoRefresh();
  } catch (err) {
    el.updatedAt.textContent = `Klarte ikke å hente avganger: ${err.message}`;
  }
}

function renderStop(stop, distance) {
  el.stopName.textContent = stop.name;
  el.stopDistance.textContent = fmtDistance(distance);

  // Transportmidler
  clear(el.stopModes);
  const modes = new Set(stop.transportMode || []);
  for (const q of stop.quays || []) for (const l of q.lines || []) if (l.transportMode) modes.add(l.transportMode);
  for (const m of modes) el.stopModes.append(make("span", { class: "mode", text: `${modeIcon(m)} ${modeLabel(m)}` }));

  // Nøkkeldata
  const lines = new Map();
  for (const q of stop.quays || []) for (const l of q.lines || []) if (l.publicCode) lines.set(l.id, l);
  for (const c of stop.estimatedCalls || []) {
    const l = c.serviceJourney?.line;
    if (l?.publicCode) lines.set(l.id, l);
  }
  const sortedLines = [...lines.values()].sort((a, b) => a.publicCode.localeCompare(b.publicCode, "nb", { numeric: true }));
  const quays = (stop.quays || []).map((q) => q.publicCode).filter(Boolean).sort((a, b) => a.localeCompare(b, "nb", { numeric: true }));
  const next = (stop.estimatedCalls || []).find((c) => !c.cancellation);
  const authorities = new Set();
  for (const c of stop.estimatedCalls || []) if (c.serviceJourney?.line?.authority?.name) authorities.add(c.serviceJourney.line.authority.name);

  clear(el.stopFacts);
  const fact = (label, value) => el.stopFacts.append(make("div", {}, [make("dt", { text: label }), make("dd", {}, value)]));
  fact("Avstand", fmtDistance(distance));
  fact("Neste avgang", next ? relativeTime(next.expectedDepartureTime) : "–");
  fact("Linjer", sortedLines.length
    ? make("span", { class: "lines" }, sortedLines.map((l) => lineBadge(l, true)))
    : "–");
  fact("Plattformer", quays.length ? `${quays.length} (${quays.join(", ")})` : String((stop.quays || []).length || "–"));
  if (authorities.size) fact("Operatør", [...authorities].join(", "));
  fact("NSR-ID", stop.id);
  if (stop.description) fact("Beskrivelse", stop.description);

  // Avvik
  clear(el.situations);
  const seen = new Set();
  const situations = [...(stop.situations || [])];
  for (const c of stop.estimatedCalls || []) for (const s of c.situations || []) situations.push(s);
  for (const s of situations) {
    const summary = pickLang(s.summary);
    const description = pickLang(s.description);
    const key = summary || description;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    el.situations.append(make("div", { class: "situation" }, [
      make("strong", { text: `⚠️ ${summary || "Avvik"}` }),
      description && description !== summary ? make("span", { text: description }) : null,
    ]));
  }
  el.situations.hidden = seen.size === 0;

  // Avganger
  clear(el.departures);
  const calls = stop.estimatedCalls || [];
  el.noDepartures.hidden = calls.length > 0;
  for (const c of calls) {
    const line = c.serviceJourney?.line || {};
    const dest = c.destinationDisplay?.frontText || line.name || "";
    const via = (c.destinationDisplay?.via || []).filter(Boolean).join(", ");
    const tr = make("tr", { class: c.cancellation ? "cancelled" : "" }, [
      make("td", {}, lineBadge(line)),
      make("td", { class: "dest" }, [dest, via ? make("span", { class: "via", text: `via ${via}` }) : null]),
      make("td", { text: c.quay?.publicCode || "" }),
      make("td", { class: "num" }, departureCell(c)),
    ]);
    el.departures.append(tr);
  }

  el.updatedAt.textContent = `Oppdatert ${new Date().toLocaleTimeString("nb-NO")}`;
  el.enturLink.href = `https://entur.no/nearby-stop-place-detail?id=${encodeURIComponent(stop.id)}`;
  if (stop.latitude != null && stop.longitude != null) {
    el.mapLink.href = `https://www.openstreetmap.org/?mlat=${stop.latitude}&mlon=${stop.longitude}#map=17/${stop.latitude}/${stop.longitude}`;
    el.mapLink.hidden = false;
  } else {
    el.mapLink.hidden = true;
  }
}

function lineBadge(line, small = false) {
  const bg = normaliseColour(line.presentation?.colour);
  const fg = normaliseColour(line.presentation?.textColour);
  const badge = make("span", { class: `line-badge${small ? " small" : ""}`, text: line.publicCode || "–", title: line.name || "" });
  if (bg) badge.style.background = bg;
  if (fg) badge.style.color = fg;
  return badge;
}

function relativeTime(iso) {
  const diffMin = Math.round((new Date(iso) - Date.now()) / 60000);
  if (diffMin <= 0) return "nå";
  if (diffMin <= 15) return `${diffMin} min`;
  return fmtClock(iso);
}

function departureCell(c) {
  if (c.cancellation) return make("span", { class: "time", text: "Innstilt" });
  const expected = c.expectedDepartureTime || c.aimedDepartureTime;
  const delayMin = c.aimedDepartureTime && c.expectedDepartureTime
    ? Math.round((new Date(c.expectedDepartureTime) - new Date(c.aimedDepartureTime)) / 60000) : 0;
  const children = [relativeTime(expected)];
  if (c.realtime) children.push(make("span", { class: "rt", title: "Sanntid", text: "●" }));
  if (Math.abs(delayMin) >= 1) {
    children.push(make("span", { class: "delay", text: `${delayMin > 0 ? "+" : ""}${delayMin} min` }));
    children.push(make("span", { class: "aimed", text: `Rutetid ${fmtClock(c.aimedDepartureTime)}` }));
  } else if (relativeTime(expected) !== fmtClock(expected)) {
    children.push(make("span", { class: "aimed", style: "text-decoration:none", text: fmtClock(expected) }));
  }
  return make("span", { class: "time" }, children);
}

function pickLang(values) {
  if (!Array.isArray(values) || !values.length) return "";
  const pref = ["no", "nb", "nn", "en"];
  for (const lang of pref) {
    const hit = values.find((v) => v.language === lang && v.value);
    if (hit) return hit.value;
  }
  return values.find((v) => v.value)?.value || "";
}

// ---------- Automatisk oppdatering ----------

function startAutoRefresh() {
  stopAutoRefresh();
  if (!el.autoRefresh.checked) return;
  state.refreshTimer = setInterval(refreshCurrent, REFRESH_MS);
}
function stopAutoRefresh() {
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  state.refreshTimer = null;
}
async function refreshCurrent() {
  if (!state.current || document.hidden) return;
  try {
    const stop = await fetchStop(state.current.id);
    if (state.current?.id === stop.id) renderStop(stop, state.current.distance);
  } catch (err) {
    el.updatedAt.textContent = `Oppdatering feilet: ${err.message}`;
  }
}
el.refreshBtn.addEventListener("click", refreshCurrent);
el.autoRefresh.addEventListener("change", startAutoRefresh);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshCurrent(); });

// ---------- Start fra URL ----------

(function init() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ""));
  const lat = Number(h.get("lat"));
  const lon = Number(h.get("lon"));
  if (Number.isFinite(lat) && Number.isFinite(lon) && h.get("lat") !== null) {
    choosePlace({ name: h.get("name") || "Valgt sted", detail: h.get("detail") || "", lat, lon }, { updateHash: false });
  } else {
    el.input.focus();
  }
})();
