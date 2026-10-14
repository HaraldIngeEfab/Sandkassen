# Sandkassen
Test

Publisert på GitHub Pages: <https://haraldingeefab.github.io/Sandkassen/> (startside med lenker til appene under).

## kartapp

Enkel kartapp med Kartverket-kart (Geonorge) og vær fra Yr. Se [kartapp/README.md](kartapp/README.md).

```sh
cd kartapp && node server.js   # http://localhost:8080
```

## entur

Nærmeste stoppested: stedssøk mot Entur og avgangstavle for nærmeste holdeplass. Se [entur/README.md](entur/README.md).
Publiseres til GitHub Pages sammen med kartappen fra `.github/workflows/pages.yml`.

```sh
cd entur && python3 -m http.server 8000   # http://localhost:8000
```
