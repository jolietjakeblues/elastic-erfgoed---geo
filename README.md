# Erfgoed SDO/Elastic demo

> **Dit is een demo.** Bouw hier geen applicaties of andere afhankelijkheden op. De scripts, index en service kunnen zonder aankondiging wijzigen of verdwijnen.

Een webdemo die laat zien wat Elasticsearch bovenop de SDO/Linked Data-publicatie van de RCE-dataset `erfgoed-sdo` mogelijk maakt. In één index staan rijksmonumenten, complexen, archeologische terreinen, beschermde stads- en dorpsgezichten en werelderfgoed. De demo kan fulltext en Booleaans zoeken, facetten tonen (ook per soort), relaties volgen, en **ruimtelijk zoeken**: wat ligt er in een gezicht of werelderfgoed, en wat ligt er in de buurt van een monument. Er is een kaart en elk resultaat linkt naar Linked Data en het register.

Opvolger van de [Rijksmonumenten-demo](https://rijksmonumenten-sdo-elastic-demo.jolietjakeblues64.workers.dev/) ([repo](https://github.com/jolietjakeblues/elastic)). Zoeksyntax, facetlogica, deelbare URL, CSV-export, huisstijl en begrenzing werken hetzelfde. Hieronder staat vooral wat er anders is.

Voorbeelden (achter de URL van de demo plakken):

- Alles in beschermd gezicht Orvelte: `?binnen=gezicht:1325`
- Rijksmonumenten in werelderfgoed Kinderdijk: `?binnen=werelderfgoed:818&soort=rijksmonument`
- pakhuis in de Amsterdamse Grachtengordel: `?q=pakhuis&binnen=werelderfgoed:1349`
- de onderdelen van complex Buitenplaats Eemwijk: `?binnen=complex:524444`
- rijksmonumenten binnen 500 m van rijksmonument 36075 (Domplein, Utrecht): `?binnen=rond:rijksmonument:36075:500&soort=rijksmonument`
- forten in de Hollandse Waterlinies, op nummer: `?q=fort&binnen=werelderfgoed:759&sorteer=nummer`

## Services

```text
POST https://api.linkeddata.cultureelerfgoed.nl/datasets/rce/erfgoed-sdo/services/Erfgoed-sdo-geo/_search
```

De browser praat rechtstreeks met de Elasticsearch-service, want die staat CORS toe (`Access-Control-Allow-Origin: *`). Er wordt geen SPARQL gebruikt.

De demo gebruikt de service **`Erfgoed-sdo-geo`**, niet de standaardservice `Erfgoed-sdo`. Het verschil zit in een index template (zie *Ruimtelijk zoeken*).

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

### Binnen een gezicht, werelderfgoed of complex, of in de buurt

Met het veld **Binnen gezicht of werelderfgoed**, of met de knoppen bij een resultaat, wordt een *context* gekozen. Die komt als `filter` in de `query` en beperkt dus ook alle facetten. De zoekvraag werkt binnen die context.

| Context | URL-parameter | Elasticsearch |
|---|---|---|
| Gezicht of werelderfgoed | `binnen=gezicht:1325`, `binnen=werelderfgoed:818` | `geo_shape` met het vlak van het gebied, `relation: within` (helemaal binnen het vlak), zonder het gebied zelf |
| Complex | `binnen=complex:524444` | `terms` op `@id.keyword` met de URI's uit `schema:hasPart` |
| In de buurt | `binnen=rond:rijksmonument:36075:500` (100, 250, 500, 1000 of 2000 m) | `geo_distance` vanaf het (zwaarte)punt van het object, zonder het object zelf |

Het vlak van het gebied gaat in de query mee, want `indexed_shape` werkt hier niet (zie *Ruimtelijk zoeken*). De mediaan is 3 kB per gebied. De grootste zijn de Hollandse Waterlinies (850 kB, ca. 0,4 s) en de Waddenzee (210 kB).

Op de kaart staat het gekozen gebied of complex, of de cirkel, als zwarte stippellijn.

### Relaties bij elk resultaat

| Bij | Wordt getoond | Hoe |
|---|---|---|
| Rijksmonument | *Onderdeel van* complex | omgekeerd zoeken: complexen met `hasPart.keyword` = deze URI |
| Rijksmonument | *Archeologische terreinen* | `containsPlace` |
| Archeologisch terrein | *Ligt in* rijksmonument | `containedInPlace` |
| Complex | *Onderdelen* + knop **Toon onderdelen** | `hasPart` |
| Rijksmonument, complex | *Ligt in* gezicht/werelderfgoed | `geo_shape` met `relation: contains`, zie hieronder |
| Gezicht, werelderfgoed | knop **Toon wat erin ligt** | context `geo_shape within` |
| Rijksmonument, complex | knop **In de buurt** | context `geo_distance`, 500 m |

Namen en nummers van gerelateerde objecten komen voor de hele pagina uit **één** extra request (`terms` op `@id.keyword` en op `hasPart.keyword`).

*Ligt in* is ook één request voor de hele pagina. Per rijksmonument of complex is er een benoemde query (`_name`) die zoekt naar gezichten en werelderfgoed waarvan het vlak dat object bevat. Elasticsearch geeft bij elk gevonden gebied in `matched_queries` terug bij welke objecten het hoort:

```json
{ "bool": {
  "filter": [ /* soort gezicht of werelderfgoed */ ],
  "should": [ { "geo_shape": { "http://www opengis net/ont/geosparql#asWKT": { "shape": "Polygon ((…))", "relation": "contains" }, "_name": "<URI van het monument>" } } ],
  "minimum_should_match": 1 } }
```

### Blok "In gezicht of werelderfgoed"

Telt voor de huidige zoekactie hoeveel resultaten in elk gezicht of werelderfgoed liggen, bijvoorbeeld in welke gebieden de meeste molens staan (`?q=molen&soort=rijksmonument`, blok openklappen). Dit is één `filters`-aggregation met een bucket per gebied. Dit onderdeel gebruikt nog de **vooraf berekende koppeling** (zie hieronder): met de vlakken zelf zou de request ca. 5 MB zijn, met de nummers 0,5 MB (ca. 0,7 s). Daarom wordt er ook alleen geteld als het blok openstaat. De aantallen kunnen iets afwijken van *binnen*-zoeken. Klikken op een gebied zoekt binnen dat gebied, met dezelfde zoekvraag.

### Overig

- Standaard wordt in **Alles** gezocht, omdat gezichten en werelderfgoed geen omschrijving hebben. Nieuw zoekveld: **Nummer**.
- Nieuwe sorteringen **Soort** (op `@id.keyword`) en **Nummer** (op `identifier.getal`, een `long`-subveld uit de index template).
- Resultaten hebben een gekleurd label per soort, ook op de kaart. Rijksmonumenten zonder naam krijgen type en adres als kop.
- Registerlinks: Monumentenregister, Kennisbank RCE (gezichten) en UNESCO (werelderfgoed). Andere domeinen worden niet getoond.
- CSV heeft extra kolommen **Soort** en **Ligt in gezicht/werelderfgoed**.

## Ruimtelijk zoeken

De standaardservice `Erfgoed-sdo` kan niet ruimtelijk zoeken. Daar is `geo:asWKT` als `text` geïndexeerd, en het veld `geoShape` bestaat wel als geo-veld maar is bij 0 documenten gevuld. Er is ook geen relatie tussen een monument en het gezicht of werelderfgoed waarin het ligt; de CEO-ontologie kent zo'n property niet.

Daarom is er een tweede service, **`Erfgoed-sdo-geo`**, aangemaakt met een index template (`triply/elastic-service-geo.json`), volgens de [TriplyDB-documentatie](https://docs.triply.cc/triply-api/#setting-up-index-templates):

- `geo:asWKT` wordt een `geo_shape` (met `ignore_malformed`);
- `identifier` krijgt een subveld `getal` van het type `long`, zodat sorteren op nummer kan.

Aanmaken gebeurt met een token met *Management access*; een leestoken geeft `Unauthorized`. In PowerShell:

```bash
curl.exe -H "Authorization: Bearer $env:TRIPLY_TOKEN" -H "Content-Type: application/json" -X POST "https://api.linkeddata.cultureelerfgoed.nl/datasets/rce/erfgoed-sdo/services" -d "@triply/elastic-service-geo.json"
```

Templates worden alleen bij het aanmaken gelezen. Een wijziging betekent: service opnieuw aanmaken.

Controle met `node tests/geo-service.mjs` (9 oktober 2026):

| Controle | Resultaat |
|---|---|
| Documenten met geo_shape | 66.254 van 68.078 (alles behalve 1.806 archeologische terreinen en 18 objecten zonder bruikbare WKT) |
| Orvelte / Kinderdijk / Grachtengordel, `within` | 21 / 22 / 3.357, gelijk aan de vooraf berekende koppeling |
| Zelfde, `intersects` | 22 / 22 / 3.358 |
| Binnen 500 m van de Domtoren | 799 |
| Sorteren op `identifier.getal` | 1, 2, 3, 4, 5 |

**Niet gelukt:** `indexed_shape`, waarbij je met het document-id naar het vlak van een gezicht verwijst. Dat geeft *shape must be an object consisting of type and coordinates*, omdat de WKT in `_source` als lijst staat. Daarom gaat het vlak zelf mee in de query.

### Vooraf berekende koppeling (alleen nog voor de telling per gebied)

`scripts/build_gebieden.py` (Python + shapely) berekent welke rijksmonumenten en complexen in welk gebied liggen en schrijft dat naar `web/data/gebieden.json` (437 kB). Dit is nodig voor het blok *In gezicht of werelderfgoed* en de CSV-kolom *Ligt in*. Regel: een punt op het object ligt in het vlak, of minstens een kwart van het object overlapt, of het gebied ligt voor de helft in het object. Opnieuw bouwen na een nieuwe versie van de index:

```bash
pip install shapely
```

```bash
npm run gebieden
```

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

`npm test` test queryopbouw, soort-, gebied- en afstandsfilters, URL, uitleg en CSV zonder netwerk. `npm run test:live` test tegen de echte service: CORS, de soort-facet (som = totaal), het soortfilter, "binnen Orvelte" met `geo_shape` (aantal = koppeling), zoeken binnen de Amsterdamse binnenstad, 500 m rond een monument, *ligt in* met benoemde queries, sorteren op nummer, de telling per gebied en de relatie complex ↔ onderdeel. `node tests/geo-service.mjs` controleert de geo-service zelf.

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
| `triply/elastic-service-geo.json` | Config van de Elasticsearch-service met geo-mapping |
| `web/data/gebieden.json` | Vooraf berekende koppeling, alleen voor de telling per gebied en de CSV |
| `scripts/build_gebieden.py` | Bouwt `gebieden.json` |
| `tests/geo-service.mjs` | Controle van de geo-service |

## Bekende beperkingen

- *Binnen een gebied* betekent: helemaal binnen het vlak (`within`). Een monument dat over de grens ligt telt niet mee. Of dat overeenkomt met de juridische aanwijzing moet de RCE beoordelen.
- De telling per gebied en de CSV-kolom *Ligt in* gebruiken nog de vooraf berekende koppeling. Na een nieuwe versie van de index moet `gebieden.json` opnieuw gebouwd worden.
- Bij de Hollandse Waterlinies gaat er 850 kB vlak mee in elke zoekactie.
- Archeologische terreinen hebben geen geometrie en staan dus niet op de kaart. Ze zijn wel te vinden via het rijksmonument waarin ze liggen.
- De kaart toont alleen de resultaten van de huidige pagina (25).
