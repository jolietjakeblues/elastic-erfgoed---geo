// Controle van een Elasticsearch-service met geo-mapping (triply/elastic-service-geo.json).
// Gebruik: node tests/geo-service.mjs [servicenaam]   (standaard Erfgoed-sdo-geo)
import { readFile } from 'node:fs/promises';
const service = process.argv[2] ?? 'Erfgoed-sdo-geo';
const ENDPOINT = `https://api.linkeddata.cultureelerfgoed.nl/datasets/rce/erfgoed-sdo/services/${service}/_search`;
const WKT = 'http://www opengis net/ont/geosparql#asWKT';
const BASE = 'https://linkeddata.cultureelerfgoed.nl/cho-kennis/id/';
async function search(body) {
  const response = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(data).slice(0, 400)}`);
  return data;
}
const total = async query => (await search({ size: 0, track_total_hits: true, query })).hits.total.value;
console.log(`Service: ${ENDPOINT}`);
// 1. Hoeveel documenten hebben een bruikbare geometrie? (WKT die Elasticsearch weigert valt weg door ignore_malformed.)
const all = await total({ match_all: {} });
const geo = await total({ exists: { field: WKT } });
console.log(`Documenten: ${all}, met geo_shape: ${geo} (verwacht ca. 66.250: alles behalve archeologische terreinen)`);
// 2. Rijksmonumenten en complexen in een gebied, met de vorm van het gebied als zoekvorm.
const { gebieden } = JSON.parse(await readFile(new URL('../web/data/gebieden.json', import.meta.url), 'utf-8'));
for (const [soort, nummer] of [['gezicht', '1325'], ['werelderfgoed', '818'], ['werelderfgoed', '1349']]) {
  const g = gebieden.find(item => item.soort === soort && item.nummer === nummer);
  // indexed_shape werkt niet: de WKT staat in _source als lijst ("shape must be an object…"). Daarom de vorm zelf meesturen.
  const shape = [(await search({ size: 1, query: { term: { '@id.keyword': g.id } }, _source: [WKT] })).hits.hits[0]._source[WKT]].flat()[0];
  const inside = relation => total({ bool: { filter: [
    { geo_shape: { [WKT]: { shape, relation } } },
    { bool: { should: ['rijksmonument', 'complex'].map(s => ({ prefix: { '@id.keyword': `${BASE}${s}/` } })), minimum_should_match: 1 } }
  ] } });
  console.log(`${g.naam}: intersects ${await inside('intersects')}, within ${await inside('within')}; vooraf berekend ${g.rijksmonument.length + g.complex.length}`);
}
// 3. Binnen 500 m van de Dom in Utrecht (geo_distance op een geo_shape-veld vraagt Elasticsearch 8.x).
try {
  console.log(`Binnen 500 m van de Domtoren: ${await total({ geo_distance: { distance: '500m', [WKT]: { lat: 52.0907, lon: 5.1214 } } })}`);
} catch (error) { console.log(`geo_distance op geo_shape werkt niet op deze versie: ${error.message.slice(0, 200)}`); }
// 4. Sorteren op nummer als getal.
const sorted = await search({ size: 5, query: { prefix: { '@id.keyword': `${BASE}rijksmonument/` } }, sort: [{ 'https://schema org/identifier.getal': 'asc' }], _source: ['https://schema org/identifier'] });
console.log(`Laagste rijksmonumentnummers: ${sorted.hits.hits.map(hit => hit._source['https://schema org/identifier']).join(', ')}`);
