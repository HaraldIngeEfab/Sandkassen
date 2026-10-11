# Norgeskart med vær

En enkel kartapp bygget på åpne norske datatjenester:

| Hva | Tjeneste |
|---|---|
| Bakgrunnskart (topo, gråtone, raster) | Kartverkets cache-tjeneste via Geonorge (`cache.kartverket.no`) |
| Stedsnavnsøk | `ws.geonorge.no/stedsnavn/v1/navn` |
| Kommune og fylke for et punkt | `ws.geonorge.no/kommuneinfo/v1/punkt` |
| Høyde over havet for et punkt | `ws.geonorge.no/hoydedata/v1/punkt` |
| Værvarsel | MET Norge / Yr, `api.met.no/weatherapi/locationforecast/2.0/compact` |

## Funksjoner

- Værmarkører (symbol og temperatur) for et utvalg byer, kan slås av og på.
- Klikk hvor som helst i kartet for vær akkurat der, med kommune, fylke og høyde fra Geonorge.
  Høyden sendes med til Yr for mer presis temperatur i fjellet.
- Søk etter stedsnavn, zoom til treffet og få værvarsel for stedet.
- «Min posisjon» bruker nettleserens geolokasjon.
- Popup viser nå-vær, vind, nedbør, fuktighet, trykk og de neste seks timene.
- **Simuler vær i utsnittet**: henter varsler for et rutenett av inntil 20 punkter i det synlige
  kartutsnittet og spiller av de neste tre døgnene time for time. Hver rute farges etter temperatur,
  viser værsymbol, vindpil og nedbørsmengde, og får blå kant når det er nedbør. Tidslinjen kan dras,
  farten kan endres, og mellomrom, piltaster og Esc styrer avspillingen. «Nytt utsnitt» henter på nytt
  for der du har flyttet kartet.

## Kjøre

Enklest, med Node (ingen avhengigheter):

```sh
cd kartapp
node server.js
# åpne http://localhost:8080
```

Serveren videresender værkall til `api.met.no` med en identifiserende `User-Agent`,
slik MET krever i sine [bruksvilkår](https://api.met.no/doc/TermsOfService), og cacher svarene
i tråd med `Expires`-headeren. Sett gjerne egen identifikasjon:

```sh
MET_USER_AGENT="minapp/1.0 kontakt@example.com" node server.js
```

Appen fungerer også som rene statiske filer (f.eks. `python3 -m http.server` i `kartapp/`,
eller ved å åpne `index.html` direkte). Da kalles `api.met.no` direkte fra nettleseren
(API-et har åpen CORS), men da kan ikke egen `User-Agent` sendes.

## Lisenser

- Kartdata: © Kartverket, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- Værdata: © MET Norge, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) / NLOD
- Leaflet lastes fra unpkg (BSD-2).
