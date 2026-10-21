// Maakt triply/elastic-service-nl5.json: de template van -nl4 (velden, geometrie, nummers) met de gedeelde
// Nederlandse analyse uit triply/nl-analyse.json. Die analyse is een kopie van elastic-ceo/triply/nl-analyse.json,
// de enige bron voor de taalanalyse van alle demo's (zie README, *Versie 5*).
// Gebruik: node triply/maak-nl5.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const map = new URL('.', import.meta.url);
const lees = naam => JSON.parse(readFileSync(new URL(naam, map), 'utf8'));
const analysis = lees('nl-analyse.json');

// Waarschuw als de kopie afwijkt van de bron in elastic-ceo (als die map er lokaal naast staat).
const bron = new URL('../../elastic-ceo/triply/nl-analyse.json', map);
if (existsSync(bron) && readFileSync(bron, 'utf8') !== readFileSync(new URL('nl-analyse.json', map), 'utf8')) {
  console.warn('LET OP: triply/nl-analyse.json wijkt af van elastic-ceo/triply/nl-analyse.json. Kopieer de bron eerst.');
}

const service = lees('elastic-service-nl4.json');
service.name = 'Erfgoed-sdo-nl5';
service.config.indexTemplates = service.config.indexTemplates.map(t => ({ ...t, name: 'erfgoed-nl5' }));
const taal = service.config.componentTemplates.find(c => c.name === 'nl-analyse');
taal.template.settings.analysis = analysis;

writeFileSync(new URL('elastic-service-nl5.json', map), JSON.stringify(service, null, 2) + '\n');
console.log(`triply/elastic-service-nl5.json: ${service.name}, analyse met ${Object.values(analysis).reduce((n, d) => n + Object.keys(d).length, 0)} onderdelen`);
