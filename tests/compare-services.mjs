// Vergelijkt twee Elasticsearch-services op dezelfde zoekvragen: aantallen en de eerste treffers.
// Gebruik: node tests/compare-services.mjs [nieuw] [oud]   (standaard Erfgoed-sdo-nl tegen Erfgoed-sdo-geo)
import { searchFields, fields, soorten, BASE } from '../web/search.js';
const API = 'https://api.linkeddata.cultureelerfgoed.nl/datasets/rce/erfgoed-sdo/services';
const [nieuw = 'Erfgoed-sdo-nl', oud = 'Erfgoed-sdo-geo'] = process.argv.slice(2);
const WKT = 'http://www opengis net/ont/geosparql#asWKT';

// Bestaat de nieuwe service en is hij klaar?
const service = (await (await fetch(API)).json()).find(item => item.name === nieuw);
if (!service) { console.log(`Service ${nieuw} bestaat (nog) niet.`); process.exit(1); }
console.log(`${nieuw}: status ${service.status}, ${service.numberOfLoadedStatements ?? '?'} statements, graph-fouten ${service.numberOfGraphErrors ?? '?'}`);
if (service.status !== 'running') { console.log('Nog niet klaar met indexeren; probeer het straks opnieuw.'); process.exit(1); }

async function search(name, body) {
  const response = await fetch(`${API}/${name}/_search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) return { error: JSON.stringify(data.error?.root_cause?.[0] ?? data).slice(0, 160) };
  return data;
}
const label = source => [values(source[fields.name])[0] ?? values(source[fields.additionalType])[0] ?? '?', values(source[fields.addressLocality])[0]].filter(Boolean).join(', ');
const values = value => (Array.isArray(value) ? value : value == null ? [] : [value]);

// 1. Zoekvragen in "Alles" (zoals de demo standaard doet).
const vragen = [
  ['ruine', 'accenten: zou nu ook ruïne moeten vinden'],
  ['ruïne', 'accenten'],
  ['molens', 'stemming: meervoud'],
  ['molen', 'samenstellingen: ook windmolen, watermolen'],
  ['windmolen', 'samenstelling zelf'],
  ['godshuis', 'synoniem van kerk'],
  ['kerkhof', 'synoniem van begraafplaats'],
  ['boerderijen', 'stemming: meervoud'],
  ['"gesmeed ijzer"', 'frase blijft werken'],
  ['kasteel AND gracht', 'Booleaans'],
  ['kerk', 'samenstellingen zonder plaatsnamen'],
  ['Lekkerkerk', 'plaatsnaam (mag geen kerken opleveren)'],
  ['Kerkstraat', 'straatnaam'],
  ['linkerkant', 'bevat "kerk" maar is geen kerk'],
  ['Nijkerk', 'plaatsnaam met kerk'],
  ['dijk', 'ook liniedijk, zeedijk (niet Soestdijk)'],
  ['Soestdijk', 'plaatsnaam met dijk'],
  ['Orvelte', 'eigennaam (mag niet slechter worden)'],
  ['Domplein', 'adres (mag niet slechter worden)']
];
const rows = [];
for (const [query, why] of vragen) {
  const body = { size: 3, track_total_hits: true, _source: [fields.name, fields.additionalType, fields.addressLocality], query: { query_string: { query, fields: searchFields.Alles } } };
  const [a, b] = await Promise.all([search(oud, body), search(nieuw, body)]);
  rows.push({ query, why, oud: a.error ? `FOUT ${a.error}` : a.hits.total.value, nieuw: b.error ? `FOUT ${b.error}` : b.hits.total.value, top: b.hits?.hits.map(hit => label(hit._source)).join(' | ') ?? '' });
}
console.log(`\nZoekvragen in "Alles": ${oud} → ${nieuw}`);
console.table(rows.map(({ query, why, oud: o, nieuw: n }) => ({ zoekvraag: query, waarom: why, [oud]: o, [nieuw]: n, verschil: typeof o === 'number' && typeof n === 'number' ? (n - o >= 0 ? `+${n - o}` : `${n - o}`) : '' })));
// Enkelvoud tegen meervoud: in een goede service (bijna) gelijk. Marge 5%.
console.log(`\nEnkelvoud / meervoud in "Alles"`);
const paren = [['molen', 'molens'], ['toren', 'torens'], ['kasteel', 'kastelen'], ['gracht', 'grachten'], ['sluis', 'sluizen'], ['dijk', 'dijken'], ['woning', 'woningen'], ['kerk', 'kerken'], ['boerderij', 'boerderijen']];
const tel = async (name, query) => { const data = await search(name, { size: 0, track_total_hits: true, query: { query_string: { query, fields: searchFields.Alles } } }); return data.error ? NaN : data.hits.total.value; };
const gelijk = (x, y) => Math.abs(x - y) <= Math.max(x, y) * 0.05;
const meervoud = [];
for (const [een, meer] of paren) {
  const [oe, om, ne, nm] = await Promise.all([tel(oud, een), tel(oud, meer), tel(nieuw, een), tel(nieuw, meer)]);
  meervoud.push({ paar: `${een} / ${meer}`, [oud]: `${oe} / ${om} ${gelijk(oe, om) ? 'gelijk' : 'VERSCHIL'}`, [nieuw]: `${ne} / ${nm} ${gelijk(ne, nm) ? 'gelijk' : 'VERSCHIL'}` });
}
console.table(meervoud);
console.log('\nEerste 3 treffers in de nieuwe service:');
for (const row of rows) console.log(`  ${row.query.padEnd(20)} ${row.top}`);

// 2. Exact zoeken via het subveld .exact (zonder stemming en synoniemen, wel zonder accenten).
const exact = await search(nieuw, { size: 0, track_total_hits: true, query: { query_string: { query: 'molen', fields: [`${fields.name}.exact`, `${fields.description}.exact`] } } });
console.log(`\nExact "molen" (naam + omschrijving, .exact): ${exact.error ?? exact.hits.total.value}`);

// 3. Soort als eigen veld (@id.soort) tegen de prefix-telling.
const soortAgg = await search(nieuw, { size: 0, aggs: { soort: { terms: { field: '@id.soort', size: 10 } } } });
if (soortAgg.error) console.log(`\n@id.soort werkt niet: ${soortAgg.error}`);
else {
  console.log('\nSoort uit @id.soort (terms) tegen prefix-query:');
  for (const soort of Object.keys(soorten)) {
    const viaPrefix = (await search(nieuw, { size: 0, track_total_hits: true, query: { prefix: { '@id.keyword': `${BASE}${soort}/` } } })).hits.total.value;
    const viaVeld = soortAgg.aggregations.soort.buckets.find(bucket => bucket.key === soort)?.doc_count ?? 0;
    console.log(`  ${soort.padEnd(22)} veld ${String(viaVeld).padStart(6)}  prefix ${String(viaPrefix).padStart(6)}  ${viaVeld === viaPrefix ? 'OK' : 'VERSCHIL'}`);
  }
  const vreemd = soortAgg.aggregations.soort.buckets.filter(bucket => !Object.hasOwn(soorten, bucket.key));
  if (vreemd.length) console.log(`  Onverwachte waarden: ${vreemd.map(bucket => `${bucket.key} (${bucket.doc_count})`).join(', ')}`);
}

// 4. Wat er al werkte moet blijven werken: geometrie en sorteren op nummer.
const [geoOud, geoNieuw] = await Promise.all([oud, nieuw].map(name => search(name, { size: 0, track_total_hits: true, query: { exists: { field: WKT } } })));
console.log(`\nDocumenten met geo_shape: ${oud} ${geoOud.hits?.total.value ?? geoOud.error}, ${nieuw} ${geoNieuw.hits?.total.value ?? geoNieuw.error}`);
const laagste = await search(nieuw, { size: 3, query: { prefix: { '@id.keyword': `${BASE}rijksmonument/` } }, sort: [{ [`${fields.identifier}.getal`]: 'asc' }], _source: [fields.identifier] });
console.log(`Sorteren op identifier.getal: ${laagste.error ?? laagste.hits.hits.map(hit => values(hit._source[fields.identifier])[0]).join(', ')}`);
