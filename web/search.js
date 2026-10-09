import { WKT_FIELD } from './geo.js';
export const ENDPOINT = 'https://api.linkeddata.cultureelerfgoed.nl/datasets/rce/erfgoed-sdo/services/Erfgoed-sdo-nl2/_search';
export const PAGE_SIZE = 25;
export const MAX_WINDOW = 10000;
export const EXPORT_MAX = 1000;
const MAX_VALUES = 20;
export const BASE = 'https://linkeddata.cultureelerfgoed.nl/cho-kennis/id/';
export const fields = Object.fromEntries(['description', 'name', 'address', 'postalCode', 'addressLocality', 'addressRegion', 'category', 'additionalType', 'identifier', 'sameAs', 'hasPart', 'containsPlace', 'containedInPlace'].map(key => [key, `https://schema org/${key}`]));
// De soort staat alleen in de URI: …/id/rijksmonument/…, …/id/complex/… enzovoort.
export const soorten = { rijksmonument: 'Rijksmonument', complex: 'Complex', archeologischterrein: 'Archeologisch terrein', gezicht: 'Beschermd gezicht', werelderfgoed: 'Werelderfgoed' };
export const soortVan = uri => /\/id\/([a-z]+)\//.exec(String(uri ?? ''))?.[1] ?? null;
// @id.soort is een keyword-subveld uit de index template (triply/elastic-service-nl2.json): de soort uit de URI.
const SOORT_FIELD = '@id.soort';
const soortClause = soort => ({ term: { [SOORT_FIELD]: soort } });
export const searchFields = {
  Alles: ['name', 'description', 'address', 'postalCode', 'addressLocality', 'addressRegion', 'category', 'additionalType', 'identifier'].map(key => fields[key]),
  Omschrijving: [fields.description], Naam: [fields.name], Adres: [fields.address],
  Plaats: [fields.addressLocality], Type: [fields.additionalType], Nummer: [fields.identifier],
  // Zonder stemming, samenstellingen en synoniemen (subveld .exact; adresvelden zijn al exact). Accenten tellen niet mee.
  Exact: [...['name', 'description', 'category', 'additionalType'].map(key => `${fields[key]}.exact`), ...['address', 'postalCode', 'addressLocality', 'addressRegion', 'identifier'].map(key => fields[key])]
};
export const DEFAULT_FIELD = 'Alles';
export const facets = { soort: 'Soort', addressRegion: 'Provincie/regio', addressLocality: 'Plaats', category: 'Categorie', additionalType: 'Type' };
// Sorteren op nummer gebruikt identifier.getal (long); het gewone veld is tekst, dan komt 5 na 10040.
export const sorts = {
  relevantie: { label: 'Relevantie', sort: null },
  naam: { label: 'Naam (A–Z)', sort: [{ [`${fields.name}.keyword`]: { order: 'asc', missing: '_last' } }, '_score'] },
  plaats: { label: 'Plaats (A–Z)', sort: [{ [`${fields.addressLocality}.keyword`]: { order: 'asc', missing: '_last' } }, { [`${fields.name}.keyword`]: { order: 'asc', missing: '_last' } }] },
  soort: { label: 'Soort', sort: [{ '@id.keyword': { order: 'asc' } }] },
  // identifier.getal is een long-subveld uit de index template (triply/elastic-service-geo.json).
  nummer: { label: 'Nummer', sort: [{ [`${fields.identifier}.getal`]: { order: 'asc', missing: '_last' } }] }
};
// "Binnen": een context voor de zoekactie.
//   gezicht:1325, werelderfgoed:818  ruimtelijk: alles wat binnen het vlak valt (geo_shape within)
//   complex:524444                  de onderdelen volgens schema:hasPart
//   rond:rijksmonument:12345:500    alles binnen 500 m van een object (geo_distance)
export const AFSTANDEN = [100, 250, 500, 1000, 2000];
export const BINNEN = /^((gezicht|werelderfgoed|complex):\d{1,9}|rond:(rijksmonument|complex|gezicht|werelderfgoed):\d{1,9}:(100|250|500|1000|2000))$/;
const notItself = uri => [{ term: { '@id.keyword': uri } }];
export const withinClause = (wkt, uri) => ({ bool: { filter: [{ geo_shape: { [WKT_FIELD]: { shape: wkt, relation: 'within' } } }], must_not: notItself(uri) } });
export const nearClause = ({ lat, lon }, meters, uri) => ({ bool: { filter: [{ geo_distance: { distance: `${meters}m`, [WKT_FIELD]: { lat, lon } } }], must_not: notItself(uri) } });
// De lijst met gezichten en werelderfgoed (zonder vlakken) voor de keuzelijst.
export const gebiedenListQuery = () => ({
  size: 600, _source: ['@id', fields.identifier, fields.name],
  query: { bool: { should: [soortClause('gezicht'), soortClause('werelderfgoed')], minimum_should_match: 1 } },
  sort: [{ [`${fields.name}.keyword`]: { order: 'asc', missing: '_last' } }]
});
// In welke gezichten en werelderfgoederen liggen deze objecten? Eén request: per object een benoemde geo_shape-query
// (het gebied bevat het object); Elasticsearch geeft per gevonden gebied terug welke namen matchten.
export const ligtInQuery = items => ({
  size: 200, _source: ['@id', fields.identifier, fields.name],
  query: { bool: {
    filter: [{ bool: { should: [soortClause('gezicht'), soortClause('werelderfgoed')], minimum_should_match: 1 } }],
    should: items.map(({ name, wkt }) => ({ geo_shape: { [WKT_FIELD]: { shape: wkt, relation: 'contains' }, _name: name } })),
    minimum_should_match: 1
  } }
});
// Vooraf berekende koppeling (data/gebieden.json), alleen nog voor de telling per gebied: 484 vlakken in één
// aggregation zou ca. 5 MB per request zijn.
export function gebiedClause(gebied) {
  const should = ['rijksmonument', 'complex'].filter(soort => gebied[soort]?.length).map(soort => ({ bool: { filter: [soortClause(soort), { terms: { [`${fields.identifier}.keyword`]: gebied[soort] } }] } }));
  return should.length ? { bool: { should, minimum_should_match: 1 } } : { bool: { must_not: { match_all: {} } } };
}
export const partsClause = uris => ({ terms: { '@id.keyword': uris.length ? uris : ['-'] } });
// Filters zijn { facet: [waarden] }: binnen één facet OF, tussen facetten EN.
function clauseFor(key, list) {
  if (key === 'soort') return { terms: { [SOORT_FIELD]: list } };
  return { terms: { [`${fields[key]}.keyword`]: list } };
}
function filterClauses(filters, skip) {
  return Object.entries(filters).filter(([key, list]) => key !== skip && list.length).map(([key, list]) => clauseFor(key, list));
}
function validate({ query = '', field = DEFAULT_FIELD, filters = {}, page = 0, sort = 'relevantie', jokers = false, binnen = null }, context) {
  if (!Object.hasOwn(searchFields, field)) throw new Error('Onbekend zoekveld.');
  if (!Object.hasOwn(sorts, sort)) throw new Error('Onbekende sortering.');
  if (!Number.isInteger(page) || page < 0 || (page + 1) * PAGE_SIZE > MAX_WINDOW) throw new Error('Verfijn je zoekvraag om meer resultaten te bekijken.');
  if (typeof query !== 'string' || query.length > 500) throw new Error('Gebruik maximaal 500 tekens in je zoekvraag.');
  if (binnen != null && (!BINNEN.test(binnen) || !context?.clause)) throw new Error('Onbekend gebied of complex.');
  const clean = {};
  for (const [key, value] of Object.entries(filters)) {
    const list = Array.isArray(value) ? value : [value];
    if (!Object.hasOwn(facets, key) || list.length > MAX_VALUES || !list.every(item => typeof item === 'string' && item.length <= 300)) throw new Error('Ongeldig filter.');
    if (key === 'soort' && !list.every(item => Object.hasOwn(soorten, item))) throw new Error('Ongeldig filter.');
    if (list.length) clean[key] = [...new Set(list)];
  }
  const text = query.trim() ? { query_string: { query: query.trim(), fields: searchFields[field], allow_leading_wildcard: jokers === true } } : { match_all: {} };
  const search = binnen ? { bool: { must: [text], filter: [context.clause] } } : text;
  return { search, filters: clean, field, page, sort };
}
const facetAggs = filters => Object.fromEntries(Object.keys(facets).map(key => [key, {
  filter: { bool: { filter: filterClauses(filters, key) } },
  aggs: { values: key === 'soort'
    ? { terms: { field: SOORT_FIELD, size: 10 } }
    : { terms: { field: `${fields[key]}.keyword`, size: 100, show_term_doc_count_error: true } } }
}]));
// Zoeken (query) en filteren (post_filter) blijven gescheiden. Elke facet telt met de filters van de andere
// facetten, zodat je binnen een facet meerdere waarden kunt aanvinken (bijv. Gelderland én Utrecht).
// context = { clause } voor "binnen" (gezicht, werelderfgoed of complex); die beperkt ook de facetten.
export function buildQuery(state = {}, context) {
  const { search, filters, field, page, sort } = validate(state, context);
  return {
    from: page * PAGE_SIZE, size: PAGE_SIZE, track_total_hits: true, timeout: '15s',
    _source: ['@id', ...Object.values(fields), WKT_FIELD],
    query: search,
    post_filter: { bool: { filter: filterClauses(filters) } },
    ...(sorts[sort].sort ? { sort: sorts[sort].sort } : {}),
    highlight: { fields: Object.fromEntries(searchFields[field].map(key => [key, { fragment_size: 275, number_of_fragments: 3 }])), pre_tags: ['<mark>'], post_tags: ['</mark>'], encoder: 'html' },
    aggs: facetAggs(filters)
  };
}
// Facetbuckets in één vorm: de soort-facet is een filters-aggregation, de rest terms.
export function bucketsOf(aggregation) {
  const values = aggregation?.values;
  if (!values) return null;
  if (Array.isArray(values.buckets)) return values;
  return { buckets: Object.entries(values.buckets).map(([key, { doc_count }]) => ({ key, doc_count })).filter(bucket => bucket.doc_count > 0), sum_other_doc_count: 0 };
}
// Telling per gezicht/werelderfgoed voor de huidige zoekactie (inclusief alle filters). Eén filters-aggregation met
// per gebied de nummers uit de ruimtelijke koppeling; ca. 0,5 MB request, daarom alleen op verzoek.
export function buildGebiedQuery(state, context, gebieden) {
  const { search, filters } = validate({ ...state, page: 0 }, context);
  return {
    size: 0, timeout: '15s',
    query: { bool: { must: [search], filter: filterClauses(filters) } },
    aggs: { gebieden: { filters: { filters: Object.fromEntries(gebieden.filter(g => g.rijksmonument.length || g.complex.length).map(g => [`${g.soort}:${g.nummer}`, gebiedClause(g)])) } } }
  };
}
// Relaties van de resultaten op deze pagina in één request: de documenten waarnaar verwezen wordt (onderdelen,
// archeologische terreinen, het rijksmonument van een terrein) en de complexen waar een rijksmonument onderdeel van is.
export function buildRelationQuery(uris, monuments) {
  return {
    size: 500, timeout: '15s',
    _source: ['@id', fields.identifier, fields.name, fields.hasPart],
    query: { bool: { should: [{ terms: { '@id.keyword': uris.length ? uris : ['-'] } }, { terms: { [`${fields.hasPart}.keyword`]: monuments.length ? monuments : ['-'] } }], minimum_should_match: 1 } }
  };
}
export const documentQuery = uri => ({ size: 1, query: { term: { '@id.keyword': uri } }, _source: ['@id', fields.identifier, fields.name, fields.hasPart, WKT_FIELD] });
export const lookupQuery = (soort, nummer) => ({ size: 1, query: { bool: { filter: [soortClause(soort), { term: { [`${fields.identifier}.keyword`]: nummer } }] } }, _source: ['@id', fields.identifier, fields.name, fields.hasPart, WKT_FIELD] });
// Export: dezelfde zoekvraag, filters en sortering, maximaal EXPORT_MAX resultaten, zonder geometrie, facets en highlights.
export function buildExportQuery(state = {}, context) {
  const { search, filters, sort } = validate({ ...state, page: 0 }, context);
  return {
    from: 0, size: EXPORT_MAX, track_total_hits: true, timeout: '20s',
    _source: ['@id', ...Object.values(fields).filter(key => ![fields.hasPart, fields.containsPlace, fields.containedInPlace].includes(key))],
    query: { bool: { must: [search], filter: filterClauses(filters) } },
    ...(sorts[sort].sort ? { sort: sorts[sort].sort } : {})
  };
}
export const values = value => (Array.isArray(value) ? value : value == null ? [] : [value]).filter(value => typeof value === 'string' || typeof value === 'number').map(String);
export const textValue = value => values(value).join(', ');
export function safeUrl(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
// Bronlinks: alleen de bekende registers.
const registers = { 'monumentenregister.cultureelerfgoed.nl': 'Monumentenregister', 'kennis.cultureelerfgoed.nl': 'Kennisbank RCE', 'whc.unesco.org': 'UNESCO' };
export function registerLink(value) {
  const url = safeUrl(value);
  return url && Object.hasOwn(registers, new URL(url).hostname) ? { label: registers[new URL(url).hostname], url } : null;
}
// Deelbare URL: ?q=…&veld=…&soort=…&provincie=…&binnen=gezicht:1325&sorteer=…&pagina=…
const params = { soort: 'soort', addressRegion: 'provincie', addressLocality: 'plaats', category: 'categorie', additionalType: 'type' };
export function toParams({ query = '', field = DEFAULT_FIELD, filters = {}, page = 0, sort = 'relevantie', jokers = false, binnen = null }) {
  const result = new URLSearchParams();
  if (query.trim()) result.set('q', query.trim());
  if (field !== DEFAULT_FIELD) result.set('veld', field);
  if (binnen) result.set('binnen', binnen);
  for (const [key, list] of Object.entries(filters)) for (const value of list) result.append(params[key], value);
  if (sort !== 'relevantie') result.set('sorteer', sort);
  if (page > 0) result.set('pagina', String(page + 1));
  if (jokers) result.set('jokers', '1');
  return result;
}
export function fromParams(search) {
  const input = new URLSearchParams(search);
  const filters = {};
  for (const [key, name] of Object.entries(params)) {
    const list = input.getAll(name).filter(value => value && (key !== 'soort' || Object.hasOwn(soorten, value))).slice(0, MAX_VALUES);
    if (list.length) filters[key] = list;
  }
  const page = Number.parseInt(input.get('pagina') ?? '1', 10);
  const binnen = input.get('binnen');
  const state = {
    query: (input.get('q') ?? '').slice(0, 500),
    field: Object.hasOwn(searchFields, input.get('veld')) ? input.get('veld') : DEFAULT_FIELD,
    filters,
    sort: Object.hasOwn(sorts, input.get('sorteer')) ? input.get('sorteer') : 'relevantie',
    // Verborgen testschakelaar: ?jokers=1 staat een jokerteken aan het begin toe (bijv. *molen). Niet in de interface.
    jokers: input.get('jokers') === '1',
    binnen: binnen && BINNEN.test(binnen) ? binnen : null,
    page: Number.isInteger(page) && page >= 1 && page * PAGE_SIZE <= MAX_WINDOW ? page - 1 : 0
  };
  return { state, active: [...input.keys()].some(key => ['q', 'binnen', ...Object.values(params)].includes(key)) };
}
// Uitleg van de zoekactie in gewone taal. binnenLabel is bijv. 'beschermd gezicht “Orvelte” (1325)'.
const fieldText = { Alles: 'in alle tekstvelden', Omschrijving: 'in de omschrijving', Naam: 'in de naam', Adres: 'in het adres', Plaats: 'in de plaatsnaam', Type: 'in het type', Nummer: 'in het nummer', Exact: 'exact (zonder meervoud, samenstellingen en synoniemen)' };
const filterValue = (key, value) => `“${key === 'soort' ? soorten[value] ?? value : value}”`;
export function describe({ query = '', field = DEFAULT_FIELD, filters = {}, page = 0, sort = 'relevantie', jokers = false, binnen = null }, binnenLabel) {
  const lines = [];
  const trimmed = query.trim();
  if (!trimmed) lines.push(binnen ? 'Toont alles (geen zoekvraag).' : 'Toont alle objecten (geen zoekvraag).');
  else {
    const readable = trimmed.split(/("[^"]*"(?:~\d+)?)/).map((part, index) => index % 2 ? part : part.replace(/\bAND\b|&&/g, 'én').replace(/\bOR\b|\|\|/g, 'of').replace(/\bNOT\b/g, 'niet')).join('');
    lines.push(`Zoekt ${fieldText[field]} naar: ${readable}`);
    const words = trimmed.replace(/"[^"]*"(~\d+)?/g, ' x ').replace(/[()]/g, ' ').split(/\s+/).filter(Boolean);
    if (words.length > 1 && !words.some(word => /^(AND|OR|NOT|&&|\|\|)$/.test(word) || /^[+-]/.test(word))) lines.push('Zonder AND/OR/NOT is het genoeg als één van de woorden voorkomt.');
  }
  if (binnen) lines.push(binnen.startsWith('complex:') ? `Alleen de onderdelen van ${binnenLabel ?? binnen}.` : binnen.startsWith('rond:') ? `Alleen wat binnen ${binnenLabel ?? binnen} ligt.` : `Alleen wat ligt in ${binnenLabel ?? binnen}.`);
  const active = Object.entries(filters).filter(([, list]) => list.length);
  if (active.length) lines.push(`Alleen objecten met ${active.map(([key, list]) => `${facets[key].toLowerCase()} ${list.map(value => filterValue(key, value)).join(' of ')}`).join(', en ')}.`);
  if (jokers) lines.push('Testmodus: een jokerteken aan het begin (bijv. *molen) is toegestaan.');
  lines.push(`Gesorteerd op ${sort === 'relevantie' ? 'relevantie (best passend eerst)' : sorts[sort].label.charAt(0).toLowerCase() + sorts[sort].label.slice(1)}; resultaten ${page * PAGE_SIZE + 1} tot ${(page + 1) * PAGE_SIZE}.`);
  return lines;
}
// CSV met puntkomma (opent direct goed in Nederlandse Excel) en BOM voor UTF-8.
export function toCsv(hits, decode = text => text, gebiedenVan = () => []) {
  const columns = [['Soort', 'soort'], ['Nummer', 'identifier'], ['Naam', 'name'], ['Adres', 'address'], ['Postcode', 'postalCode'], ['Plaats', 'addressLocality'], ['Provincie/regio', 'addressRegion'], ['Categorie', 'category'], ['Type', 'additionalType'], ['Ligt in gezicht/werelderfgoed', 'gebieden'], ['Linked Data', '@id'], ['Register', 'sameAs'], ['Omschrijving', 'description']];
  const cell = text => {
    const value = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text; // voorkom formule-injectie in spreadsheets
    return /[";\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  };
  const get = (source, key) => {
    if (key === 'soort') return [soorten[soortVan(source['@id'])] ?? ''];
    if (key === 'gebieden') return gebiedenVan(source);
    return values(source[key === '@id' ? '@id' : fields[key]]);
  };
  const rows = hits.map(hit => columns.map(([, key]) => cell(decode(get(hit._source ?? {}, key).join(' | ')))).join(';'));
  return `﻿${columns.map(([label]) => label).join(';')}\r\n${rows.join('\r\n')}\r\n`;
}
export async function search(body, signal) {
  const response = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal, credentials: 'omit' });
  if (!response.ok) {
    const detail = await response.text();
    console.error('Elasticsearch', response.status, detail);
    if (response.status === 400 && /parsing_exception|parse_exception|query_shard_exception/.test(detail)) throw new Error('Controleer je zoeksyntax: gebruik bijvoorbeeld kasteel AND gracht en sluit quotes en haakjes.');
    if (response.status === 400 && /aggregat|fielddata/.test(detail)) throw new Error('De facetquery werkt niet. Probeer het later opnieuw.');
    throw new Error('De zoekservice kan je vraag nu niet verwerken. Probeer het opnieuw.');
  }
  const result = await response.json();
  if (result.timed_out || result._shards?.failed) throw new Error('De zoekservice gaf een onvolledig antwoord. Verfijn je zoekvraag en probeer opnieuw.');
  if (!result.hits || (body.aggs && !result.aggregations)) throw new Error('De zoekservice gaf geen volledige resultaten en facetten terug.');
  return result;
}
