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

  function kartverketLayer(layerName) {
    return L.tileLayer(
      `https://cache.kartverket.no/v1/wmts/1.0.0/${layerName}/default/webmercator/{z}/{y}/{x}.png`,
      { maxZoom: 18, attribution: '&copy; <a href="https://www.kartverket.no">Kartverket</a>' }
    );
  }
  let baseLayer = kartverketLayer("topo").addTo(map);
  document.getElementById("basemap").addEventListener("change", (e) => {
    map.removeLayer(baseLayer);
    baseLayer = kartverketLayer(e.target.value).addTo(map);
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
    if (!code) return `<span class="emoji ${cls || ""}">🌡️</span>`;
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

  map.on("click", (e) => showWeatherAt(e.latlng.lat, e.latlng.lng));

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

  // ---------- Start ----------
  loadCityWeather();
})();
