# Erfgoed SDO/Elastic demo

> **Dit is een demo.** Bouw hier geen applicaties of andere afhankelijkheden op. De scripts, index en service kunnen zonder aankondiging wijzigen of verdwijnen.

Een webdemo die laat zien wat Elasticsearch bovenop de SDO/Linked Data-publicatie van de RCE-dataset `erfgoed-sdo` mogelijk maakt. In één index staan rijksmonumenten, complexen, archeologische terreinen, beschermde stads- en dorpsgezichten en werelderfgoed. De demo kan fulltext en Booleaans zoeken, facetten tonen (ook per soort), relaties volgen, en **ruimtelijk zoeken**: wat ligt er in een gezicht of werelderfgoed, en wat ligt er in de buurt van een monument. Er is een kaart en elk resultaat linkt naar Linked Data en het register.

Opvolger van de [Rijksmonumenten-demo](https://rijksmonumenten-sdo-elastic-demo.jolietjakeblues64.workers.dev/) ([repo](https://github.com/jolietjakeblues/elastic)). Zoeksyntax, facetlogica, deelbare URL, CSV-export, huisstijl en begrenzing werken hetzelfde. Hieronder staat vooral wat er anders is.

**Online:** <https://erfgoed-sdo-elastic-demo.jolietjakeblues64.workers.dev/>

Voorbeelden:

- [Alles in beschermd gezicht Orvelte](https://erfgoed-sdo-elastic-demo.jolietjakeblues64.workers.dev/?binnen=gezicht:1325)
- [Rijksmonumenten in werelderfgoed Kinderdijk](https://erfgoed-sdo-elastic-demo.jolietjakeblues64.workers.dev/?binnen=werelderfgoed:818&soort=rijksmonument)
- [pakhuis in de Amsterdamse Grachtengordel](https://erfgoed-sdo-elastic-demo.jolietjakeblues64.workers.dev/?q=pakhuis&binnen=werelderfgoed:1349)
- [De onderdelen van complex Buitenplaats Eemwijk](https://erfgoed-sdo-elastic-demo.jolietjakeblues64.workers.dev/?binnen=complex:524444)
- [Rijksmonumenten binnen 500 m van rijksmonument 36075 (Domplein, Utrecht)](https://erfgoed-sdo-elastic-demo.jolietjakeblues64.workers.dev/?binnen=rond:rijksmonument:36075:500&soort=rijksmonument)
- [Forten in de Hollandse Waterlinies, op nummer](https://erfgoed-sdo-elastic-demo.jolietjakeblues64.workers.dev/?q=fort&binnen=werelderfgoed:759&sorteer=nummer)
- [Terpen en wierden in Groningen en Friesland (archeologische monumenten met hun terreinen)](https://erfgoed-sdo-elastic-demo.jolietjakeblues64.workers.dev/?q=terp+OR+wierde&categorie=archeologisch&provincie=Groningen&provincie=Friesland)
- [Archeologische monumenten in de Neder-Germaanse Limes](https://erfgoed-sdo-elastic-demo.jolietjakeblues64.workers.dev/?binnen=werelderfgoed:1631&categorie=archeologisch)

## Services

```text
POST https://api.linkeddata.cultureelerfgoed.nl/datasets/rce/erfgoed-sdo/services/Erfgoed-sdo-nl3/_search
```

De browser praat rechtstreeks met de Elasticsearch-service, want die staat CORS toe (`Access-Control-Allow-Origin: *`). Er wordt geen SPARQL gebruikt.

De demo gebruikt de service **`Erfgoed-sdo-nl3`**, niet de standaardservice `Erfgoed-sdo`. Het verschil zit in een index template: ruimtelijk zoeken, sorteren op nummer, de soort als eigen veld en Nederlandse taalverwerking (zie *Ruimtelijk zoeken* en *Nederlandse taalverwerking*).

| Service | Index template | Status |
|---|---|---|
| `Erfgoed-sdo` | geen (standaard van TriplyDB) | niet meer gebruikt door de demo |
| `Erfgoed-sdo-geo` | `triply/elastic-service-geo.json`: geometrie, nummer | vorige versie van de demo |
| `Erfgoed-sdo-nl` | `triply/elastic-service-nl.json`: + taal, soort (versie 1) | test, kan weg |
| `Erfgoed-sdo-nl2` | `triply/elastic-service-nl2.json` (versie 2) | test, kan weg zodra `-nl3` live goed draait |
| `Erfgoed-sdo-nl3` | `triply/elastic-service-nl3.json` (versie 3) | **gebruikt door de demo** |

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

Een gewone `terms`-aggregation en `terms`-filter op het veld `@id.soort`. Dat veld bestaat niet in de data: de index template maakt het met een normalizer die de soort uit de URI haalt (`…/id/complex/63921` wordt `complex`):

```json
"normalizer": { "soort": { "type": "custom", "char_filter": ["soort_uit_uri"], "filter": ["lowercase"] } },
"char_filter": { "soort_uit_uri": { "type": "pattern_replace", "pattern": "^.*/id/([a-z]+)/.*$", "replacement": "$1" } }
```

Gecontroleerd: per soort gelijk aan een `prefix`-query op `@id.keyword` (63.099 / 2.689 / 1.806 / 472 / 12). In een eerdere versie van de demo was dit een `filters`-aggregation met vijf prefix-queries.

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

- Standaard wordt in **Alles** gezocht, omdat gezichten en werelderfgoed geen omschrijving hebben. Nieuwe zoekvelden: **Nummer** en **Exact** (zonder meervoud, samenstellingen en synoniemen).
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

## Nederlandse taalverwerking

De index template van `Erfgoed-sdo-nl3` (`triply/elastic-service-nl3.json`) geeft alle tekstvelden een eigen analyzer (via `dynamic_templates`):

| Bij indexeren (`nl_index`) | Bij zoeken (`nl_zoeken`) |
|---|---|
| kleine letters, accenten weg (`asciifolding`) | idem |
| samenstellingen splitsen (`dictionary_decompounder`, 32 erfgoedwoorden) | |
| vaste meervoudsregels (`stemmer_override`) | idem |
| | synoniemen en zoekuitbreiding (`synonym_graph`) |
| Nederlandse stopwoorden, stemmer `dutch_kp` | idem |

- **Meervoud:** `dutch_kp` mist een aantal meervouden. Zeven vaste regels vangen dat op: `molen, molens => molen`, en hetzelfde voor toren, kasteel, gracht, sluis, dijk en woning.
- **Kerk en dijk** worden niet opgesplitst. Dat raakt ook Lekkerkerk, Nijkerk, Soestdijk en zelfs "linkerkant". In plaats daarvan breidt de zoekanalyzer ze in één richting uit met samenstellingen die in de data voorkomen: `kerk` en `godshuis` zoeken ook op kerkgebouw, parochiekerk, dorpskerk, kruiskerk, zaalkerk, hallenkerk, schuilkerk en kerktoren; `dijk` ook op liniedijk, lekdijk, zeedijk, maasdijk, waaldijk, rivierdijk, kanaaldijk, ijsseldijk, lingedijk, grebbeliniedijk en spoordijk.
- **Huis** wordt bewust niet opgesplitst: `*huis*` komt voor in 45.034 van de 68.078 documenten (woonhuis, trappenhuis, voorhuis).
- **Adres, plaats, provincie en postcode** krijgen alleen kleine letters en `asciifolding`. Anders levert `kerk` ook Lekkerkerk en de Kerkstraat op.
- Elk tekstveld heeft een subveld `.exact` (alleen kleine letters en accenten). Dat is de optie **Exact** in de demo.
- `.keyword` blijft voor facetten en sorteren.
- Valkuil: een component template wordt los gevalideerd. Een mapping die een normalizer of analyzer gebruikt, moet in hetzelfde component template staan als de `settings` die hem definiëren.

### Vergelijking

Met `node tests/compare-services.mjs` (9 oktober 2026), in het zoekveld Alles:

| Zoekvraag | `-geo` | `-nl2` | `-nl3` | |
|---|---:|---:|---:|---|
| `ruine` / `ruïne` | 51 / 99 | 147 / 147 | 147 / 147 | accenten tellen niet mee |
| `molen` / `molens` | 1.386 / 67 | 2.100 / 143 | 2.100 / 2.108 | samenstellingen en meervoud |
| `toren` / `torens` | 2.964 / 403 | 5.668 / 1.004 | 5.667 / 5.666 | |
| `kasteel` / `kastelen` | 1.412 / 592 | 1.711 / 592 | 2.231 / 2.215 | |
| `woning` / `woningen` | 2.898 / 2.238 | 37.992 / 9.037 | 37.752 / 37.752 | synoniem woonhuis, nu ook bij meervoud |
| `boerderij` / `boerderijen` | 8.267 / 392 | 8.833 / 8.782 | 8.833 / 8.782 | |
| `kerk` | 4.521 | 4.617 | 4.780 | ook parochiekerk, dorpskerk, … |
| `godshuis` | 18 | 4.587 | 4.751 | synoniem; bovenaan echte kerken |
| `dijk` | 782 | 878 | 1.174 | ook liniedijk, zeedijk, … |
| `kasteel AND gracht` | 188 | 537 | 571 | ook slotgracht, kasteelgracht |
| `linkerkant`, `Nijkerk`, `Soestdijk`, `Lekkerkerk`, `Kerkstraat` | | 154, 115, 37, 20, 1.192 | gelijk | namen niet geraakt |
| `Orvelte`, `Domplein` | 23, 14 | 23, 14 | 23, 14 | |

Gracht/grachten (3.023 / 2.843) en sluis/sluizen (1.090 / 1.020) lijken nog te verschillen. In naam, omschrijving en type zijn ze gelijk; het enkelvoud vindt daarnaast straatnamen als "Oude Gracht" en "Oude Sluis". Dat is terecht.

### Geschiedenis

- **Versie 1** (`Erfgoed-sdo-nl`): Snowball-stemmer `dutch` en een langere samenstellingslijst. `molen` (stam `mol`) en `molens` (stam `molen`) vonden elkaar niet, en `kerk` vond 3.044 adressen, vooral in Lekkerkerk.
- **Versie 2** (`Erfgoed-sdo-nl2`): stemmer `dutch_kp`, adresvelden zonder taalverwerking, kerk/huis/dijk uit de samenstellingslijst. Daardoor vond `kerk` geen dorpskerk meer en bleven zeven meervouden ongelijk.
- **Versie 3** (`Erfgoed-sdo-nl3`): vaste meervoudsregels en zoekuitbreiding voor kerk en dijk.

### Nog te verbeteren

- **Volgorde:** bij `molens` staan een stadsmuur en woonhuizen bovenaan. Het aantal klopt, de rangorde niet. Oplossing in de demo: naam en type zwaarder laten wegen in de query (bijv. `name^3`, `additionalType^3`), geen nieuwe service.
- Synoniemen uit de CHT-thesaurus in plaats van de huidige 9 regels.

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

Net als de vorige demo: een Cloudflare Worker die alleen de statische bestanden uit `web/` serveert (`wrangler.jsonc`, naam `erfgoed-sdo-elastic-demo`), online op <https://erfgoed-sdo-elastic-demo.jolietjakeblues64.workers.dev/>. De repository is gekoppeld via Workers Builds: elke push naar `main` wordt automatisch gepubliceerd, andere branches krijgen een preview-URL. Handmatig:

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
| `triply/elastic-service-nl3.json` | Config van de service die de demo gebruikt (taal, soort, geometrie, nummer) |
| `triply/elastic-service-nl.json`, `-nl2.json` | Eerdere versies, ter vergelijking |
| `tests/compare-services.mjs` | Vergelijkt twee services op dezelfde zoekvragen |

## Bekende beperkingen

- *Binnen een gebied* betekent: helemaal binnen het vlak (`within`). Een monument dat over de grens ligt telt niet mee. Of dat overeenkomt met de juridische aanwijzing moet de RCE beoordelen.
- De telling per gebied en de CSV-kolom *Ligt in* gebruiken nog de vooraf berekende koppeling. Na een nieuwe versie van de index moet `gebieden.json` opnieuw gebouwd worden.
- Bij de Hollandse Waterlinies gaat er 850 kB vlak mee in elke zoekactie.
- Archeologische terreinen hebben geen geometrie en staan dus niet op de kaart. Ze zijn wel te vinden via het rijksmonument waarin ze liggen.
- De kaart toont alleen de resultaten van de huidige pagina (25).
