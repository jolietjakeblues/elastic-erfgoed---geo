import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuery, buildExportQuery, buildGebiedQuery, buildRelationQuery, bucketsOf, gebiedClause, partsClause, fields, safeUrl, registerLink, soortVan, toParams, fromParams, describe, toCsv, BASE, EXPORT_MAX } from '../web/search.js';
const region = `${fields.addressRegion}.keyword`, type = `${fields.additionalType}.keyword`;
const soort = name => ({ prefix: { '@id.keyword': `${BASE}${name}/` } });
const orvelte = { soort: 'gezicht', nummer: '1325', naam: 'Orvelte', rijksmonument: ['1', '2'], complex: ['9'] };
test('Zoeken (query) en filteren (post_filter) blijven gescheiden; facets tellen zonder hun eigen filter', () => {
  const body = buildQuery({ query: '(kasteel OR buitenplaats) AND gracht', filters: { addressRegion: ['Gelderland', 'Utrecht'], additionalType: 'Kasteel' }, page: 1 });
  assert.equal(body.query.query_string.query, '(kasteel OR buitenplaats) AND gracht');
  assert.deepEqual(body.post_filter.bool.filter, [{ terms: { [region]: ['Gelderland', 'Utrecht'] } }, { terms: { [type]: ['Kasteel'] } }]);
  assert.deepEqual(body.aggs.addressRegion.filter.bool.filter, [{ terms: { [type]: ['Kasteel'] } }]);
  assert.deepEqual(body.aggs.additionalType.filter.bool.filter, [{ terms: { [region]: ['Gelderland', 'Utrecht'] } }]);
  assert.equal(body.aggs.category.filter.bool.filter.length, 2);
  assert.equal(body.from, 25); assert.equal(body.size, 25); assert.equal(body.track_total_hits, true);
  assert.equal(body.sort, undefined);
  assert.ok(buildQuery({ sort: 'naam' }).sort[0][`${fields.name}.keyword`]);
});
test('Soort: filter en facet via het URI-voorvoegsel', () => {
  const body = buildQuery({ filters: { soort: ['complex', 'gezicht'] } });
  assert.deepEqual(body.post_filter.bool.filter, [{ bool: { should: [soort('complex'), soort('gezicht')], minimum_should_match: 1 } }]);
  assert.deepEqual(body.aggs.soort.aggs.values.filters.filters.werelderfgoed, soort('werelderfgoed'));
  assert.deepEqual(body.aggs.soort.filter.bool.filter, []);
  assert.throws(() => buildQuery({ filters: { soort: ['kerk'] } }));
  assert.deepEqual(bucketsOf({ values: { buckets: { complex: { doc_count: 3 }, gezicht: { doc_count: 0 } } } }).buckets, [{ key: 'complex', doc_count: 3 }]);
  assert.equal(soortVan(`${BASE}archeologischterrein/6044513`), 'archeologischterrein');
  assert.equal(soortVan('https://example.org/x'), null);
});
test('Binnen een gebied of complex: context in de query, ook voor facetten', () => {
  const clause = gebiedClause(orvelte);
  assert.deepEqual(clause.bool.should[0].bool.filter, [soort('rijksmonument'), { terms: { [`${fields.identifier}.keyword`]: ['1', '2'] } }]);
  assert.deepEqual(clause.bool.should[1].bool.filter[0], soort('complex'));
  assert.deepEqual(gebiedClause({ rijksmonument: [], complex: [] }), { bool: { must_not: { match_all: {} } } });
  const body = buildQuery({ query: 'boerderij', binnen: 'gezicht:1325' }, { clause });
  assert.deepEqual(body.query.bool.filter, [clause]);
  assert.equal(body.query.bool.must[0].query_string.query, 'boerderij');
  assert.throws(() => buildQuery({ binnen: 'gezicht:1325' }), /Onbekend gebied/);
  assert.throws(() => buildQuery({ binnen: 'kerk:1' }, { clause }));
  assert.deepEqual(partsClause([]), { terms: { '@id.keyword': ['-'] } });
  const counts = buildGebiedQuery({ filters: { soort: ['rijksmonument'] } }, null, [orvelte, { ...orvelte, nummer: '2', rijksmonument: [], complex: [] }]);
  assert.deepEqual(Object.keys(counts.aggs.gebieden.filters.filters), ['gezicht:1325']);
  assert.equal(counts.size, 0); assert.equal(counts.query.bool.filter.length, 1);
  const relations = buildRelationQuery([], [`${BASE}rijksmonument/1`]);
  assert.deepEqual(relations.query.bool.should[1], { terms: { [`${fields.hasPart}.keyword`]: [`${BASE}rijksmonument/1`] } });
});
test('Veldkeuze, filters, sortering, querylengte en resultaatvenster zijn begrensd', () => {
  assert.throws(() => buildQuery({ field: 'arbitrary' }));
  assert.throws(() => buildQuery({ filters: { arbitrary: ['value'] } }));
  assert.throws(() => buildQuery({ filters: { addressRegion: Array.from({ length: 21 }, (_, i) => `p${i}`) } }));
  assert.throws(() => buildQuery({ sort: 'script' }));
  assert.throws(() => buildQuery({ page: -1 }));
  assert.throws(() => buildQuery({ page: 400 }));
  assert.throws(() => buildQuery({ query: 'a'.repeat(501) }));
  assert.equal(buildQuery({ field: 'Alles' }).highlight.fields[fields.identifier].number_of_fragments, 3);
  assert.deepEqual(buildQuery().query, { match_all: {} });
  const exported = buildExportQuery({ query: 'molen', filters: { addressRegion: ['Utrecht'] }, page: 7 });
  assert.equal(exported.size, EXPORT_MAX); assert.equal(exported.from, 0); assert.equal(exported.aggs, undefined);
  assert.deepEqual(exported.query.bool.filter, [{ terms: { [region]: ['Utrecht'] } }]);
});
test('Deelbare URL: heen en terug, onbekende waarden worden genegeerd', () => {
  const state = { query: 'kasteel AND gracht', field: 'Naam', filters: { soort: ['rijksmonument'], addressRegion: ['Gelderland', 'Utrecht'] }, page: 2, sort: 'naam', jokers: false, binnen: 'werelderfgoed:818' };
  const search = toParams(state).toString();
  assert.equal(search, 'q=kasteel+AND+gracht&veld=Naam&binnen=werelderfgoed%3A818&soort=rijksmonument&provincie=Gelderland&provincie=Utrecht&sorteer=naam&pagina=3');
  assert.deepEqual(fromParams(`?${search}`), { state, active: true });
  const bad = fromParams('?veld=__proto__&sorteer=x&pagina=-4&onbekend=1&binnen=x:1&soort=kerk');
  assert.deepEqual(bad.state, { query: '', field: 'Alles', filters: {}, sort: 'relevantie', page: 0, jokers: false, binnen: null });
  assert.equal(fromParams('?binnen=gezicht:1325').active, true);
  assert.equal(toParams({}).toString(), '');
});
test('Uitleg in gewone taal', () => {
  const lines = describe({ query: 'kasteel AND NOT "Grote AND Scheer"', field: 'Omschrijving', filters: { soort: ['complex'], addressRegion: ['Gelderland', 'Utrecht'] } });
  assert.equal(lines[0], 'Zoekt in de omschrijving naar: kasteel én niet "Grote AND Scheer"');
  assert.match(lines[1], /soort “Complex”, en provincie\/regio “Gelderland” of “Utrecht”/);
  assert.match(describe({ query: 'kasteel gracht' })[1], /één van de woorden/);
  assert.match(describe({ binnen: 'gezicht:1325' }, 'beschermd gezicht “Orvelte” (1325)')[1], /ligt in beschermd gezicht “Orvelte”/);
  assert.match(describe({ binnen: 'complex:1' }, 'complex “X” (1)')[1], /onderdelen van complex/);
});
test('CSV: soort, gebieden, puntkomma, quotes en geen formules', () => {
  const csv = toCsv([{ _source: { '@id': `${BASE}rijksmonument/1`, [fields.identifier]: ['1'], [fields.name]: ['=SOM(A1)'], [fields.description]: ['regel 1\nmet "quote"; en meer'], [fields.addressLocality]: ['A', 'B'] } }], undefined, () => ['Beschermd gezicht Orvelte']);
  const [header, row] = csv.slice(1).split('\r\n');
  assert.ok(csv.startsWith('﻿Soort;Nummer;Naam;'));
  assert.equal(header.split(';').length, 13);
  assert.match(row, /^Rijksmonument;1;'=SOM\(A1\);;;A \| B;;;;Beschermd gezicht Orvelte;/);
  assert.match(csv, /"regel 1\nmet ""quote""; en meer"/);
});
test('Bronlinks accepteren alleen HTTP(S) en bekende registers', () => {
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('https://example.org/id/1'), 'https://example.org/id/1');
  assert.equal(registerLink('https://whc.unesco.org/en/list/818').label, 'UNESCO');
  assert.equal(registerLink('https://kennis.cultureelerfgoed.nl/index.php/Gezicht/1325').label, 'Kennisbank RCE');
  assert.equal(registerLink('https://example.org/x'), null);
});
test('Verborgen testschakelaar ?jokers=1 voor een jokerteken aan het begin', () => {
  assert.equal(buildQuery({ query: '*molen' }).query.query_string.allow_leading_wildcard, false);
  const { state, active } = fromParams('?q=*molen&jokers=1');
  assert.equal(active, true); assert.equal(state.jokers, true);
  assert.equal(buildQuery(state).query.query_string.allow_leading_wildcard, true);
  assert.equal(fromParams('?jokers=1').active, false);
});
