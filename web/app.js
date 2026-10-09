import { buildQuery, buildExportQuery, buildGebiedQuery, buildRelationQuery, lookupQuery, documentQuery, gebiedClause, partsClause, bucketsOf, search, facets, fields, sorts, soorten, soortVan, values, textValue, safeUrl, registerLink, toParams, fromParams, describe, toCsv, DEFAULT_FIELD, PAGE_SIZE, MAX_WINDOW, EXPORT_MAX } from './search.js';
import { geometryFor } from './geo.js';
const $ = id => document.getElementById(id);
const blank = () => ({ query: '', field: DEFAULT_FIELD, filters: {}, page: 0, sort: 'relevantie', binnen: null, jokers: state?.jokers ?? false });
let state; state = blank();
let controller, needsFit = false, lastTotal = 0;
const cards = new Map(), markers = new Map(), shapes = new Map(), relationSlots = new Map();
const wide = window.matchMedia('(min-width: 1100px)');
const colors = { rijksmonument: '#01689b', complex: '#a90061', archeologischterrein: '#673327', gezicht: '#39870c', werelderfgoed: '#e17000' };
// Leaflet komt van een CDN; zonder Leaflet werkt de demo verder zonder kaart.
const map = window.L ? L.map('map', { zoomControl: true }).setView([52.2, 5.3], 7) : null;
const contextLayer = map ? L.featureGroup().addTo(map) : null;
const markerLayer = map ? L.featureGroup().addTo(map) : null;
if (map) L.tileLayer('https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/standaard/EPSG:3857/{z}/{x}/{y}.png', { minZoom: 6, maxZoom: 19, attribution: 'Kaart: <a href="https://www.pdok.nl/" target="_blank" rel="noopener">PDOK</a> / Kadaster' }).addTo(map);
else $('map').append(el('p', 'De kaartbibliotheek kon niet worden geladen.', 'empty'));
const format = number => new Intl.NumberFormat('nl-NL').format(number);
const plural = (count, one, more) => `${format(count)} ${count === 1 ? one : more}`;
// Sommige bronwaarden zijn dubbel gecodeerd (bijv. "K. &amp; J. Wilkensbrug"). Entiteiten worden als
// tekst gedecodeerd; er komt nooit HTML uit de bron in de pagina.
const decode = text => (/&[#\w]+;/.test(text) ? new DOMParser().parseFromString(text, 'text/html').body.textContent : text);
const show = value => decode(textValue(value));
function el(tag, text, className) { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; }
function button(text, callback, className) { const node = el('button', text, className); node.type = 'button'; node.addEventListener('click', callback); return node; }
function link(text, url) { const node = el('a', text); node.href = url; node.target = '_blank'; node.rel = 'noopener noreferrer'; return node; }

// Ruimtelijke koppeling gezicht/werelderfgoed → rijksmonumenten en complexen (zie scripts/build_gebieden.py).
const gebieden = { list: [], byKey: new Map(), byLabel: new Map(), in: { rijksmonument: new Map(), complex: new Map() } };
const gebiedLabel = g => `${decode(g.naam ?? 'Zonder naam')} — ${soorten[g.soort]} ${g.nummer}`;
const gebiedenLoaded = fetch('data/gebieden.json').then(response => { if (!response.ok) throw new Error(response.status); return response.json(); }).then(data => {
  gebieden.list = data.gebieden;
  for (const g of data.gebieden) {
    const key = `${g.soort}:${g.nummer}`;
    gebieden.byKey.set(key, g); gebieden.byLabel.set(gebiedLabel(g), key);
    for (const soort of ['rijksmonument', 'complex']) for (const nummer of g[soort]) { const list = gebieden.in[soort].get(nummer) ?? []; list.push(g); gebieden.in[soort].set(nummer, list); }
    $('gebieden-lijst').append(Object.assign(el('option'), { value: gebiedLabel(g) }));
  }
  $('gebieden-info').textContent = `Ruimtelijke koppeling met gezichten en werelderfgoed berekend op ${data.bijgewerkt}.`;
}).catch(error => { console.error('gebieden.json', error); $('binnen').disabled = true; $('binnen-hint').textContent = 'De gebiedenlijst kon niet worden geladen; zoeken binnen een gezicht of werelderfgoed werkt nu niet.'; });
const gebiedenVan = source => {
  const soort = soortVan(source['@id']);
  return gebieden.in[soort]?.get(values(source[fields.identifier])[0]) ?? [];
};

// Context "binnen": een gezicht, werelderfgoed of complex. Wordt opgezocht en bewaard.
const contexts = new Map();
async function resolveContext(binnen) {
  if (!binnen) return null;
  if (contexts.has(binnen)) return contexts.get(binnen);
  const [soort, nummer] = binnen.split(':');
  let context;
  if (soort === 'complex') {
    const hit = (await search(lookupQuery('complex', nummer), AbortSignal.timeout(20000))).hits.hits[0];
    if (!hit) throw new Error(`Complex ${nummer} bestaat niet in deze index.`);
    const parts = values(hit._source[fields.hasPart]);
    context = { soort, nummer, uri: hit._source['@id'], clause: partsClause(parts), label: `complex “${show(hit._source[fields.name]) || 'zonder naam'}” (${nummer})`, summary: `${plural(parts.length, 'onderdeel', 'onderdelen')} volgens schema:hasPart`, geometry: geometryFor(hit._source) };
  } else {
    await gebiedenLoaded;
    const g = gebieden.byKey.get(binnen);
    if (!g) throw new Error(`${soorten[soort]} ${nummer} staat niet in de gebiedenlijst.`);
    context = { soort, nummer, uri: g.id, clause: gebiedClause(g), label: `${soorten[soort].toLowerCase()} “${decode(g.naam)}” (${nummer})`, summary: `${plural(g.rijksmonument.length, 'rijksmonument', 'rijksmonumenten')} en ${plural(g.complex.length, 'complex', 'complexen')} volgens de ruimtelijke koppeling`, geometry: null };
    // Het vlak van het gebied komt uit Elasticsearch; de kaart tekent het zodra het binnen is.
    context.geometryLoaded = search(documentQuery(g.id), AbortSignal.timeout(20000)).then(data => { context.geometry = geometryFor(data.hits.hits[0]?._source); }).catch(error => console.error(error));
  }
  contexts.set(binnen, context);
  return context;
}
function setBinnen(binnen, extra = {}) {
  Object.assign(state, { binnen, page: 0 }, extra);
  syncForm(); run();
  window.scrollTo({ top: $('status').offsetTop - 16, behavior: 'smooth' });
}
// Eén object tonen via zijn nummer en soort (bijv. vanuit een relatie).
const showObject = (soort, nummer) => setBinnen(null, { query: `"${nummer}"`, field: 'Nummer', filters: { soort: [soort] }, sort: 'relevantie' });
// Vanuit een resultaat naar een gebied of complex: met een schone zoekactie (anders blijft bijv. "buitenplaats" staan).
const openBinnen = binnen => setBinnen(binnen, { query: '', field: DEFAULT_FIELD, filters: {} });

function highlight(fragment) {
  const node = el('p', null, 'match');
  // Decode escaped source text, but only recreate the exact highlight delimiters.
  // No upstream HTML nodes or attributes are inserted into the live document.
  for (const [index, part] of fragment.split(/(<mark>.*?<\/mark>)/gs).entries()) {
    const marked = index % 2 === 1;
    const parsed = new DOMParser().parseFromString(marked ? part.slice(6, -7) : part, 'text/html');
    const text = decode(parsed.body.textContent);
    node.append(marked ? el('mark', text) : document.createTextNode(text));
  }
  return node;
}
function relationRow(label, items) {
  const row = el('div', null, 'relation'); row.append(el('span', label, 'relation-label'));
  const list = el('span', null, 'relation-items'); list.append(...items); row.append(list); return row;
}
function renderResults(hits) {
  $('results').replaceChildren(); cards.clear(); relationSlots.clear();
  if (!hits.length) { $('results').append(el('p', 'Niets gevonden. Pas je zoekvraag aan of verwijder een filter.', 'empty')); return; }
  for (const hit of hits) {
    const source = hit._source || {}, soort = soortVan(source['@id']), nummer = values(source[fields.identifier])[0];
    const card = el('article'); card.dataset.id = hit._id; card.dataset.soort = soort ?? ''; cards.set(hit._id, card);
    card.addEventListener('click', event => { if (!event.target.closest('a, button, summary, details')) select(hit._id, true); });
    const head = el('p', null, 'number'); head.append(el('span', soorten[soort] ?? 'Object', 'badge'), document.createTextNode(` ${nummer ?? 'zonder nummer'}`));
    // Zonder naam (veel rijksmonumenten): type en adres als kop.
    const fallback = [values(source[fields.additionalType])[0], values(source[fields.address])[0] ?? values(source[fields.addressLocality])[0]].filter(Boolean).map(decode).join(', ');
    card.append(head, el('h3', show(source[fields.name]) || fallback || `${soorten[soort] ?? 'Object'} zonder naam`));
    const metadata = el('dl', null, 'metadata');
    for (const [key, label] of Object.entries({ address: 'Adres', postalCode: 'Postcode', addressLocality: 'Plaats', addressRegion: 'Provincie/regio', category: 'Categorie', additionalType: 'Type' })) {
      const text = show(source[fields[key]]); if (!text) continue;
      const row = el('div'); row.append(el('dt', `${label}:`), el('dd', text)); metadata.append(row);
    }
    if (metadata.childElementCount) card.append(metadata);
    // Relaties: wat erin ligt, waar het in ligt, onderdelen.
    const relations = el('div', null, 'relations');
    if (soort === 'gezicht' || soort === 'werelderfgoed') {
      const g = gebieden.byKey.get(`${soort}:${nummer}`);
      if (g) relations.append(relationRow('Hierin liggen:', [document.createTextNode(`${plural(g.rijksmonument.length, 'rijksmonument', 'rijksmonumenten')} en ${plural(g.complex.length, 'complex', 'complexen')} `), button('Toon wat erin ligt', () => openBinnen(`${soort}:${nummer}`), 'relation-button')]));
    }
    if (soort === 'complex') {
      const parts = values(source[fields.hasPart]);
      relations.append(relationRow('Onderdelen:', [document.createTextNode(`${plural(parts.length, 'rijksmonument', 'rijksmonumenten')} `), button('Toon onderdelen', () => openBinnen(`complex:${nummer}`), 'relation-button')]));
    }
    const inGebied = gebiedenVan(source);
    if (inGebied.length) relations.append(relationRow('Ligt in:', inGebied.map(g => button(`${soorten[g.soort]} ${decode(g.naam)}`, () => openBinnen(`${g.soort}:${g.nummer}`), 'relation-button'))));
    // Deze komen uit een extra request (zie loadRelations).
    const slot = el('div'); relations.append(slot); relationSlots.set(hit._id, { slot, source, soort });
    card.append(relations);
    const fragments = Object.values(hit.highlight || {}).flat().slice(0, 3);
    fragments.forEach(fragment => card.append(highlight(fragment)));
    const descriptions = values(source[fields.description]).map(decode);
    if (descriptions.length) { const detail = el('details'); detail.append(el('summary', 'Volledige omschrijving')); descriptions.forEach(text => detail.append(el('p', text, 'description'))); card.append(detail); }
    const links = el('div', null, 'links');
    for (const raw of values(source['@id'])) { const url = safeUrl(raw); if (url) { links.append(link('Linked Data', url)); const uri = el('p', null, 'uri'); uri.append(link(raw, url)); card.append(uri); } }
    for (const raw of values(source[fields.sameAs])) { const register = registerLink(raw); if (register) links.append(link(register.label, register.url)); }
    if (map && geometryFor(source)) links.append(button('Toon op kaart', () => select(hit._id, true)));
    card.append(links); $('results').append(card);
  }
}
// Relaties van de resultaten op deze pagina met één extra request ophalen: namen van onderdelen en terreinen,
// het rijksmonument van een archeologisch terrein, en het complex waar een rijksmonument onderdeel van is.
async function loadRelations(hits, signal) {
  const uris = new Set(), monuments = [];
  for (const { _source: source = {} } of hits) {
    for (const key of ['containsPlace', 'containedInPlace']) values(source[fields[key]]).forEach(uri => uris.add(uri));
    if (soortVan(source['@id']) === 'rijksmonument') monuments.push(source['@id']);
  }
  if (!uris.size && !monuments.length) return;
  let data;
  try { data = await search(buildRelationQuery([...uris], monuments), signal); } catch (error) { if (error.name !== 'AbortError') console.error('Relaties', error); return; }
  const byUri = new Map(), complexOf = new Map();
  for (const { _source: source } of data.hits.hits) {
    byUri.set(source['@id'], source);
    if (soortVan(source['@id']) === 'complex') for (const part of values(source[fields.hasPart])) { const list = complexOf.get(part) ?? []; list.push(source); complexOf.set(part, list); }
  }
  const objectButton = (uri, fallback) => {
    const source = byUri.get(uri), soort = soortVan(uri), nummer = source && values(source[fields.identifier])[0];
    const text = `${soorten[soort] ?? 'Object'} ${nummer ?? ''}${source && show(source[fields.name]) ? ` ${show(source[fields.name])}` : ''}`.trim();
    return nummer ? button(text, () => (soort === 'complex' ? openBinnen(`complex:${nummer}`) : showObject(soort, nummer)), 'relation-button') : el('span', fallback ?? text);
  };
  for (const { slot, source, soort } of relationSlots.values()) {
    if (soort === 'rijksmonument') {
      const complexes = complexOf.get(source['@id']) ?? [];
      if (complexes.length) slot.append(relationRow('Onderdeel van:', complexes.map(c => objectButton(c['@id']))));
      const terreinen = values(source[fields.containsPlace]);
      if (terreinen.length) slot.append(relationRow('Archeologische terreinen:', terreinen.slice(0, 10).map(uri => objectButton(uri)).concat(terreinen.length > 10 ? [el('span', `en ${terreinen.length - 10} meer`)] : [])));
    }
    if (soort === 'archeologischterrein') {
      const monuments = values(source[fields.containedInPlace]);
      if (monuments.length) slot.append(relationRow('Ligt in:', monuments.map(uri => objectButton(uri))));
    }
  }
}
function markerIcon(number, soort, selected) {
  // Alleen het nummer als label, als tekst (geen HTML uit de bron).
  const label = el('span', number, selected ? 'selected' : null);
  label.style.setProperty('--kleur', colors[soort] ?? colors.rijksmonument);
  return L.divIcon({ className: 'label-marker', html: label, iconSize: [0, 0] });
}
const isArea = soort => soort === 'gezicht' || soort === 'werelderfgoed';
const shapeStyle = (soort, selected) => ({ color: selected ? '#000000' : colors[soort] ?? colors.rijksmonument, fillColor: selected ? '#ffb612' : colors[soort] ?? colors.rijksmonument, weight: selected ? 3 : 2, fillOpacity: selected ? 0.45 : isArea(soort) ? 0.08 : 0.2 });
function renderContextGeometry(context) {
  if (!map) return;
  contextLayer.clearLayers();
  if (!context?.geometry?.polygons) return;
  // Het gekozen gebied of complex als zwarte stippellijn, zonder vulling, onder de resultaten.
  contextLayer.addLayer(L.polygon(context.geometry.polygons, { color: '#000', weight: 2, dashArray: '6 6', fill: false, interactive: false }));
}
function renderMap(hits) {
  if (!map) return 0;
  markerLayer.clearLayers(); markers.clear(); shapes.clear();
  const counts = { punt: 0, vlak: 0 };
  for (const hit of hits) {
    const geometry = geometryFor(hit._source);
    if (!geometry) continue;
    const soort = soortVan(hit._source?.['@id']);
    const number = textValue(hit._source?.[fields.identifier]) || '?';
    // Vlakken worden als vlak getekend; het label staat op het zwaartepunt van het (grootste) vlak.
    if (geometry.polygons) {
      const shape = L.polygon(geometry.polygons, shapeStyle(soort, false)).on('click', () => select(hit._id, false));
      shape.soort = soort; shapes.set(hit._id, shape); markerLayer.addLayer(shape);
    }
    const marker = L.marker([geometry.point.lat, geometry.point.lon], { icon: markerIcon(number, soort, false), title: `${soorten[soort] ?? 'Object'} ${number}`, keyboard: true });
    marker.on('click', () => select(hit._id, false));
    marker.number = number; marker.soort = soort;
    markers.set(hit._id, marker); markerLayer.addLayer(marker); counts[geometry.kind]++;
  }
  // Grote gebieden onderop, zodat kleinere vlakken klikbaar blijven.
  for (const shape of shapes.values()) if (isArea(shape.soort)) shape.bringToBack();
  const total = counts.punt + counts.vlak;
  needsFit = total > 0 || contextLayer.getLayers().length > 0; fitMarkers();
  $('map-info').textContent = hits.length ? `Op kaart: ${total} van ${hits.length} getoonde resultaten (${counts.punt} als punt, ${counts.vlak} als vlak met het nummer op het zwaartepunt).` : 'Geen resultaten om op de kaart te tonen.';
  return total;
}
// Een verborgen kaart heeft geen afmetingen; pas passend inzoomen zodra de kaart zichtbaar is.
function fitMarkers() {
  if (!needsFit || !$('map').offsetWidth) return;
  const bounds = markerLayer.getBounds();
  if (contextLayer.getLayers().length) bounds.extend(contextLayer.getBounds());
  if (!bounds.isValid()) return;
  map.invalidateSize(); map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 }); needsFit = false;
}
function setView(view) {
  $('workspace').dataset.view = view;
  document.querySelectorAll('.view-toggle button').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.view === view)));
  if (view === 'map' && map) { map.invalidateSize(); fitMarkers(); }
}
// Selecteer een resultaat: markeer de kaart en het resultaat; vanuit de lijst vliegt de kaart naar het object.
function select(id, fromList) {
  for (const [key, card] of cards) card.classList.toggle('selected', key === id);
  for (const [key, marker] of markers) { marker.setIcon(markerIcon(marker.number, marker.soort, key === id)); marker.setZIndexOffset(key === id ? 1000 : 0); }
  for (const [key, shape] of shapes) { shape.setStyle(shapeStyle(shape.soort, key === id)); if (key === id && !isArea(shape.soort)) shape.bringToFront(); }
  const marker = markers.get(id);
  if (fromList) {
    if (!marker) return;
    if (!wide.matches) setView('map');
    needsFit = false;
    if (shapes.has(id)) map.flyToBounds(shapes.get(id).getBounds(), { padding: [40, 40], maxZoom: 18, duration: 0.8 });
    else map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 17), { duration: 0.8 });
  } else {
    if (!wide.matches) setView('list');
    cards.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}
