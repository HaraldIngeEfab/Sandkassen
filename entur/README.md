# Nærmeste stoppested

Statisk webapp som bruker Enturs åpne API-er til å finne nærmeste stoppested fra et stedssøk
og vise nøkkeldata og avganger i sanntid. Ingen byggesteg, ingen avhengigheter, ingen nøkler.

| Hva | Tjeneste |
|---|---|
| Stedssøk med forslag (adresser, steder, stoppesteder) | Entur Geocoder, `api.entur.io/geocoder/v1/autocomplete` |
| Nærmeste stoppesteder fra et punkt | Entur Journey Planner v3 (GraphQL), `nearest`-spørring |
| Nøkkeldata, avganger, avvik | Entur Journey Planner v3, `stopPlace`-spørring med `estimatedCalls` |

## Funksjoner

- Skriv inn et sted og velg blant forslag (piltaster og Enter virker), eller trykk **Min posisjon**.
- Appen finner stoppesteder med avganger innen 2 km og viser det nærmeste.
- Nøkkeldata: avstand, neste avgang, linjer som betjener stoppet, plattformer, operatør og NSR-ID.
- Avgangstavle med linjefarger, destinasjon og via, plattform, forventet tid, forsinkelse,
  sanntidsmarkør og innstilte avganger. Avviksmeldinger vises øverst.
- Oppdaterer automatisk hvert 30. sekund mens siden er synlig.
- Andre stoppesteder i nærheten kan velges med ett trykk.
- Søket legges i URL-en (`#lat=…&lon=…&name=…`), så siden kan deles og lastes på nytt.
- Lenker til Enturs reiseplanlegger og til kart.

## Kjør lokalt

Åpne `index.html` direkte i nettleseren, eller server mappen:

```sh
cd entur && python3 -m http.server 8000   # http://localhost:8000
```

## Publisering

Arbeidsflyten i `.github/workflows/pages.yml` publiserer hele repoet (startside, `kartapp/` og `entur/`) til GitHub Pages ved push til `main`.
Første gang må Pages slås på i repoet: **Settings → Pages → Source: GitHub Actions**.
Appen blir da tilgjengelig på `https://<bruker>.github.io/<repo>/entur/`.

## Om API-ene

Entur krever headeren `ET-Client-Name` på alle kall; appen sender `haraldingeefab-sandkassen-naermeste-stopp`.
Dataene er lisensiert under NLOD. Se [developer.entur.org](https://developer.entur.org/).
