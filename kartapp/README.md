# Norgeskart med vær

En enkel kartapp bygget på åpne norske datatjenester:

| Hva | Tjeneste |
|---|---|
| Bakgrunnskart (topo, gråtone, raster) | Kartverkets cache-tjeneste via Geonorge (`cache.kartverket.no`) |
| Satellitt | Esri World Imagery (Maxar m.fl.) og Sentinel-2 cloudless fra EOX, fritt kombinert med Kartverkets kart over |
| Stedsnavnsøk | `ws.geonorge.no/stedsnavn/v1/navn` |
| Kommune og fylke for et punkt | `ws.geonorge.no/kommuneinfo/v1/punkt` |
| Høyde over havet for et punkt | `ws.geonorge.no/hoydedata/v1/punkt` |
| Værvarsel | MET Norge / Yr, `api.met.no/weatherapi/locationforecast/2.0/compact` |
| Turisthytter | OpenStreetMap via Overpass API (`tourism=alpine_hut`, `wilderness_hut`, enkle buer) |
| Turmål | OpenStreetMap via Overpass API (`natural=peak` med navn, `tourism=viewpoint`) |
| Stier | Waymarked Trails (OSM-vandreruter som fliselag) eller Kartverkets WMS «Tur- og friluftsruter» |
| 3D-terreng | AWS Terrain Tiles (Mapzen Terrarium, ca. 30 m oppløsning) vist med MapLibre GL JS |
| Ruter mellom hytter | BRouter (`brouter.de`, profil `hiking-mountain`) på OpenStreetMap-data |

## Funksjoner

- Værmarkører (symbol og temperatur) for et utvalg byer, kan slås av og på.
- Klikk hvor som helst i kartet for vær akkurat der, med kommune, fylke og høyde fra Geonorge.
  Høyden sendes med til Yr for mer presis temperatur i fjellet.
- Søk etter stedsnavn, zoom til treffet og få værvarsel for stedet.
- «Min posisjon» bruker nettleserens geolokasjon.
- Zoomnivå og målestokk vises nede til venstre, og zoomnivå også i 3D-panelet.
- **Turisthytter**: hentes fra OpenStreetMap for utsnittet på alle zoomnivåer. Utzoomet klumpes hytter
  som ligger tett sammen i sirkler med antall, trykk på en klump for å zoome inn på den. Enkle buer og
  gapahuker hentes først fra zoomnivå 9, siden det er svært mange av dem. Rød er betjent, brun er
  selvbetjent eller ubetjent, grønn er enkel bu.
  Popup viser operatør, senger, betaling, booking og lenker til nettside, UT.no og OSM, pluss «Vær her».
- **Bakgrunn**: velg satellittbilde (ingen, Esri eller Sentinel-2) og kart (topografisk, gråtone, raster
  eller ingen) hver for seg. Glideren «Kart over satellitt» styrer hvor mye kartet dekker over bildet,
  fra rent satellittbilde til rent kart. Valgene huskes i nettleseren og gjelder også i 3D.
- **3D**: knappen åpner samme utsnitt som 3D-kart med terreng. Kartverkets kartfliser draperes over
  høydemodellen, og vær-, hytte- og stilagene som er slått på følger med. Tilt og roter med to fingre
  på nettbrett eller høyreklikk og dra på PC. Glideren styrer hvor mye terrenget overdrives.
  MapLibre lastes først når knappen brukes. «Tilbake til 2D» tar med seg posisjonen tilbake.
- **Turmål**: navngitte fjelltopper og utsiktspunkter fra OpenStreetMap. Utzoomet vises bare topper over
  2000 m, så 1500 m og 1000 m, og fra zoomnivå 12 alle navngitte topper og utsiktspunkter. Popupen viser
  høyde, primærfaktor og Wikipedia-lenke når det finnes. Turmål kan velges som start eller mål for turer.
- Vær, turisthytter, turmål og stier kan slås av og på også mens 3D-kartet er åpent, og hentes for det
  utsnittet du beveger deg til i 3D.
- **Tur mellom hytter og turmål**: velg «Start tur her» i én hyttepopup og «Tur hit» i en annen. Ruten beregnes
  langs stier med BRouter og tegnes på kartet med lengde, stigning, fall og anslått tid etter Naismiths
  regel. Finner ikke BRouter noen sti, brukes rett linje og det sies fra. «Fly turen i 3D» åpner
  3D-kartet og lar kameraet følge stien fra start til mål med høydeprofil, framdriftsglider, fart og pause.
  Mellomrom pauser, og å dra i kartet stopper flygingen så du kan se deg rundt.
- **Rundtur i 3D**: fra popupen til en hytte eller et turmål, eller fra turpanelet når et mål er valgt.
  Kameraet går ned mot målet ovenfra og kretser så rundt det med blikket mot målet. Fart og avstand kan
  justeres, mellomrom pauser, og å dra i kartet stopper runden så du kan se deg om.
- **Stier**: fliselag med vandreruter fra Waymarked Trails (OpenStreetMap), eller Kartverkets nasjonale
  database for tur- og friluftsruter som WMS. Kartverkets topografiske kart viser dessuten merkede stier
  når du zoomer langt inn.
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
- Satellitt: Esri World Imagery etter [Esris vilkår](https://www.esri.com/en-us/legal/terms/full-master-agreement)
  med kreditering, og [Sentinel-2 cloudless](https://s2maps.eu) by EOX, CC BY-NC-SA 4.0 (ikke-kommersiell bruk).
- Værdata: © MET Norge, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) / NLOD
- Hytter og stier: © OpenStreetMap-bidragsytere, [ODbL](https://www.openstreetmap.org/copyright).
  Overpass API og Waymarked Trails er frivillig drevne tjenester, så vær nøktern med trafikken.
- Terreng: [Mapzen / AWS Terrain Tiles](https://github.com/tilezen/joerd/blob/master/docs/attribution.md),
  satt sammen av SRTM, EU-DEM og andre åpne kilder.
- Leaflet og MapLibre GL JS lastes fra unpkg (BSD-2 og BSD-3).