const isActive = (key, value) => state.filters[key]?.includes(value) ?? false;
function toggleFilter(key, value) {
  const list = state.filters[key] ?? [];
  state.filters[key] = list.includes(value) ? list.filter(item => item !== value) : [...list, value];
  if (!state.filters[key].length) delete state.filters[key];
  state.page = 0; run();
}
const valueLabel = (key, value) => (key === 'soort' ? soorten[value] ?? value : decode(value));
function renderFilters(aggregations, context) {
  $('active-filters').replaceChildren();
  if (state.binnen) {
    const chip = button(`Binnen: ${context?.label ?? state.binnen} ×`, () => setBinnen(null)); chip.className = 'chip-binnen';
    chip.setAttribute('aria-label', `Verwijder ${context?.label ?? state.binnen}`); $('active-filters').append(chip);
  }
  for (const [key, list] of Object.entries(state.filters)) for (const value of list) {
    const chip = button(`${facets[key]}: ${valueLabel(key, value)} ×`, () => toggleFilter(key, value));
    chip.setAttribute('aria-label', `Verwijder filter ${facets[key]}: ${valueLabel(key, value)}`); $('active-filters').append(chip);
  }
  if (Object.keys(state.filters).length || state.binnen) $('active-filters').append(button('Wis alle filters', () => { state.filters = {}; state.binnen = null; state.page = 0; syncForm(); run(); }));
  $('facets').replaceChildren();
  for (const [key, label] of Object.entries(facets)) {
    const group = el('details'); group.open = true;
    const selected = state.filters[key]?.length;
    group.append(el('summary', selected ? `${label} (${selected} gekozen)` : label));
    const aggregation = bucketsOf(aggregations[key]);
    if (!aggregation) { group.append(el('p', 'Deze facet is niet beschikbaar.', 'hint')); $('facets').append(group); continue; }
    // Gekozen waarden blijven zichtbaar, ook als ze niet bij de 100 meest voorkomende horen.
    const buckets = [...aggregation.buckets];
    for (const value of state.filters[key] ?? []) if (!buckets.some(bucket => bucket.key === value)) buckets.unshift({ key: value, doc_count: null });
    const list = el('ul', null, 'facet-list');
    for (const bucket of buckets) {
      const item = el('li'), option = el('label', null, 'facet-option'), box = el('input');
      box.type = 'checkbox'; box.checked = isActive(key, bucket.key); box.addEventListener('change', () => toggleFilter(key, bucket.key));
      const approximate = bucket.doc_count_error_upper_bound > 0;
      const name = el('span', valueLabel(key, bucket.key), 'facet-name');
      if (key === 'soort') name.dataset.soort = bucket.key;
      option.append(box, name, el('span', bucket.doc_count == null ? '' : `${approximate ? '≈ ' : ''}${format(bucket.doc_count)}`, 'facet-count'));
      item.append(option); list.append(item);
    }
    group.append(list);
    if (!buckets.length) group.append(el('p', 'Geen waarden bij deze zoekvraag.', 'hint'));
    if (aggregation.sum_other_doc_count > 0) group.append(el('p', 'De 100 meest voorkomende waarden. Verfijn je zoekvraag voor andere waarden.', 'hint'));
    $('facets').append(group);
  }
}
// Telling per gezicht/werelderfgoed, alleen als het blok open is (de request is groot).
let gebiedController;
async function countGebieden(context) {
  if (!$('gebied-facet').open || !$('query-json').textContent.startsWith('{')) return;
  gebiedController?.abort(); const current = new AbortController(); gebiedController = current;
  $('gebied-counts').replaceChildren(el('p', 'Tellen…', 'hint'));
  try {
    await gebiedenLoaded;
    const data = await search(buildGebiedQuery(state, context, gebieden.list), current.signal);
    if (gebiedController !== current) return;
    const buckets = Object.entries(data.aggregations.gebieden.buckets).filter(([, bucket]) => bucket.doc_count > 0).sort((a, b) => b[1].doc_count - a[1].doc_count);
    const list = el('ul', null, 'facet-list');
    for (const [key, bucket] of buckets.slice(0, 100)) {
      const g = gebieden.byKey.get(key), item = el('li'), option = button('', () => setBinnen(key), 'facet-option gebied-option');
      const name = el('span', `${decode(g.naam)}`, 'facet-name'); name.dataset.soort = g.soort;
      option.append(name, el('span', format(bucket.doc_count), 'facet-count'));
      option.title = `${soorten[g.soort]} ${g.nummer}: toon alleen wat hierin ligt`;
      item.append(option); list.append(item);
    }
    $('gebied-counts').replaceChildren(buckets.length ? list : el('p', 'Geen van de resultaten ligt in een gezicht of werelderfgoed.', 'hint'));
    if (buckets.length > 100) $('gebied-counts').append(el('p', `De 100 gebieden met de meeste resultaten van de ${buckets.length}.`, 'hint'));
  } catch (error) {
    if (gebiedController !== current || error.name === 'AbortError') return;
    console.error(error); $('gebied-counts').replaceChildren(el('p', 'Tellen per gebied is niet gelukt.', 'hint'));
  }
}
// Zoekformulier, URL en uitleg volgen de state.
function syncForm() {
  $('query').value = state.query; $('field').value = state.field; $('sort').value = state.sort; checkQuery();
  const g = state.binnen && gebieden.byKey.get(state.binnen);
  $('binnen').value = g ? gebiedLabel(g) : '';
}
function syncUrl(mode) {
  const query = toParams(state).toString();
  const url = `${location.pathname}${query ? `?${query}` : ''}`;
  if (mode === 'push' && url !== `${location.pathname}${location.search}`) history.pushState(null, '', url);
  else if (mode === 'replace') history.replaceState(null, '', url);
}
function explain(context) {
  const lines = describe(state, context?.label);
  $('explain').textContent = lines.slice(0, -1).join(' · ');
  $('explain').hidden = !$('explain').textContent;
  $('query-explain').replaceChildren(...lines.map(line => el('li', line)));
}
function renderContext(context) {
  $('context').replaceChildren(); $('context').hidden = !context;
  if (!context) return;
  const text = el('p'); text.append(el('strong', `Binnen ${context.label}`), document.createTextNode(`: ${context.summary}.`));
  const actions = el('div', null, 'links');
  const url = safeUrl(context.uri); if (url) actions.append(link('Linked Data', url));
  actions.append(button('Toon het gebied zelf', () => showObject(context.soort, context.nummer)), button('Niet meer binnen dit gebied zoeken', () => setBinnen(null)));
  $('context').append(text, actions);
}
// JSON-weergave: lange nummerlijsten (gebied) inkorten, zodat de query leesbaar blijft.
const readable = body => JSON.stringify(body, (key, value) => (Array.isArray(value) && value.length > 12 && value.every(item => typeof item === 'string') ? [...value.slice(0, 8), `… en nog ${value.length - 8}`] : value), 2);
async function run(urlMode = 'push') {
  controller?.abort(); const current = new AbortController(); controller = current;
  syncUrl(urlMode);
  $('error').hidden = true; $('status').textContent = 'Zoeken…'; $('workspace').setAttribute('aria-busy', 'true');
  $('results').replaceChildren(); renderMap([]); $('map-info').textContent = 'Zoeken…'; $('facets').replaceChildren(); $('active-filters').replaceChildren(); $('pagination').hidden = true; $('page-info').textContent = ''; $('export').disabled = true; $('export-info').textContent = '';
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; current.abort(); }, 20000);
  let context = null;
  try {
    context = await resolveContext(state.binnen);
    if (controller !== current) return;
    const body = buildQuery(state, context);
    $('query-json').textContent = readable(body); explain(context); renderContext(context);
    renderContextGeometry(context);
    context?.geometryLoaded?.then(() => { if (controller === current) { renderContextGeometry(context); needsFit = true; fitMarkers(); } });
    const data = await search(body, current.signal);
    if (controller !== current) return;
    const total = typeof data.hits.total === 'number' ? data.hits.total : data.hits.total.value;
    const exact = typeof data.hits.total === 'number' || data.hits.total.relation === 'eq';
    const hits = data.hits.hits;
    await gebiedenLoaded;
    renderResults(hits); renderFilters(data.aggregations, context);
    const onMap = renderMap(hits);
    loadRelations(hits, current.signal);
    countGebieden(context);
    $('status').textContent = `Totaal gevonden: ${exact ? '' : 'minimaal '}${format(total)} | Getoond: ${hits.length}${map ? ` | Op kaart: ${onMap}` : ''}`;
    $('page-info').textContent = hits.length ? `${format(state.page * PAGE_SIZE + 1)} tot ${format(state.page * PAGE_SIZE + hits.length)}` : '';
    $('pagination').hidden = total <= PAGE_SIZE;
    $('previous').disabled = state.page === 0;
    $('next').disabled = (state.page + 1) * PAGE_SIZE >= Math.min(total, MAX_WINDOW);
    $('page-number').textContent = `Pagina ${state.page + 1} van ${Math.max(1, Math.ceil(Math.min(total, MAX_WINDOW) / PAGE_SIZE))}`;
    lastTotal = total; $('export').disabled = total === 0;
    if (total > MAX_WINDOW) $('results').append(el('p', 'Je kunt maximaal de eerste 10.000 resultaten bekijken. Verfijn je zoekvraag voor de overige resultaten.', 'hint'));
  } catch (error) {
    if (controller !== current) return;
    $('status').textContent = 'Zoeken niet gelukt.';
    $('error').textContent = timedOut ? 'De zoekopdracht duurde te lang. Verfijn je zoekvraag en probeer opnieuw.' : error instanceof TypeError ? 'De zoekservice is niet bereikbaar. Controleer je verbinding en probeer opnieuw.' : error.message;
    $('error').hidden = false;
    renderFilters({}, context); renderMap([]);
  } finally { clearTimeout(timer); if (controller === current) $('workspace').setAttribute('aria-busy', 'false'); }
}
// Beginsituatie bewaren, zodat "Opnieuw beginnen" de pagina terugzet zonder te herladen.
const initial = Object.fromEntries(['status', 'facets', 'results', 'query-json', 'query-explain', 'map-info'].map(id => [id, [...$(id).childNodes].map(node => node.cloneNode(true))]));
function reset() {
  controller?.abort(); controller = undefined; gebiedController?.abort();
  Object.assign(state, blank()); syncForm(); syncUrl('push');
  $('explain').hidden = true; $('context').hidden = true; $('export').disabled = true; $('export-info').textContent = ''; $('gebied-counts').replaceChildren();
  for (const [id, nodes] of Object.entries(initial)) $(id).replaceChildren(...nodes.map(node => node.cloneNode(true)));
  $('active-filters').replaceChildren(); $('page-info').textContent = ''; $('pagination').hidden = true; $('error').hidden = true;
  $('workspace').setAttribute('aria-busy', 'false'); cards.clear();
  if (map) { markerLayer.clearLayers(); contextLayer.clearLayers(); markers.clear(); shapes.clear(); needsFit = false; map.setView([52.2, 5.3], 7); }
  setView('list'); $('query').focus();
}
$('reset').addEventListener('click', reset);
$('search-form').addEventListener('submit', event => {
  event.preventDefault();
  state.query = $('query').value; state.field = $('field').value; state.page = 0;
  const typed = $('binnen').value.trim();
  if (!typed) state.binnen = null;
  else if (gebieden.byLabel.has(typed)) state.binnen = gebieden.byLabel.get(typed);
  else if (!(state.binnen && gebieden.byKey.get(state.binnen) && gebiedLabel(gebieden.byKey.get(state.binnen)) === typed)) {
    // Vrije tekst: neem het eerste gebied waarvan de naam erop lijkt.
    const match = gebieden.list.find(g => decode(g.naam ?? '').toLowerCase().includes(typed.toLowerCase()));
    if (!match) { $('error').textContent = `Geen gezicht of werelderfgoed gevonden voor “${typed}”. Kies een naam uit de lijst.`; $('error').hidden = false; return; }
    state.binnen = `${match.soort}:${match.nummer}`;
  }
  syncForm(); run();
});
// Een gebied uit de lijst kiezen zoekt meteen.
$('binnen').addEventListener('change', () => { if (gebieden.byLabel.has($('binnen').value)) $('search-form').requestSubmit(); });
$('binnen').addEventListener('search', () => { if (!$('binnen').value && state.binnen) $('search-form').requestSubmit(); });
$('sort').addEventListener('change', () => { state.sort = $('sort').value; state.page = 0; if ($('query-json').textContent.startsWith('{')) run(); });
document.querySelectorAll('[data-example]').forEach(node => node.addEventListener('click', () => {
  $('help').close();
  Object.assign(state, { query: node.dataset.example, field: DEFAULT_FIELD, page: 0, binnen: node.dataset.binnen ?? null, filters: node.dataset.soort ? { soort: [node.dataset.soort] } : {} });
  syncForm(); run();
}));
$('help-open').addEventListener('click', () => $('help').showModal());
$('help-close').addEventListener('click', () => $('help').close());
$('help').addEventListener('click', event => { if (event.target === $('help')) $('help').close(); });
$('gebied-facet').addEventListener('toggle', () => { if ($('gebied-facet').open) countGebieden(contexts.get(state.binnen)); });
// Tip bij operatoren in kleine letters of Nederlandse varianten: die worden als gewone zoekwoorden gezien.
function checkQuery() {
  const words = [...new Set(($('query').value.replace(/"[^"]*"/g, ' ').match(/(?<![\p{L}\d])(and|or|not|en|of|niet)(?![\p{L}\d])/gu) || []))];
  const operator = { and: 'AND', en: 'AND', or: 'OR', of: 'OR', not: 'NOT', niet: 'NOT' };
  $('query-tip').textContent = words.length ? `Tip: ${words.map(word => `“${word}”`).join(', ')} wordt als zoekwoord gezien. Bedoel je ${[...new Set(words.map(word => operator[word]))].join(' / ')}? Schrijf operatoren in hoofdletters.` : '';
  $('query-tip').hidden = !words.length;
}
$('query').addEventListener('input', checkQuery);

$('previous').addEventListener('click', () => { state.page--; run(); });
$('next').addEventListener('click', () => { state.page++; run(); });
document.querySelectorAll('.view-toggle button').forEach(node => node.addEventListener('click', () => setView(node.dataset.view)));
wide.addEventListener('change', () => { if (map) { map.invalidateSize(); fitMarkers(); } });
// Deelbare link: de URL bevat altijd de huidige zoekactie.
$('share').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(location.href); $('share').textContent = 'Link gekopieerd'; }
  catch { window.prompt('Kopieer deze link:', location.href); }
  setTimeout(() => { $('share').textContent = 'Kopieer link'; }, 2500);
});
// CSV-export: dezelfde zoekactie, maximaal EXPORT_MAX rijen.
$('export').addEventListener('click', async () => {
  $('export').disabled = true; $('export-info').textContent = 'Export wordt gemaakt…';
  try {
    const data = await search(buildExportQuery(state, contexts.get(state.binnen)), AbortSignal.timeout(30000));
    const blob = new Blob([toCsv(data.hits.hits, decode, source => gebiedenVan(source).map(g => `${soorten[g.soort]} ${g.naam}`))], { type: 'text/csv;charset=utf-8' });
    const anchor = el('a'); anchor.href = URL.createObjectURL(blob); anchor.download = `erfgoed-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click(); setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
    $('export-info').textContent = lastTotal > EXPORT_MAX ? `De export bevat de eerste ${format(EXPORT_MAX)} van ${format(lastTotal)} resultaten.` : `${format(data.hits.hits.length)} resultaten geëxporteerd.`;
  } catch (error) {
    console.error(error); $('export-info').textContent = 'Exporteren is niet gelukt. Probeer het opnieuw.';
  } finally { $('export').disabled = false; }
});
for (const [key, { label }] of Object.entries(sorts)) { const option = el('option', label); option.value = key; $('sort').append(option); }
$('export').textContent = `Download CSV (max. ${format(EXPORT_MAX)})`;
// Zoekactie uit de URL laden: bij openen van een gedeelde link en bij terug/vooruit in de browser.
async function loadFromUrl() {
  const { state: next, active } = fromParams(location.search);
  Object.assign(state, next);
  await gebiedenLoaded; syncForm();
  if (active || next.sort !== 'relevantie') run('replace'); else reset();
}
window.addEventListener('popstate', loadFromUrl);
if (location.search) loadFromUrl();
