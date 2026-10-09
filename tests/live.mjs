import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildQuery, buildGebiedQuery, buildRelationQuery, gebiedClause, bucketsOf, search, ENDPOINT, BASE, fields, facets } from '../web/search.js';
import { geometryFor } from '../web/geo.js';
const timeout = () => AbortSignal.timeout(30000);
const preflight = await fetch(ENDPOINT, { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:4174', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
assert.ok(preflight.ok);
assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
const { gebieden } = JSON.parse(await readFile(new URL('../web/data/gebieden.json', import.meta.url), 'utf-8'));
const buckets = (data, key) => bucketsOf(data.aggregations[key]).buckets;
const count = (data, key, value) => buckets(data, key).find(bucket => bucket.key === value)?.doc_count ?? 0;
// Alles: de soort-facet telt op tot het totaal.
const all = await search(buildQuery({}), timeout());
const perSoort = Object.fromEntries(buckets(all, 'soort').map(bucket => [bucket.key, bucket.doc_count]));
assert.equal(Object.values(perSoort).reduce((a, b) => a + b, 0), all.hits.total.value);
for (const key of Object.keys(facets)) assert.ok(buckets(all, key).length, `Facet ${key}`);
// Soortfilter.
const werelderfgoed = await search(buildQuery({ filters: { soort: ['werelderfgoed'] } }), timeout());
assert.equal(werelderfgoed.hits.total.value, perSoort.werelderfgoed);
assert.ok(werelderfgoed.hits.hits.every(hit => hit._id.startsWith(`${BASE}werelderfgoed/`)));
// Binnen een gebied: aantal = rijksmonumenten + complexen uit de ruimtelijke koppeling.
const orvelte = gebieden.find(g => g.soort === 'gezicht' && g.nummer === '1325');
const inOrvelte = await search(buildQuery({ binnen: 'gezicht:1325' }, { clause: gebiedClause(orvelte) }), timeout());
assert.equal(inOrvelte.hits.total.value, orvelte.rijksmonument.length + orvelte.complex.length);
assert.equal(count(inOrvelte, 'soort', 'rijksmonument'), orvelte.rijksmonument.length);
const amsterdam = gebieden.find(g => g.soort === 'gezicht' && g.nummer === '1477');
const pakhuis = await search(buildQuery({ query: 'pakhuis', binnen: 'gezicht:1477' }, { clause: gebiedClause(amsterdam) }), timeout());
assert.ok(pakhuis.hits.total.value > 0 && pakhuis.hits.total.value < amsterdam.rijksmonument.length);
// Telling per gebied voor één zoekvraag.
const molens = await search(buildGebiedQuery({ query: 'molen', filters: { soort: ['rijksmonument'] } }, null, gebieden), timeout());
const top = Object.entries(molens.aggregations.gebieden.buckets).sort((a, b) => b[1].doc_count - a[1].doc_count).slice(0, 3);
assert.ok(top[0][1].doc_count > 0);
// Relaties: een complex en zijn onderdelen.
const complex = (await search(buildQuery({ query: 'buitenplaats', filters: { soort: ['complex'] } }), timeout())).hits.hits[0]._source;
const part = complex[fields.hasPart][0];
const relations = await search(buildRelationQuery([], [part]), timeout());
assert.ok(relations.hits.hits.some(hit => hit._id === complex['@id']));
const geometries = all.hits.hits.map(hit => geometryFor(hit._source)?.kind ?? 'geen');
console.log(JSON.stringify({
  cors: 'OK', totaal: all.hits.total.value, perSoort, orvelte: inOrvelte.hits.total.value, pakhuisInAmsterdam: pakhuis.hits.total.value,
  molensPerGebied: top.map(([key, bucket]) => `${gebieden.find(g => `${g.soort}:${g.nummer}` === key).naam}: ${bucket.doc_count}`),
  complexMetOnderdeel: complex[fields.name]?.[0], geometrie: Object.fromEntries(['punt', 'vlak', 'geen'].map(kind => [kind, geometries.filter(k => k === kind).length]))
}, null, 2));
