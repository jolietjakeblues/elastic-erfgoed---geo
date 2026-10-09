# Erfgoed SDO/Elastic demo

> **Dit is een demo.** Bouw hier geen applicaties of andere afhankelijkheden op. De scripts, index en service kunnen zonder aankondiging wijzigen of verdwijnen.

Een webdemo die laat zien wat Elasticsearch bovenop de SDO/Linked Data-publicatie van de RCE-dataset `erfgoed-sdo` mogelijk maakt. In één index staan rijksmonumenten, complexen, archeologische terreinen, beschermde stads- en dorpsgezichten en werelderfgoed. De demo kan fulltext en Booleaans zoeken, facetten tonen (ook per soort), relaties volgen en tonen wat er **in een gezicht, werelderfgoed of complex** ligt. Er is een kaart en elk resultaat linkt naar Linked Data en het register.

Opvolger van de [Rijksmonumenten-demo](https://rijksmonumenten-sdo-elastic-demo.jolietjakeblues64.workers.dev/) ([repo](https://github.com/jolietjakeblues/elastic)). Zoeksyntax, facetlogica, deelbare URL, CSV-export, huisstijl en begrenzing werken hetzelfde. Hieronder staat vooral wat er anders is.

Voorbeelden (achter de URL van de demo plakken):

- Alles in beschermd gezicht Orvelte: `?binnen=gezicht:1325`
- Rijksmonumenten in werelderfgoed Kinderdijk: `?binnen=werelderfgoed:818&soort=rijksmonument`
- pakhuis in de Amsterdamse Grachtengordel: `?q=pakhuis&binnen=werelderfgoed:1349`
- de onderdelen van complex Buitenplaats Eemwijk: `?binnen=complex:524444`

## Services

```text
POST https://api.linkeddata.cultureelerfgoed.nl/datasets/rce/erfgoed-sdo/services/Erfgoed-sdo/_search
```

De browser praat rechtstreeks met de Elasticsearch-service, want die staat CORS toe (`Access-Control-Allow-Origin: *`). De SPARQL-endpoint (`…/erfgoed-sdo/sparql`) wordt door de demo niet gebruikt (zie *Ruimtelijke koppeling*).

## Inhoud van de index (oktober 2026)

| Soort | Aantal | URI-voorvoegsel | Velden en relaties |
|---|---:|---|---|
| Rijksmonument | 63.099 | `…/cho-kennis/id/rijksmonument/` | naam (zelden), adres, plaats, provincie, categorie, type, omschrijving, `schema:containsPlace` → archeologische terreinen |
| Complex | 2.689 | `…/id/complex/` | naam, plaats, type, omschrijving, `schema:hasPart` → rijksmonumenten |
| Archeologisch terrein | 1.806 | `…/id/archeologischterrein/` | naam, type, `schema:containedInPlace` → rijksmonument; **geen geometrie** |
| Beschermd gezicht | 472 | `…/id/gezicht/` | naam, nummer, categorie (bijv. "III. Het dorp"), vlak; geen adres of omschrijving |
| Werelderfgoed | 12 | `…/id/werelderfgoed/` | naam, nummer, categorie, vlak, link naar UNESCO |

Samen 68.078 documenten. De soort staat **alleen in de URI** (`@id`). `rdf:type` is voor bijna alles `schema:LandmarksOrHistoricalBuildings` en dus niet bruikbaar. Het `_id` van een document is de URI. Net als in de vorige index staat in veldnamen een spatie in plaats van een punt: `https://schema org/name`.

## Wat is er nieuw ten opzichte van de Rijksmonumenten-demo

### Facet "Soort"

Een `filters`-aggregation met per soort een `prefix`-query op `@id.keyword`. Het filter werkt op dezelfde manier: binnen de facet *of*, tussen facetten *en*.

```json
{ "bool": { "should": [
  { "prefix": { "@id.keyword": "https://linkeddata.cultureelerfgoed.nl/cho-kennis/id/complex/" } },
  { "prefix": { "@id.keyword": "https://linkeddata.cultureelerfgoed.nl/cho-kennis/id/gezicht/" } }
], "minimum_should_match": 1 } }
```

### Binnen een gezicht, werelderfgoed of complex

Met het veld **Binnen gezicht of werelderfgoed** (of de knoppen bij een resultaat) wordt een *context* gekozen. Die komt als `filter` in de `query` en beperkt dus ook alle facetten. De zoekvraag werkt gewoon binnen die context. URL-parameter: `binnen=gezicht:1325`, `binnen=werelderfgoed:818` of `binnen=complex:524444`.

- **Complex:** het complex wordt opgezocht en de URI's uit `schema:hasPart` gaan als `terms` op `@id.keyword` in de query.
- **Gezicht en werelderfgoed:** de nummers uit de ruimtelijke koppeling (zie hieronder) gaan als `terms` op `identifier.keyword`, per soort gecombineerd met het URI-voorvoegsel, want nummers zijn alleen per soort uniek. Voor de binnenstad van Amsterdam zijn dat 6.651 nummers (53 kB request, ca. 0,2 s).

Het gekozen gebied of complex wordt op de kaart als zwarte stippellijn getekend.

### Relaties bij elk resultaat

| Bij | Wordt getoond | Hoe |
|---|---|---|
| Rijksmonument | *Onderdeel van* complex | omgekeerd zoeken: complexen met `hasPart.keyword` = deze URI |
| Rijksmonument | *Archeologische terreinen* | `containsPlace` |
| Archeologisch terrein | *Ligt in* rijksmonument | `containedInPlace` |
| Complex | *Onderdelen* + knop **Toon onderdelen** | `hasPart` |
| Rijksmonument, complex | *Ligt in* gezicht/werelderfgoed | ruimtelijke koppeling |
| Gezicht, werelderfgoed | *Hierin liggen* + knop **Toon wat erin ligt** | ruimtelijke koppeling |

Namen en nummers van gerelateerde objecten komen voor de hele pagina uit **één** extra request (`terms` op `@id.keyword` en op `hasPart.keyword`).

### Blok "In gezicht of werelderfgoed"

Telt voor de huidige zoekactie hoeveel resultaten in elk gezicht of werelderfgoed liggen, bijvoorbeeld in welke gebieden de meeste molens staan (`?q=molen&soort=rijksmonument`, blok openklappen). Dit is één `filters`-aggregation met een bucket per gebied. De request is ca. 0,5 MB (alle nummers van alle gebieden) en duurt ca. 0,7 s. Daarom wordt er alleen geteld als het blok openstaat. Klikken op een gebied zoekt binnen dat gebied, met dezelfde zoekvraag.

### Overig

- Standaard wordt in **Alles** gezocht, omdat gezichten en werelderfgoed geen omschrijving hebben. Nieuw zoekveld: **Nummer**.
- Nieuwe sortering **Soort** (op `@id.keyword`).
- Resultaten hebben een gekleurd label per soort, ook op de kaart. Rijksmonumenten zonder naam krijgen type en adres als kop.
- Registerlinks: Monumentenregister, Kennisbank RCE (gezichten) en UNESCO (werelderfgoed). Andere domeinen worden niet getoond.
- CSV heeft extra kolommen **Soort** en **Ligt in gezicht/werelderfgoed**.

## Ruimtelijke koppeling

De index heeft **geen** relatie tussen een monument en het gezicht of werelderfgoed waarin het ligt. Ook de CEO-ontologie kent zo'n property niet. Ruimtelijk zoeken kan niet in deze service:

- `geo:asWKT` is als `text` geïndexeerd; `geo_shape`- en `geo_bounding_box`-queries geven een fout;
- het veld `geoShape` bestaat wel als geo-veld, maar is bij **0** documenten gevuld;
- de SPARQL-endpoint kent `geof:sfIntersects` niet ("Unknown function").

Daarom berekent `scripts/build_gebieden.py` de koppeling vooraf en schrijft die naar `web/data/gebieden.json` (437 kB, gzip veel kleiner). Een rijksmonument of complex ligt in een gebied als:

1. een punt op zijn geometrie (`point_on_surface`) binnen het vlak van het gebied valt, **of**
2. minstens een kwart van zijn vlak het gebied overlapt, **of**
3. het gebied voor minstens de helft binnen zijn vlak valt (nodig voor kleine werelderfgoederen als het Eisinga Planetarium, waarvan het vlak kleiner is dan het monumentperceel).

Resultaat bij het bouwen: 36.534 rijksmonumenten liggen in minstens één gebied, bijv. Orvelte 20 rijksmonumenten + 1 complex, Molens bij Kinderdijk-Elshout 22, Grachtengordel 3.341 + 16.

Opnieuw berekenen (na een nieuwe versie van de index):

```bash
pip install shapely
```

```bash
npm run gebieden
```

**Aanbeveling voor de index:** als Triply het veld `geoShape` vult (de mapping is er al), kan dit zonder vooraf berekende lijst, met een `geo_shape`-query met `indexed_shape` die naar het document van het gezicht verwijst. Dan is de koppeling altijd actueel en zijn ook vragen als "wat ligt binnen 500 m" mogelijk.

## Lokaal starten

Vereist Node.js 18 of nieuwer, zonder npm-dependencies.

```bash
npm start
```

Open daarna `http://127.0.0.1:4174`.

```bash
npm test
```

```bash
npm run test:live
```

`npm test` test queryopbouw, soort- en contextfilters, URL, uitleg en CSV zonder netwerk. `npm run test:live` test tegen de echte service: CORS, de soort-facet (som = totaal), het soortfilter, "binnen Orvelte" (aantal = koppeling), zoeken binnen de Amsterdamse binnenstad, de telling per gebied en de relatie complex ↔ onderdeel.

## Deployment

Net als de vorige demo: een Cloudflare Worker die alleen de statische bestanden uit `web/` serveert (`wrangler.jsonc`, naam `erfgoed-sdo-elastic-demo`). Koppel de GitHub-repository via Workers Builds, of handmatig:

```bash
npx wrangler deploy
```

## Bestanden

| Bestand | Rol |
|---|---|
| `web/search.js` | Veld-whitelist, soorten, queryopbouw (zoeken, soort, context, facetten, telling per gebied, relaties), deelbare URL, uitleg, CSV, aanroep van de service |
| `web/app.js` | Interface: resultaten met relaties, facetten, gebiedskeuze, context, kaart, export |
| `web/geo.js` | WKT naar kaartcoördinaten (ongewijzigd) |
| `web/style.css` | RCE-huisstijl, plus kleuren per soort |
| `web/data/gebieden.json` | Vooraf berekende ruimtelijke koppeling |
| `scripts/build_gebieden.py` | Bouwt `gebieden.json` |

## Bekende beperkingen

- De koppeling met gezichten en werelderfgoed is berekend, niet uit het register. Aan de randen van een gebied kan het afwijken van de officiële aanwijzing.
- Na een nieuwe versie van de index moet `gebieden.json` opnieuw gebouwd worden.
- Archeologische terreinen hebben geen geometrie en staan dus niet op de kaart. Ze zijn wel te vinden via het rijksmonument waarin ze liggen.
- De kaart toont alleen de resultaten van de huidige pagina (25).
- Sorteren op nummer kan niet (nummer is tekst in de index, scripts zijn uitgeschakeld).
