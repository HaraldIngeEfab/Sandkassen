/* Norgeskart med vær
 * - Bakgrunnskart: Kartverkets cache-tjeneste (Geonorge)
 * - Stedsnavn, kommune og høyde: ws.geonorge.no
 * - Vær: MET Norge / Yr, Locationforecast 2.0 (api.met.no)
 */
(function () {
  "use strict";

  // ---------- Konfigurasjon ----------
  const GEONORGE = "https://ws.geonorge.no";
  const MET_DIRECT = "https://api.met.no/weatherapi/locationforecast/2.0/compact";
  const MET_PROXY = "/api/met"; // valgfri lokal proxy, se server.js
  const ICON_SOURCES = [
    (code) => `https://api.met.no/images/weathericons/svg/${code}.svg`,
    (code) => `https://raw.githubusercontent.com/metno/weathericons/main/weather/svg/${code}.svg`,
  ];
  const FORECAST_TTL_MS = 30 * 60 * 1000; // MET ber om at svar caches
  const NORWAY_CENTER = [64.5, 12.0];

  // Faste punkter som vises som værmarkører på kartet
  const CITIES = [
    { name: "Oslo", lat: 59.9139, lon: 10.7522, alt: 23 },
    { name: "Bergen", lat: 60.3913, lon: 5.3221, alt: 12 },
    { name: "Trondheim", lat: 63.4305, lon: 10.3951, alt: 10 },
    { name: "Stavanger", lat: 58.9700, lon: 5.7331, alt: 10 },
    { name: "Kristiansand", lat: 58.1467, lon: 7.9956, alt: 10 },
    { name: "Tromsø", lat: 69.6496, lon: 18.9560, alt: 10 },
    { name: "Bodø", lat: 67.2804, lon: 14.4049, alt: 10 },
    { name: "Ålesund", lat: 62.4722, lon: 6.1495, alt: 10 },
    { name: "Lillehammer", lat: 61.1153, lon: 10.4662, alt: 180 },
    { name: "Hammerfest", lat: 70.6634, lon: 23.6821, alt: 10 },
    { name: "Kirkenes", lat: 69.7271, lon: 30.0450, alt: 10 },
    { name: "Røros", lat: 62.5747, lon: 11.3843, alt: 628 },
    { name: "Longyearbyen", lat: 78.2232, lon: 15.6267, alt: 20 },
  ];

  // ---------- Kart ----------
  const map = L.map("map", { zoomControl: true }).setView(NORWAY_CENTER, 5);

  // Bakgrunnskart: Kartverket (via Geonorge), Esri World Imagery, Sentinel-2 cloudless og hybrid
  const KARTVERKET_ATTR = '&copy; <a href="https://www.kartverket.no">Kartverket</a>';
  const ESRI_ATTR = 'Satellitt: Esri, Maxar, Earthstar Geographics, GIS User Community';
  const S2_ATTR = '<a href="https://s2maps.eu">Sentinel-2 cloudless</a> by <a href="https://eox.at">EOX</a> (CC BY-NC-SA 4.0), Copernicus Sentinel data';
  const TILESETS = {
    kartverket: (name) => ({
      url: `https://cache.kartverket.no/v1/wmts/1.0.0/${name}/default/webmercator/{z}/{y}/{x}.png`,
      maxZoom: 18, attribution: KARTVERKET_ATTR,
    }),
    esri: {
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      maxZoom: 19, attribution: ESRI_ATTR,
    },
    s2: {
      url: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/g/{z}/{y}/{x}.jpg",
      maxZoom: 18, maxNativeZoom: 16, attribution: S2_ATTR,
    },
  };
  // Hvert bakgrunnsvalg er en liste av fliselag (nederst først), med valgfri gjennomsiktighet
  const BASEMAPS = {
    topo: () => [{ ...TILESETS.kartverket("topo") }],
    topograatone: () => [{ ...TILESETS.kartverket("topograatone") }],
    toporaster: () => [{ ...TILESETS.kartverket("toporaster") }],
    esri: () => [{ ...TILESETS.esri }],
    s2: () => [{ ...TILESETS.s2 }],
    hybrid: () => [{ ...TILESETS.esri }, { ...TILESETS.kartverket("topograatone"), opacity: 0.55 }],
  };
  function basemapLayers(key) { return (BASEMAPS[key] || BASEMAPS.topo)(); }

  function createBasemap(key) {
    return L.layerGroup(basemapLayers(key).map((t) => L.tileLayer(t.url, {
      maxZoom: 18, maxNativeZoom: t.maxNativeZoom ?? Math.min(t.maxZoom, 18), opacity: t.opacity ?? 1, attribution: t.attribution,
    })));
  }
  const basemapSelect = document.getElementById("basemap");
  let baseLayer = createBasemap(basemapSelect.value).addTo(map);
  basemapSelect.addEventListener("change", (e) => {
    map.removeLayer(baseLayer);
    baseLayer = createBasemap(e.target.value).addTo(map);
    map.getContainer().classList.toggle("satellite", /^(esri|s2|hybrid)$/.test(e.target.value));
  });

  const weatherLayer = L.layerGroup().addTo(map);
  const searchLayer = L.layerGroup().addTo(map);

  // ---------- Hjelpere ----------
  const statusEl = document.getElementById("status");
  let statusTimer = null;
  function setStatus(text, isError) {
    clearTimeout(statusTimer);
    if (!text) { statusEl.hidden = true; return; }
    statusEl.textContent = text;
    statusEl.classList.toggle("error", !!isError);
    statusEl.hidden = false;
    if (isError) statusTimer = setTimeout(() => (statusEl.hidden = true), 6000);
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  async function getJson(url, init) {
    const res = await fetch(url, init);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} (${url})`);
    return res.json();
  }

  function round4(n) { return Math.round(n * 1e4) / 1e4; } // MET: maks 4 desimaler

  const COMPASS = ["N", "NNØ", "NØ", "ØNØ", "Ø", "ØSØ", "SØ", "SSØ", "S", "SSV", "SV", "VSV", "V", "VNV", "NV", "NNV"];
  function compass(deg) {
    if (deg == null || isNaN(deg)) return "";
    return COMPASS[Math.round(deg / 22.5) % 16];
  }

  const EMOJI = {
    clearsky: "☀️", fair: "🌤️", partlycloudy: "⛅", cloudy: "☁️", fog: "🌫️",
    lightrain: "🌦️", rain: "🌧️", heavyrain: "🌧️", lightrainshowers: "🌦️", rainshowers: "🌦️", heavyrainshowers: "🌧️",
    lightsnow: "🌨️", snow: "🌨️", heavysnow: "❄️", lightsnowshowers: "🌨️", snowshowers: "🌨️", heavysnowshowers: "❄️",
    sleet: "🌨️", lightsleet: "🌨️", heavysleet: "🌨️", sleetshowers: "🌨️", lightsleetshowers: "🌨️", heavysleetshowers: "🌨️",
    rainandthunder: "⛈️", heavyrainandthunder: "⛈️", lightrainandthunder: "⛈️", rainshowersandthunder: "⛈️",
    heavyrainshowersandthunder: "⛈️", lightrainshowersandthunder: "⛈️", snowandthunder: "⛈️", sleetandthunder: "⛈️",
    snowshowersandthunder: "⛈️", sleetshowersandthunder: "⛈️", lightsnowandthunder: "⛈️", heavysnowandthunder: "⛈️",
    lightssnowshowersandthunder: "⛈️", heavysnowshowersandthunder: "⛈️", lightsleetandthunder: "⛈️", heavysleetandthunder: "⛈️",
    lightssleetshowersandthunder: "⛈️", heavysleetshowersandthunder: "⛈️",
  };
  function emojiFor(code) {
    const base = String(code || "").replace(/_(day|night|polartwilight)$/, "");
    return EMOJI[base] || "🌡️";
  }

  // Bilde med fallback-kjede: MET-ikon -> GitHub-ikon -> emoji
  function iconHtml(code, cls) {
    if (!code) return `<span class="emoji ${cls || ""}" data-code="">🌡️</span>`;
    const first = ICON_SOURCES[0](code);
    return `<img class="${cls || ""}" src="${esc(first)}" alt="${esc(code)}" data-code="${esc(code)}" data-step="0" onerror="window.__wxIconError(this)">`;
  }
  window.__wxIconError = function (img) {
    const step = Number(img.dataset.step || 0) + 1;
    const code = img.dataset.code;
    if (step < ICON_SOURCES.length) {
      img.dataset.step = String(step);
      img.src = ICON_SOURCES[step](code);
    } else {
      const span = document.createElement("span");
      span.className = "emoji " + img.className;
      span.dataset.code = code;
      span.textContent = emojiFor(code);
      img.replaceWith(span);
    }
  };

  // ---------- Geonorge-tjenester ----------
  async function searchPlaceNames(q) {
    const url = `${GEONORGE}/stedsnavn/v1/navn?sok=${encodeURIComponent(q)}&fuzzy=true&utkoordsys=4258&treffPerSide=15&side=1`;
    const data = await getJson(url);
    const list = data.navn || [];
    return list
      .map((n) => {
        const p = n.representasjonspunkt || {};
        const lat = p.nord ?? p.lat;
        const lon = p["øst"] ?? p.ost ?? p.lon;
        return {
          name: n["skrivemåte"] || n.skrivemate || n.stedsnavn || "(uten navn)",
          type: n.navneobjekttype || "",
          kommune: (n.kommuner || []).map((k) => k.kommunenavn).join(", "),
          fylke: (n.fylker || []).map((f) => f.fylkesnavn).join(", "),
          lat: Number(lat), lon: Number(lon),
        };
      })
      .filter((r) => isFinite(r.lat) && isFinite(r.lon));
  }

  async function kommuneAt(lat, lon) {
    try {
      const d = await getJson(`${GEONORGE}/kommuneinfo/v1/punkt?nord=${lat}&ost=${lon}&koordsys=4258`);
      return d && d.kommunenavn ? { kommune: d.kommunenavn, fylke: d.fylkesnavn, nr: d.kommunenummer } : null;
    } catch { return null; } // utenfor Norge eller tjeneste nede
  }

  async function elevationAt(lat, lon) {
    try {
      const d = await getJson(`${GEONORGE}/hoydedata/v1/punkt?nord=${lat}&ost=${lon}&koordsys=4258&geojson=false`);
      const z = d && d.punkter && d.punkter[0] && d.punkter[0].z;
      return typeof z === "number" && isFinite(z) ? Math.round(z) : null;
    } catch { return null; }
  }

  // ---------- MET / Yr ----------
  const forecastCache = new Map();

  async function fetchForecast(lat, lon, alt) {
    lat = round4(lat); lon = round4(lon);
    const key = `${lat},${lon}`;
    const cached = forecastCache.get(key);
    if (cached && Date.now() - cached.at < FORECAST_TTL_MS) return cached.data;

    const qs = `lat=${lat}&lon=${lon}` + (alt != null ? `&altitude=${Math.round(alt)}` : "");
    let data;
    try {
      // Prøv lokal proxy først (setter korrekt User-Agent), fall tilbake til direkte kall.
      data = await getJson(`${MET_PROXY}?${qs}`);
      if (!data || !data.properties) throw new Error("ugyldig svar fra proxy");
    } catch {
      data = await getJson(`${MET_DIRECT}?${qs}`, { headers: { Accept: "application/json" } });
    }
    forecastCache.set(key, { at: Date.now(), data });
    return data;
  }

  // Finn tidsserie-elementet som gjelder nå (eller første framover)
  function currentEntry(fc) {
    const ts = fc.properties.timeseries || [];
    const now = Date.now();
    let best = ts[0];
    for (const t of ts) {
      if (new Date(t.time).getTime() <= now) best = t; else break;
    }
    return best;
  }

  function summarize(entry) {
    const d = entry.data || {};
    const inst = (d.instant && d.instant.details) || {};
    const next = d.next_1_hours || d.next_6_hours || d.next_12_hours || {};
    return {
      time: entry.time,
      temp: inst.air_temperature,
      wind: inst.wind_speed,
      windDir: inst.wind_from_direction,
      humidity: inst.relative_humidity,
      pressure: inst.air_pressure_at_sea_level,
      clouds: inst.cloud_area_fraction,
      symbol: next.summary && next.summary.symbol_code,
      precip: next.details && next.details.precipitation_amount,
      precipHours: d.next_1_hours ? 1 : d.next_6_hours ? 6 : d.next_12_hours ? 12 : null,
    };
  }

  function fmt(n, unit, digits = 0) {
    return n == null || isNaN(n) ? "–" : `${Number(n).toFixed(digits).replace(".", ",")}${unit}`;
  }

  function hoursPreview(fc, count) {
    const ts = fc.properties.timeseries || [];
    const now = Date.now();
    const upcoming = ts.filter((t) => new Date(t.time).getTime() > now && t.data.next_1_hours).slice(0, count);
    if (!upcoming.length) return "";
    const cells = upcoming.map((t) => {
      const s = summarize(t);
      const hh = new Date(t.time).toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" });
      return `<td><div>${esc(hh)}</div>${iconHtml(s.symbol)}<div>${esc(fmt(s.temp, "°"))}</div></td>`;
    });
    return `<div class="hours"><table><tr>${cells.join("")}</tr></table></div>`;
  }

  function popupHtml({ title, subtitle, fc, alt }) {
    const s = summarize(currentEntry(fc));
    const updated = fc.properties.meta && fc.properties.meta.updated_at;
    const precipLabel = s.precipHours ? `Nedbør neste ${s.precipHours} t` : "Nedbør";
    return `
      <div class="wx">
        <h3>${esc(title)}</h3>
        <div class="sub">${esc(subtitle || "")}${alt != null ? ` · ${alt} moh.` : ""}</div>
        <div class="now">${iconHtml(s.symbol)}<div class="temp">${esc(fmt(s.temp, "°C"))}</div></div>
        <table>
          <tr><th>Vind</th><td>${esc(fmt(s.wind, " m/s"))} ${esc(compass(s.windDir))}</td></tr>
          <tr><th>${esc(precipLabel)}</th><td>${esc(fmt(s.precip, " mm", 1))}</td></tr>
          <tr><th>Luftfuktighet</th><td>${esc(fmt(s.humidity, " %"))}</td></tr>
          <tr><th>Lufttrykk</th><td>${esc(fmt(s.pressure, " hPa"))}</td></tr>
        </table>
        ${hoursPreview(fc, 6)}
        <div class="updated">Varsel fra MET/Yr${updated ? ", oppdatert " + esc(new Date(updated).toLocaleString("nb-NO")) : ""}</div>
      </div>`;
  }

  // ---------- Værmarkører for byer ----------
  async function addCityMarker(city) {
    try {
      const fc = await fetchForecast(city.lat, city.lon, city.alt);
      const s = summarize(currentEntry(fc));
      const icon = L.divIcon({
        className: "",
        html: `<div class="weather-marker">${iconHtml(s.symbol)}<span>${esc(fmt(s.temp, "°"))}</span><span class="name">${esc(city.name)}</span></div>`,
        iconSize: null,
        iconAnchor: [14, 16],
      });
      const m = L.marker([city.lat, city.lon], { icon, title: city.name }).addTo(weatherLayer);
      m.bindPopup(() => popupHtml({ title: city.name, subtitle: "Fast punkt", fc, alt: city.alt }), { maxWidth: 320 });
    } catch (err) {
      console.warn("Vær for", city.name, "feilet:", err);
    }
  }

  async function loadCityWeather() {
    weatherLayer.clearLayers();
    setStatus("Henter vær fra Yr …");
    try {
      // Litt forsiktig med samtidige kall mot api.met.no
      for (let i = 0; i < CITIES.length; i += 4) {
        await Promise.all(CITIES.slice(i, i + 4).map(addCityMarker));
      }
      setStatus("");
    } catch (err) {
      setStatus("Kunne ikke hente vær: " + err.message, true);
    }
  }

  document.getElementById("toggle-weather").addEventListener("change", (e) => {
    if (e.target.checked) { map.addLayer(weatherLayer); if (!weatherLayer.getLayers().length) loadCityWeather(); }
    else map.removeLayer(weatherLayer);
  });

  // ---------- Klikk i kartet: vær + kommune + høyde ----------
  async function showWeatherAt(lat, lon, title) {
    const popup = L.popup({ maxWidth: 320 })
      .setLatLng([lat, lon])
      .setContent(`<div class="wx"><h3>${esc(title || "Valgt punkt")}</h3><div class="sub">Henter vær …</div></div>`)
      .openOn(map);
    try {
      const [kommune, alt] = await Promise.all([kommuneAt(lat, lon), elevationAt(lat, lon)]);
      const fc = await fetchForecast(lat, lon, alt);
      const where = kommune ? `${kommune.kommune}, ${kommune.fylke}` : `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
      const heading = title || (kommune ? kommune.kommune : "Valgt punkt");
      const subtitle = title ? where : `${lat.toFixed(4)}°N ${lon.toFixed(4)}°Ø${kommune ? " · " + where : ""}`;
      popup.setContent(popupHtml({ title: heading, subtitle, fc, alt }));
    } catch (err) {
      popup.setContent(`<div class="wx"><h3>${esc(title || "Valgt punkt")}</h3><div class="sub">Kunne ikke hente vær: ${esc(err.message)}</div></div>`);
    }
  }

  map.on("click", (e) => { if (!sim.active) showWeatherAt(e.latlng.lat, e.latlng.lng); });

  // ---------- Søk ----------
  const resultsEl = document.getElementById("results");
  const form = document.getElementById("search-form");
  const input = document.getElementById("search-input");

  function renderResults(results, q) {
    if (!results.length) {
      resultsEl.innerHTML = `<header><span>Ingen treff på «${esc(q)}»</span><button type="button" data-close>×</button></header>`;
    } else {
      resultsEl.innerHTML = `<header><span>${results.length} treff</span><button type="button" data-close>×</button></header><ul>` +
        results.map((r, i) => `<li data-i="${i}"><div>${esc(r.name)}</div><div class="type">${esc([r.type, r.kommune, r.fylke].filter(Boolean).join(" · "))}</div></li>`).join("") +
        `</ul>`;
    }
    resultsEl.hidden = false;
    resultsEl.querySelector("[data-close]").onclick = () => (resultsEl.hidden = true);
    resultsEl.querySelectorAll("li").forEach((li) => {
      li.onclick = () => {
        const r = results[Number(li.dataset.i)];
        searchLayer.clearLayers();
        L.marker([r.lat, r.lon]).addTo(searchLayer);
        map.flyTo([r.lat, r.lon], Math.max(map.getZoom(), 11));
        showWeatherAt(r.lat, r.lon, r.name);
        if (window.innerWidth < 700) resultsEl.hidden = true;
      };
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    setStatus("Søker i Geonorge …");
    try {
      const results = await searchPlaceNames(q);
      setStatus("");
      renderResults(results, q);
      if (results.length === 1) resultsEl.querySelector("li").click();
    } catch (err) {
      setStatus("Søk feilet: " + err.message, true);
    }
  });

  // ---------- Min posisjon ----------
  document.getElementById("locate-btn").addEventListener("click", () => {
    if (!navigator.geolocation) return setStatus("Nettleseren støtter ikke posisjon", true);
    setStatus("Finner posisjon …");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setStatus("");
        const { latitude: lat, longitude: lon } = pos.coords;
        map.flyTo([lat, lon], 11);
        showWeatherAt(lat, lon, "Min posisjon");
      },
      (err) => setStatus("Fikk ikke posisjon: " + err.message, true),
      { timeout: 10000 }
    );
  });

  // ---------- Værsimulering for kartutsnittet ----------
  const sim = {
    layer: L.layerGroup(),
    points: [],      // { lat, lon, series: Map<time, summary>, cell, marker }
    times: [],       // felles tidsakse (ISO-strenger)
    index: 0,
    timer: null,
    active: false,
  };
  const simPanel = document.getElementById("sim-panel");
  const simSlider = document.getElementById("sim-slider");
  const simTime = document.getElementById("sim-time");
  const simPlay = document.getElementById("sim-play");
  const simSpeed = document.getElementById("sim-speed");

  // Temperatur -> farge (samme skala som legenden)
  const TEMP_STOPS = [
    [-20, [59, 76, 192]], [0, [159, 199, 255]], [0.01, [234, 243, 255]],
    [10, [124, 207, 107]], [20, [245, 212, 66]], [30, [215, 48, 31]],
  ];
  function tempColor(t) {
    if (t == null || isNaN(t)) return "#999";
    if (t <= TEMP_STOPS[0][0]) return rgb(TEMP_STOPS[0][1]);
    for (let i = 1; i < TEMP_STOPS.length; i++) {
      const [t0, c0] = TEMP_STOPS[i - 1], [t1, c1] = TEMP_STOPS[i];
      if (t <= t1) {
        const f = (t - t0) / (t1 - t0);
        return rgb(c0.map((v, k) => Math.round(v + (c1[k] - v) * f)));
      }
    }
    return rgb(TEMP_STOPS[TEMP_STOPS.length - 1][1]);
  }
  function rgb(c) { return `rgb(${c[0]},${c[1]},${c[2]})`; }

  // Velg et rutenett som dekker utsnittet, maks ~20 punkter (skånsomt mot api.met.no)
  function gridForBounds(bounds) {
    const size = map.getSize();
    const aspect = size.x / Math.max(size.y, 1);
    let cols = Math.max(2, Math.min(6, Math.round(Math.sqrt(20 * aspect))));
    let rows = Math.max(2, Math.min(6, Math.round(20 / cols)));
    const south = bounds.getSouth(), north = bounds.getNorth();
    const west = bounds.getWest(), east = bounds.getEast();
    const dLat = (north - south) / rows, dLon = (east - west) / cols;
    const pts = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        pts.push({
          lat: south + dLat * (r + 0.5),
          lon: west + dLon * (c + 0.5),
          bounds: [[south + dLat * r, west + dLon * c], [south + dLat * (r + 1), west + dLon * (c + 1)]],
        });
      }
    }
    return pts;
  }

  function seriesOf(fc) {
    const m = new Map();
    for (const t of fc.properties.timeseries || []) m.set(t.time, summarize(t));
    return m;
  }

  function simLabel(iso) {
    const d = new Date(iso);
    const day = d.toLocaleDateString("nb-NO", { weekday: "long", day: "numeric", month: "short" });
    const hh = d.toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" });
    const hoursAhead = Math.round((d.getTime() - Date.now()) / 36e5);
    const rel = hoursAhead <= 0 ? "nå" : hoursAhead < 24 ? `om ${hoursAhead} t` : `om ${Math.round(hoursAhead / 24)} d`;
    return `${day.charAt(0).toUpperCase()}${day.slice(1)} kl. ${hh} (${rel})`;
  }

  function renderSimFrame(i) {
    if (!sim.times.length) return;
    sim.index = Math.max(0, Math.min(sim.times.length - 1, i));
    const time = sim.times[sim.index];
    simSlider.value = String(sim.index);
    simTime.textContent = simLabel(time);
    for (const p of sim.points) {
      const s = p.series.get(time);
      if (!s) continue;
      const wet = s.precip != null && s.precip > 0.1;
      p.cell.setStyle({
        fillColor: tempColor(s.temp),
        color: wet ? "#0b4fa0" : "#ffffff",
        weight: wet ? Math.min(4, 1 + s.precip) : 1,
      });
      const el = p.marker.getElement();
      if (!el) continue;
      const img = el.querySelector("img, .emoji");
      if (img && img.dataset.code !== (s.symbol || "")) {
        img.outerHTML = iconHtml(s.symbol);
      }
      el.querySelector(".t").textContent = fmt(s.temp, "°");
      const wind = el.querySelector(".wind");
      if (s.windDir != null && s.wind != null) {
        wind.hidden = false;
        wind.style.transform = `rotate(${Math.round(s.windDir + 90)}deg)`; // pilen peker dit vinden blåser
        wind.style.opacity = String(Math.min(1, 0.35 + s.wind / 12));
        wind.title = `${fmt(s.wind, " m/s")} fra ${compass(s.windDir)}`;
      } else wind.hidden = true;
      el.querySelector(".precip").textContent = wet ? fmt(s.precip, " mm", 1) : "";
    }
  }

  function simStop() {
    clearInterval(sim.timer);
    sim.timer = null;
    simPlay.textContent = "▶";
    simPlay.setAttribute("aria-label", "Spill av");
  }
  function simStart() {
    if (!sim.times.length) return;
    simStop();
    if (sim.index >= sim.times.length - 1) sim.index = 0;
    simPlay.textContent = "❚❚";
    simPlay.setAttribute("aria-label", "Pause");
    sim.timer = setInterval(() => {
      if (sim.index >= sim.times.length - 1) return simStop();
      renderSimFrame(sim.index + 1);
    }, Number(simSpeed.value));
  }

  async function startSimulation() {
    simStop();
    sim.layer.clearLayers();
    sim.points = []; sim.times = []; sim.index = 0;
    sim.active = true;
    map.addLayer(sim.layer);
    simPanel.hidden = false;
    simTime.textContent = "Henter varsler …";
    map.closePopup();
    if (map.hasLayer(weatherLayer)) map.removeLayer(weatherLayer); // mindre rot mens simuleringen vises

    const grid = gridForBounds(map.getBounds());
    setStatus(`Henter varsler for ${grid.length} punkter i utsnittet …`);
    const failed = [];
    for (let i = 0; i < grid.length; i += 4) {
      await Promise.all(grid.slice(i, i + 4).map(async (g) => {
        try {
          const fc = await fetchForecast(g.lat, g.lon);
          g.series = seriesOf(fc);
        } catch (err) { failed.push(g); }
      }));
    }
    const points = grid.filter((g) => g.series);
    if (!points.length) {
      setStatus("Fikk ikke hentet varsler for utsnittet: " + (failed.length ? "api.met.no svarte ikke" : "ukjent feil"), true);
      closeSimulation();
      return;
    }
    // Felles tidsakse: tidspunkter som finnes hos alle punkter, fra nå og 3 døgn fram
    const limit = Date.now() + 3 * 24 * 3600e3;
    const first = points[0].series;
    sim.times = [...first.keys()].filter((t) => {
      const ms = new Date(t).getTime();
      return ms >= Date.now() - 3600e3 && ms <= limit && points.every((p) => p.series.has(t));
    });
    for (const g of points) {
      g.cell = L.rectangle(g.bounds, { className: "sim-cell", fillOpacity: 0.45, weight: 1, color: "#fff", interactive: false }).addTo(sim.layer);
      g.marker = L.marker([g.lat, g.lon], {
        interactive: false,
        icon: L.divIcon({ className: "", iconSize: null, html: `<div class="sim-marker">${iconHtml("")}<span class="t">–</span><span class="wind" hidden>➤</span><span class="precip"></span></div>` }),
      }).addTo(sim.layer);
    }
    sim.points = points;
    simSlider.max = String(Math.max(0, sim.times.length - 1));
    setStatus(failed.length ? `${failed.length} av ${grid.length} punkter feilet` : "", !!failed.length);
    renderSimFrame(0);
    simStart();
  }

  function closeSimulation() {
    simStop();
    sim.active = false;
    sim.layer.clearLayers();
    map.removeLayer(sim.layer);
    simPanel.hidden = true;
    if (document.getElementById("toggle-weather").checked) map.addLayer(weatherLayer);
  }

  document.getElementById("sim-btn").addEventListener("click", startSimulation);
  document.getElementById("sim-refresh").addEventListener("click", startSimulation);
  document.getElementById("sim-close").addEventListener("click", closeSimulation);
  simPlay.addEventListener("click", () => (sim.timer ? simStop() : simStart()));
  simSlider.addEventListener("input", () => { simStop(); renderSimFrame(Number(simSlider.value)); });
  simSpeed.addEventListener("change", () => { if (sim.timer) simStart(); });
  document.addEventListener("keydown", (e) => {
    if (!sim.active || e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
    if (e.key === " ") { e.preventDefault(); sim.timer ? simStop() : simStart(); }
    else if (e.key === "ArrowRight") { simStop(); renderSimFrame(sim.index + 1); }
    else if (e.key === "ArrowLeft") { simStop(); renderSimFrame(sim.index - 1); }
    else if (e.key === "Escape") closeSimulation();
  });

  // ---------- Stier (fliselag) ----------
  const TRAIL_LAYERS = {
    // Vandreruter fra OpenStreetMap, tegnet av Waymarked Trails
    osm: () => L.tileLayer("https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png", {
      maxZoom: 18, opacity: 0.85,
      attribution: '<a href="https://hiking.waymarkedtrails.org">Waymarked Trails</a> · © OpenStreetMap-bidragsytere',
    }),
    // Nasjonal database for tur- og friluftsruter (Kartverket) som WMS
    kartverket: () => L.tileLayer.wms("https://wms.geonorge.no/skwms1/wms.friluftsruter2", {
      layers: "fotrute,skiloype,sykkelrute,annenrute",
      format: "image/png", transparent: true, version: "1.3.0", opacity: 0.9,
      attribution: '<a href="https://kartkatalog.geonorge.no">Kartverket, tur- og friluftsruter</a>',
    }),
  };
  let trailLayer = null;
  const trailToggle = document.getElementById("toggle-trails");
  const trailSource = document.getElementById("trail-source");
  function updateTrails() {
    if (trailLayer) { map.removeLayer(trailLayer); trailLayer = null; }
    if (!trailToggle.checked) return;
    trailLayer = TRAIL_LAYERS[trailSource.value]().addTo(map);
    trailLayer.on("tileerror", () => setStatus("Fikk ikke lastet stier fra " + trailSource.options[trailSource.selectedIndex].text, true));
  }
  trailToggle.addEventListener("change", updateTrails);
  trailSource.addEventListener("change", () => { if (trailToggle.checked) updateTrails(); });

  // ---------- Turisthytter fra OpenStreetMap (Overpass) ----------
  const OVERPASS_ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
  const HUT_MIN_ZOOM = 8;
  const hutLayer = L.layerGroup();
  const hutToggle = document.getElementById("toggle-huts");
  const huts = { loadedBounds: null, timer: null, inflight: null, byId: new Map(), data: new Map() };

  const HUT_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 12h3v8h5v-5h4v5h5v-8h3z"/></svg>';

  function hutKind(tags) {
    if (tags.tourism === "alpine_hut") return { cls: "staffed", label: "Betjent turisthytte" };
    if (tags.tourism === "wilderness_hut") return { cls: "self-service", label: "Selvbetjent eller ubetjent hytte" };
    return { cls: "shelter", label: "Gapahuk eller enkel bu" };
  }

  async function overpass(query) {
    let lastErr;
    for (const url of OVERPASS_ENDPOINTS) {
      try {
        const res = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(query), headers: { "Content-Type": "application/x-www-form-urlencoded" } });
        if (!res.ok) throw new Error(`${res.status} fra ${new URL(url).host}`);
        return await res.json();
      } catch (err) { lastErr = err; }
    }
    throw lastErr || new Error("Overpass utilgjengelig");
  }

  function hutPopup(h) {
    const t = h.tags;
    const kind = hutKind(t);
    const name = t.name || t["name:no"] || "Hytte uten navn";
    const rows = [];
    if (t.operator) rows.push(["Driftes av", t.operator]);
    const beds = t.beds || t.capacity;
    if (beds) rows.push(["Senger", beds]);
    if (t.fee) rows.push(["Betaling", t.fee === "yes" ? "Ja" : t.fee === "no" ? "Nei" : t.fee]);
    if (t.reservation) rows.push(["Booking", t.reservation === "required" ? "Påkrevd" : t.reservation === "recommended" ? "Anbefalt" : t.reservation]);
    if (t.opening_hours) rows.push(["Åpent", t.opening_hours]);
    if (t.ele) rows.push(["Høyde", `${Math.round(Number(t.ele))} moh.`]);
    if (t.phone || t["contact:phone"]) rows.push(["Telefon", t.phone || t["contact:phone"]]);
    if (t.description) rows.push(["Info", t.description]);
    const site = t.website || t["contact:website"] || t.url;
    const utUrl = "https://ut.no/sok?q=" + encodeURIComponent(name);
    const osmUrl = `https://www.openstreetmap.org/${h.type}/${h.id}`;
    return `
      <div class="hut">
        <h3>${esc(name)}</h3>
        <div class="kind">${esc(kind.label)}</div>
        ${rows.length ? `<table>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>` : ""}
        <div class="actions">
          <button type="button" onclick="window.__wxHere(${h.lat},${h.lon},${JSON.stringify(name).replace(/"/g, "&quot;")})">Vær her</button>
          ${site ? `<a href="${esc(site)}" target="_blank" rel="noopener">Nettside</a>` : ""}
          <a href="${esc(utUrl)}" target="_blank" rel="noopener">Søk på UT.no</a>
          <a href="${esc(osmUrl)}" target="_blank" rel="noopener">OSM</a>
        </div>
        <div class="actions">
          <button type="button" onclick="window.__tripSet('start','${h.type}/${h.id}')">Start tur her</button>
          <button type="button" onclick="window.__tripSet('end','${h.type}/${h.id}')">Tur hit</button>
        </div>
      </div>`;
  }

  let hutsChanged = false;
  function updateZoomClasses() {
    const z = map.getZoom();
    map.getContainer().classList.toggle("zoom-near", z >= 11);
    map.getContainer().classList.toggle("zoom-far", z < 10);
  }
  map.on("zoomend", updateZoomClasses);
  updateZoomClasses();

  async function loadHuts() {
    if (!hutToggle.checked) return;
    if (map.getZoom() < HUT_MIN_ZOOM) { setStatus("Zoom inn for å se turisthytter"); return; }
    const view = map.getBounds();
    if (huts.loadedBounds && huts.loadedBounds.contains(view)) { setStatus(""); return; }
    const b = view.pad(0.4); // hent litt utenfor utsnittet, så små flytt ikke gir nye kall
    const bbox = `${b.getSouth().toFixed(4)},${b.getWest().toFixed(4)},${b.getNorth().toFixed(4)},${b.getEast().toFixed(4)}`;
    const query = `[out:json][timeout:25];(
      nwr["tourism"~"^(alpine_hut|wilderness_hut)$"](${bbox});
      nwr["amenity"="shelter"]["shelter_type"="basic_hut"](${bbox});
    );out center tags;`;
    setStatus("Henter turisthytter fra OpenStreetMap …");
    const myRequest = (huts.inflight = {});
    try {
      const data = await overpass(query);
      if (huts.inflight !== myRequest) return; // et nyere kall har tatt over
      huts.loadedBounds = b;
      let added = 0;
      for (const el of data.elements || []) {
        const key = `${el.type}/${el.id}`;
        if (huts.byId.has(key)) continue;
        const lat = el.lat ?? (el.center && el.center.lat);
        const lon = el.lon ?? (el.center && el.center.lon);
        if (lat == null || lon == null) continue;
        const h = { type: el.type, id: el.id, lat, lon, tags: el.tags || {} };
        const kind = hutKind(h.tags);
        const marker = L.marker([lat, lon], {
          title: h.tags.name || kind.label,
          icon: L.divIcon({
            className: "hut-icon", iconSize: [44, 44], iconAnchor: [22, 22], popupAnchor: [0, -20],
            html: `<div class="hut-hit"><div class="hut-marker ${kind.cls}">${HUT_SVG}</div><span class="hut-label">${esc(h.tags.name || "")}</span></div>`,
          }),
        }).bindPopup(() => hutPopup(h), { maxWidth: 320 });
        marker.addTo(hutLayer);
        huts.byId.set(key, marker);
        huts.data.set(key, h);
        hutsChanged = true;
        added++;
      }
      setStatus(huts.byId.size ? "" : "Ingen hytter registrert i dette utsnittet");
      if (hutsChanged) { hutsChanged = false; if (typeof fillTripSelects === "function") fillTripSelects(); }
      if (!huts.byId.size) setTimeout(() => setStatus(""), 3000);
    } catch (err) {
      if (huts.inflight === myRequest) setStatus("Kunne ikke hente hytter: " + err.message, true);
    }
  }

  function scheduleHuts() {
    clearTimeout(huts.timer);
    huts.timer = setTimeout(loadHuts, 700);
  }
  hutToggle.addEventListener("change", () => {
    if (hutToggle.checked) { map.addLayer(hutLayer); loadHuts(); }
    else { map.removeLayer(hutLayer); setStatus(""); }
  });
  map.on("moveend", () => { if (hutToggle.checked) scheduleHuts(); });

  // ---------- 3D-visning (MapLibre GL JS med terreng) ----------
  const MAPLIBRE_VERSION = "4.7.1";
  const TERRAIN_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
  const view3d = { active: false, map: null, markers: [], loaded: null };
  const wrap3d = document.getElementById("map3d-wrap");
  const exaggerationInput = document.getElementById("exaggeration");
  const exaggerationValue = document.getElementById("exaggeration-value");
  const status3d = document.getElementById("status3d");

  function setStatus3d(text, isError) {
    if (!text) { status3d.hidden = true; return; }
    status3d.textContent = text;
    status3d.classList.toggle("error", !!isError);
    status3d.hidden = false;
    if (isError) setTimeout(() => (status3d.hidden = true), 6000);
  }

  // MapLibre lastes først når 3D-knappen brukes, så 2D-kartet forblir lett
  function loadMapLibre() {
    if (window.maplibregl) return Promise.resolve();
    if (view3d.loaded) return view3d.loaded;
    view3d.loaded = new Promise((resolve, reject) => {
      const base = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl`;
      const link = document.createElement("link");
      link.rel = "stylesheet"; link.href = `${base}.css`;
      document.head.appendChild(link);
      const script = document.createElement("script");
      script.src = `${base}.js`;
      script.onload = () => resolve();
      script.onerror = () => { view3d.loaded = null; reject(new Error("Fikk ikke lastet MapLibre GL")); };
      document.head.appendChild(script);
    });
    return view3d.loaded;
  }

  function style3d() {
    const sources = {
      terrain: { type: "raster-dem", tiles: [TERRAIN_TILES], encoding: "terrarium", tileSize: 256, maxzoom: 15, attribution: "Terreng: Mapzen / AWS Terrain Tiles" },
    };
    const layers = [];
    basemapLayers(basemapSelect.value).forEach((t, i) => {
      const id = `base${i}`;
      sources[id] = { type: "raster", tileSize: 256, maxzoom: t.maxNativeZoom ?? t.maxZoom, tiles: [t.url], attribution: t.attribution.replace(/<[^>]+>/g, "") };
      layers.push({ id, type: "raster", source: id, paint: { "raster-opacity": t.opacity ?? 1 } });
    });
    if (trailToggle.checked) {
      sources.trails = trailSource.value === "osm"
        ? { type: "raster", tileSize: 256, tiles: ["https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png"], attribution: "Waymarked Trails · © OpenStreetMap-bidragsytere" }
        : { type: "raster", tileSize: 256, tiles: ["https://wms.geonorge.no/skwms1/wms.friluftsruter2?service=WMS&request=GetMap&version=1.1.1&layers=fotrute,skiloype,sykkelrute,annenrute&styles=&format=image/png&transparent=true&srs=EPSG:3857&width=256&height=256&bbox={bbox-epsg-3857}"], attribution: "Kartverket, tur- og friluftsruter" };
      layers.push({ id: "trails", type: "raster", source: "trails", paint: { "raster-opacity": 0.85 } });
    }
    return { version: 8, sources, layers, terrain: { source: "terrain", exaggeration: Number(exaggerationInput.value) } };
  }

  // Gjenbruk Leaflet-markører (vær og hytter) som MapLibre-markører med samme popup
  function addMarkers3d(layerGroup) {
    layerGroup.eachLayer((m) => {
      if (!(m instanceof L.Marker)) return;
      const ll = m.getLatLng();
      const el = document.createElement("div");
      el.innerHTML = m.getIcon().options.html || "";
      const node = el.firstElementChild || el;
      const marker = new maplibregl.Marker({ element: node, anchor: "center" }).setLngLat([ll.lng, ll.lat]);
      const popup = m.getPopup();
      if (popup) {
        marker.setPopup(new maplibregl.Popup({ maxWidth: "320px", offset: 16 }).setHTML(""));
        node.addEventListener("click", () => {
          const content = popup.getContent();
          marker.getPopup().setHTML(typeof content === "function" ? content(m) : String(content));
        }, true);
      }
      marker.addTo(view3d.map);
      view3d.markers.push(marker);
    });
  }

  async function open3d() {
    if (view3d.active) return view3d.map;
    if (sim.active) closeSimulation();
    map.closePopup();
    setStatus("Laster 3D-kart …");
    try { await loadMapLibre(); } catch (err) { setStatus(err.message, true); return; }
    try {
      const ready = open3dMap();
      setStatus("");
      return ready;
    } catch (err) {
      console.error(err);
      view3d.active = false;
      wrap3d.hidden = true;
      setStatus("3D-kartet kunne ikke startes: " + err.message, true);
    }
  }

  function open3dMap() {
    view3d.active = true;
    wrap3d.hidden = false;
    const c = map.getCenter();
    view3d.map = new maplibregl.Map({
      container: "map3d",
      style: style3d(),
      center: [c.lng, c.lat],
      zoom: Math.max(map.getZoom() - 1, 1),
      pitch: 60, bearing: 0, maxPitch: 80,
      attributionControl: { compact: false },
      maxZoom: 17,
    });
    const m3 = view3d.map;
    m3.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    m3.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    m3.on("load", () => {
      if (typeof m3.setSky === "function") {
        m3.setSky({ "sky-color": "#9fc7ff", "horizon-color": "#e8f1ff", "fog-color": "#ffffff", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.8, "fog-ground-blend": 0.6 });
      }
      if (map.hasLayer(weatherLayer)) addMarkers3d(weatherLayer);
      if (hutToggle.checked) addMarkers3d(hutLayer);
    });
    m3.on("error", (e) => {
      const msg = e && e.error && e.error.message ? e.error.message : "";
      console.warn("MapLibre:", msg);
      if (/terrarium|elevation-tiles/.test(msg)) setStatus3d("Fikk ikke lastet terrengdata", true);
      else if (/WebGL/i.test(msg)) setStatus3d("Nettleseren kunne ikke starte WebGL, som 3D-kartet trenger", true);
    });
    m3.once("load", () => setStatus3d(""));
    setStatus3d("Bygger 3D-kart …");
    return new Promise((resolve) => (m3.loaded() ? resolve(m3) : m3.once("load", () => resolve(m3))));
  }

  function close3d() {
    if (!view3d.active) return;
    stopFlight();
    const m3 = view3d.map;
    const c = m3.getCenter();
    view3d.markers.forEach((mk) => mk.remove());
    view3d.markers = [];
    m3.remove();
    view3d.map = null;
    view3d.active = false;
    wrap3d.hidden = true;
    map.setView([c.lat, c.lng], Math.round(m3.getZoom() + 1));
  }

  document.getElementById("btn-3d").addEventListener("click", open3d);
  document.getElementById("btn-2d").addEventListener("click", close3d);
  exaggerationInput.addEventListener("input", () => {
    exaggerationValue.textContent = Number(exaggerationInput.value).toLocaleString("nb-NO") + "×";
    if (view3d.map) view3d.map.setTerrain({ source: "terrain", exaggeration: Number(exaggerationInput.value) });
  });
  document.addEventListener("keydown", (e) => { if (view3d.active && e.key === "Escape") close3d(); });
  // «Vær her» i en hyttepopup i 3D: gå tilbake til 2D og vis været der
  window.__wxHere = (lat, lon, name) => { if (view3d.active) { close3d(); map.setView([lat, lon], Math.max(map.getZoom(), 10)); } showWeatherAt(lat, lon, name); };

  // ---------- Tur mellom to hytter, med gjennomflyging i 3D ----------
  const BROUTER = "https://brouter.de/brouter";
  const trip = { start: null, end: null, route: null, open: false, layer: L.layerGroup().addTo(map) };
  const tripFromSelect = document.getElementById("trip-from-select");
  const tripToSelect = document.getElementById("trip-to-select");
  const tripPanel = document.getElementById("trip-panel");
  const tripFly = document.getElementById("trip-fly");
  const tripStats = document.getElementById("trip-stats");

  const R_EARTH = 6371000;
  function haversine(a, b) { // [lon, lat]
    const toR = Math.PI / 180;
    const dLat = (b[1] - a[1]) * toR, dLon = (b[0] - a[0]) * toR;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toR) * Math.cos(b[1] * toR) * Math.sin(dLon / 2) ** 2;
    return 2 * R_EARTH * Math.asin(Math.sqrt(h));
  }
  function bearingBetween(a, b) {
    const toR = Math.PI / 180;
    const y = Math.sin((b[0] - a[0]) * toR) * Math.cos(b[1] * toR);
    const x = Math.cos(a[1] * toR) * Math.sin(b[1] * toR) - Math.sin(a[1] * toR) * Math.cos(b[1] * toR) * Math.cos((b[0] - a[0]) * toR);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }
  function fmtKm(m) { return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1).replace(".", ",")} km`; }
  function fmtTime(sec) { const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60); return h ? `${h} t ${m} min` : `${m} min`; }

  function hutName(h) { return h.tags.name || h.tags["name:no"] || hutKind(h.tags).label; }

  // Rute: { coords: [[lon,lat,ele?],...], cum: [m,...], length, ascent, descent, time, source }
  function buildRoute(coords, source) {
    const cum = [0];
    for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]));
    let ascent = 0, descent = 0, hasEle = coords.every((c) => typeof c[2] === "number");
    if (hasEle) {
      for (let i = 1; i < coords.length; i++) {
        const d = coords[i][2] - coords[i - 1][2];
        if (d > 0) ascent += d; else descent -= d;
      }
    }
    const length = cum[cum.length - 1];
    // Naismiths regel: 5 km/t pluss 1 time per 600 høydemeter opp
    const time = length / (5000 / 3600) + (hasEle ? (ascent / 600) * 3600 : 0);
    return { coords, cum, length, ascent: hasEle ? ascent : null, descent: hasEle ? descent : null, time, source, hasEle };
  }

  async function routeBetween(a, b) {
    const url = `${BROUTER}?lonlats=${a.lon.toFixed(6)},${a.lat.toFixed(6)}|${b.lon.toFixed(6)},${b.lat.toFixed(6)}&profile=hiking-mountain&alternativeidx=0&format=geojson`;
    try {
      const gj = await getJson(url);
      const f = gj.features && gj.features[0];
      const coords = f && f.geometry && f.geometry.coordinates;
      if (!coords || coords.length < 2) throw new Error("tom rute");
      return buildRoute(coords.map((c) => [c[0], c[1], typeof c[2] === "number" ? c[2] : undefined]), "Langs stier (BRouter / OpenStreetMap)");
    } catch (err) {
      console.warn("BRouter feilet, bruker rett linje:", err);
      const n = 60, coords = [];
      for (let i = 0; i <= n; i++) coords.push([a.lon + ((b.lon - a.lon) * i) / n, a.lat + ((b.lat - a.lat) * i) / n]);
      return buildRoute(coords, "Rett linje (fant ingen sti-rute)");
    }
  }

  function fillTripSelects() {
    const list = [...huts.data.entries()]
      .map(([key, h]) => ({ key, name: hutName(h), kind: hutKind(h.tags).label }))
      .sort((a, b) => a.name.localeCompare(b.name, "nb"));
    for (const [sel, placeholder] of [[tripFromSelect, "Velg starthytte …"], [tripToSelect, "Velg målhytte …"]]) {
      const current = sel.value;
      sel.innerHTML = `<option value="">${placeholder}</option>` +
        list.map((h) => `<option value="${esc(h.key)}">${esc(h.name)} (${esc(h.kind.toLowerCase())})</option>`).join("");
      sel.value = current;
    }
    document.getElementById("trip-hint").textContent = list.length
      ? `${list.length} hytter i utsnittet. Du kan også trykke på en hytte i kartet.`
      : "Slå på Turisthytter og zoom inn, så fylles listene med hyttene i utsnittet.";
  }

  function renderTrip() {
    tripPanel.hidden = !(trip.open || trip.start || trip.end);
    tripFromSelect.value = trip.start ? trip.start.key : "";
    tripToSelect.value = trip.end ? trip.end.key : "";
    for (const [key, marker] of huts.byId) {
      const el = marker.getElement() && marker.getElement().querySelector(".hut-marker");
      if (!el) continue;
      el.classList.toggle("trip-start", !!trip.start && key === trip.start.key);
      el.classList.toggle("trip-end", !!trip.end && key === trip.end.key);
    }
    const r = trip.route;
    if (r) {
      tripStats.innerHTML =
        `<strong>${esc(fmtKm(r.length))}</strong>` +
        (r.ascent != null ? ` · ↑ ${Math.round(r.ascent)} m · ↓ ${Math.round(r.descent)} m` : "") +
        ` · ca. ${esc(fmtTime(r.time))}<br><span>${esc(r.source)}</span>`;
    } else tripStats.textContent = trip.start && trip.end ? "Beregner rute …" : "";
    tripFly.disabled = !r;
  }

  function drawRoute2d() {
    trip.layer.clearLayers();
    if (!trip.route) return;
    const latlngs = trip.route.coords.map((c) => [c[1], c[0]]);
    L.polyline(latlngs, { color: "#fff", weight: 7, opacity: 0.8 }).addTo(trip.layer);
    L.polyline(latlngs, { color: "#ff6a00", weight: 4 }).addTo(trip.layer);
    map.fitBounds(L.latLngBounds(latlngs).pad(0.2));
  }

  async function computeTrip() {
    trip.route = null;
    renderTrip();
    if (!trip.start || !trip.end) return;
    setStatus("Beregner rute langs stier …");
    const [a, b] = [trip.start, trip.end];
    const route = await routeBetween(a, b);
    if (trip.start !== a || trip.end !== b) return; // valget er endret i mellomtiden
    trip.route = route;
    setStatus("");
    renderTrip();
    drawRoute2d();
  }

  window.__tripSet = (role, key) => {
    const h = huts.data.get(key);
    if (!h) return;
    trip[role] = { ...h, key };
    trip.open = true;
    map.closePopup();
    fillTripSelects();
    computeTrip();
  };
  document.getElementById("trip-reset").addEventListener("click", () => {
    trip.start = trip.end = trip.route = null;
    trip.open = false;
    trip.layer.clearLayers();
    renderTrip();
  });
  document.getElementById("trip-btn").addEventListener("click", () => {
    trip.open = true;
    if (!hutToggle.checked) { hutToggle.checked = true; hutToggle.dispatchEvent(new Event("change")); }
    fillTripSelects();
    renderTrip();
  });
  tripFromSelect.addEventListener("change", () => { if (tripFromSelect.value) window.__tripSet("start", tripFromSelect.value); else { trip.start = null; computeTrip(); } });
  tripToSelect.addEventListener("change", () => { if (tripToSelect.value) window.__tripSet("end", tripToSelect.value); else { trip.end = null; computeTrip(); } });

  // --- Gjennomflyging i 3D ---
  const FLY_ZOOM = 14.2, FLY_PITCH = 64;
  const fly = { raf: null, dist: 0, bearing: null, last: 0, playing: false, hiker: null, route: null };
  const flyPanel = document.getElementById("fly-panel");
  const flySlider = document.getElementById("fly-slider");
  const flyPlay = document.getElementById("fly-play");
  const flySpeed = document.getElementById("fly-speed");
  const flyInfo = document.getElementById("fly-info");

  function pointAt(route, d) {
    const { coords, cum } = route;
    if (d <= 0) return coords[0];
    if (d >= route.length) return coords[coords.length - 1];
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid; }
    const f = (d - cum[lo]) / Math.max(cum[hi] - cum[lo], 1e-9);
    const a = coords[lo], b = coords[hi];
    const p = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    if (typeof a[2] === "number" && typeof b[2] === "number") p.push(a[2] + (b[2] - a[2]) * f);
    return p;
  }

  function drawProfile(route) {
    const area = document.getElementById("fly-profile-area");
    const line = document.getElementById("fly-profile-line");
    if (!route.hasEle) { area.setAttribute("d", ""); line.setAttribute("d", ""); document.getElementById("fly-profile-min").textContent = "Høydeprofil ikke tilgjengelig"; document.getElementById("fly-profile-max").textContent = ""; return; }
    const eles = route.coords.map((c) => c[2]);
    const min = Math.min(...eles), max = Math.max(...eles), span = Math.max(max - min, 10);
    const pts = route.coords.map((c, i) => `${((route.cum[i] / route.length) * 600).toFixed(1)},${(66 - ((c[2] - min) / span) * 60).toFixed(1)}`);
    line.setAttribute("d", "M" + pts.join(" L"));
    area.setAttribute("d", "M0,70 L" + pts.join(" L") + " L600,70 Z");
    document.getElementById("fly-profile-min").textContent = `Lavest ${Math.round(min)} moh.`;
    document.getElementById("fly-profile-max").textContent = `Høyest ${Math.round(max)} moh.`;
  }

  function flyFrame(ts) {
    if (!fly.playing) return;
    const dt = Math.min((ts - fly.last) / 1000, 0.3); // tåler trege rammer, men hopper ikke etter fanebytte
    fly.last = ts;
    fly.dist += Number(flySpeed.value) * dt;
    if (fly.dist >= fly.route.length) { fly.dist = fly.route.length; renderFly(); pauseFlight(); flyInfo.textContent = `Framme ved ${hutName(trip.end)} · ${fmtKm(fly.route.length)}`; return; }
    renderFly();
    fly.raf = requestAnimationFrame(flyFrame);
  }

  function renderFly() {
    const m3 = view3d.map, route = fly.route;
    if (!m3 || !route) return;
    const pos = pointAt(route, fly.dist);
    const ahead = pointAt(route, Math.min(fly.dist + 150, route.length));
    const target = haversine(pos, ahead) > 5 ? bearingBetween(pos, ahead) : (fly.bearing ?? 0);
    if (fly.bearing == null) fly.bearing = target;
    else { let diff = ((target - fly.bearing + 540) % 360) - 180; fly.bearing = (fly.bearing + diff * 0.08 + 360) % 360; }
    m3.jumpTo({ center: [pos[0], pos[1]], bearing: fly.bearing, pitch: FLY_PITCH, zoom: FLY_ZOOM });
    fly.hiker.setLngLat([pos[0], pos[1]]);
    flySlider.value = String(Math.round((fly.dist / route.length) * 1000));
    document.getElementById("fly-profile-cursor").setAttribute("x1", (fly.dist / route.length) * 600);
    document.getElementById("fly-profile-cursor").setAttribute("x2", (fly.dist / route.length) * 600);
    let ele = typeof pos[2] === "number" ? pos[2] : (typeof m3.queryTerrainElevation === "function" ? m3.queryTerrainElevation([pos[0], pos[1]]) : null);
    flyInfo.textContent = `${fmtKm(fly.dist)} av ${fmtKm(route.length)}` + (ele != null && isFinite(ele) ? ` · ${Math.round(ele)} moh.` : "");
  }

  function pauseFlight() { fly.playing = false; cancelAnimationFrame(fly.raf); flyPlay.textContent = "▶"; flyPlay.setAttribute("aria-label", "Spill av"); }
  function playFlight() {
    if (!fly.route) return;
    if (fly.dist >= fly.route.length) fly.dist = 0;
    fly.playing = true; fly.last = performance.now();
    flyPlay.textContent = "❚❚"; flyPlay.setAttribute("aria-label", "Pause");
    fly.raf = requestAnimationFrame(flyFrame);
  }
  function stopFlight() {
    pauseFlight();
    flyPanel.hidden = true;
    if (fly.hiker) { fly.hiker.remove(); fly.hiker = null; }
    fly.route = null;
  }

  async function startFlight() {
    if (!trip.route) return;
    const route = trip.route;
    const m3 = await open3d();
    if (!m3) return;
    const gj = { type: "Feature", geometry: { type: "LineString", coordinates: route.coords.map((c) => [c[0], c[1]]) } };
    if (m3.getSource("route")) m3.getSource("route").setData(gj);
    else {
      m3.addSource("route", { type: "geojson", data: gj });
      m3.addLayer({ id: "route-casing", type: "line", source: "route", paint: { "line-color": "#ffffff", "line-width": 7, "line-opacity": 0.8 }, layout: { "line-join": "round", "line-cap": "round" } });
      m3.addLayer({ id: "route-line", type: "line", source: "route", paint: { "line-color": "#ff6a00", "line-width": 4 }, layout: { "line-join": "round", "line-cap": "round" } });
    }
    if (fly.hiker) fly.hiker.remove();
    const el = document.createElement("div"); el.className = "hiker-marker"; el.textContent = "🥾";
    fly.hiker = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([route.coords[0][0], route.coords[0][1]]).addTo(m3);
    fly.route = route; fly.dist = 0; fly.bearing = null;
    drawProfile(route);
    flyPanel.hidden = false;
    flyInfo.textContent = `${hutName(trip.start)} → ${hutName(trip.end)}`;
    m3.once("dragstart", pauseFlight);
    renderFly();
    playFlight();
  }

  tripFly.addEventListener("click", startFlight);
  flyPlay.addEventListener("click", () => (fly.playing ? pauseFlight() : playFlight()));
  document.getElementById("fly-stop").addEventListener("click", stopFlight);
  flySlider.addEventListener("input", () => { if (!fly.route) return; pauseFlight(); fly.dist = (Number(flySlider.value) / 1000) * fly.route.length; renderFly(); });
  document.addEventListener("keydown", (e) => {
    if (!fly.route || e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
    if (e.key === " ") { e.preventDefault(); fly.playing ? pauseFlight() : playFlight(); }
  });

  // ---------- Start ----------
  loadCityWeather();
})();
