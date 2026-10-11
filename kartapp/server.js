// Enkel, avhengighetsfri server: serverer kartappen og videresender værkall til
// api.met.no med en identifiserende User-Agent (MET krever dette i sine vilkår).
// Start: node server.js  ->  http://localhost:8080
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 8080;
const USER_AGENT = process.env.MET_USER_AGENT || "sandkassen-kartapp/0.1 https://github.com/haraldingeefab/sandkassen";
const ROOT = __dirname;
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };

const cache = new Map(); // key -> { expires, body }

function proxyMet(req, res, url) {
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  const altitude = url.searchParams.get("altitude");
  if (!isFinite(lat) || !isFinite(lon)) {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "lat og lon må være tall" }));
  }
  let qs = `lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
  if (altitude !== null && isFinite(Number(altitude))) qs += `&altitude=${Math.round(Number(altitude))}`;

  const hit = cache.get(qs);
  if (hit && hit.expires > Date.now()) {
    res.writeHead(200, { "Content-Type": "application/json", "X-Cache": "HIT" });
    return res.end(hit.body);
  }

  const upstream = https.request(
    { host: "api.met.no", path: `/weatherapi/locationforecast/2.0/compact?${qs}`, headers: { "User-Agent": USER_AGENT, Accept: "application/json" } },
    (up) => {
      const chunks = [];
      up.on("data", (c) => chunks.push(c));
      up.on("end", () => {
        const body = Buffer.concat(chunks);
        if (up.statusCode === 200) {
          const exp = up.headers.expires ? new Date(up.headers.expires).getTime() : Date.now() + 30 * 60 * 1000;
          cache.set(qs, { expires: Math.max(exp, Date.now() + 5 * 60 * 1000), body });
        }
        res.writeHead(up.statusCode, { "Content-Type": "application/json", "X-Cache": "MISS" });
        res.end(body);
      });
    }
  );
  upstream.on("error", (err) => {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Klarte ikke å nå api.met.no: " + err.message }));
  });
  upstream.end();
}

function serveStatic(res, pathname) {
  const rel = pathname === "/" ? "/index.html" : pathname;
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("Ikke funnet"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname === "/api/met") return proxyMet(req, res, url);
  serveStatic(res, url.pathname);
}).listen(PORT, () => console.log(`Kartapp kjører på http://localhost:${PORT}`));
