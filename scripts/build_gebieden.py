"""Bouwt web/data/gebieden.json: welke rijksmonumenten en complexen liggen in welk beschermd gezicht of werelderfgoed.

De Elasticsearch-index kan niet ruimtelijk zoeken (geo:asWKT staat als tekst, het veld geoShape is leeg) en de
SPARQL-endpoint kent geen GeoSPARQL-functies. Daarom wordt de koppeling hier eenmalig berekend (regel: zie METHODE).
De webdemo filtert daarna in Elasticsearch met een terms-query op de nummers.

Gebruik:  pip install shapely   en daarna   python scripts/build_gebieden.py
"""
import json
import re
import sys
import urllib.request
from datetime import date
from pathlib import Path

from shapely import STRtree, wkt as shapely_wkt
from shapely.prepared import prep

ENDPOINT = 'https://api.linkeddata.cultureelerfgoed.nl/datasets/rce/erfgoed-sdo/services/Erfgoed-sdo/_search'
BASE = 'https://linkeddata.cultureelerfgoed.nl/cho-kennis/id/'
WKT = 'http://www opengis net/ont/geosparql#asWKT'
S = 'https://schema org/'
OUT = Path(__file__).resolve().parent.parent / 'web' / 'data' / 'gebieden.json'


def search(body):
    request = urllib.request.Request(ENDPOINT, json.dumps(body).encode(), {'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.load(response)


def first(value):
    return (value[0] if isinstance(value, list) and value else value) if value is not None else None


def fetch(soort):
    """Alle documenten van één soort, met search_after (geen limiet van 10.000)."""
    docs, after = [], None
    while True:
        body = {'size': 1000, 'sort': [{'@id.keyword': 'asc'}], 'query': {'prefix': {'@id.keyword': f'{BASE}{soort}/'}},
                '_source': ['@id', WKT, f'{S}identifier', f'{S}name', f'{S}category']}
        if after:
            body['search_after'] = after
        hits = search(body)['hits']['hits']
        if not hits:
            return docs
        docs += [hit['_source'] for hit in hits]
        after = hits[-1]['sort']
        print(f'  {soort}: {len(docs)}', end='\r', file=sys.stderr)


def geometry(source):
    values = source.get(WKT) or []
    for value in [values] if isinstance(values, str) else values:
        text = value.strip()
        crs = re.match(r'^<([^>]*)>\s*(.*)$', text, re.S)
        if crs:
            if not re.search(r'CRS84|EPSG/0/4326', crs.group(1), re.I):
                continue
            text = crs.group(2)
        try:
            shape = shapely_wkt.loads(text)
        except Exception:
            continue
        if not shape.is_empty:
            return shape if shape.is_valid else shape.buffer(0)
    return None


def inside(shape, point, area, prepared):
    """Ligt dit monument in dit gebied? Zie METHODE."""
    if prepared.contains(point):
        return True
    if shape.area == 0:
        return False
    overlap = shape.intersection(area).area
    # Ook een klein gebied dat grotendeels binnen één groot monumentperceel valt (bijv. Eisinga Planetarium).
    return overlap >= 0.25 * shape.area or overlap >= 0.5 * area.area


METHODE = ('Een rijksmonument of complex ligt in een gebied als een punt op zijn geometrie (point_on_surface) binnen het vlak '
           'van het gebied valt, of als minstens een kwart van zijn vlak het gebied overlapt, of als het gebied voor minstens '
           'de helft binnen zijn vlak valt.')


def main():
    gebieden = []
    for soort in ('gezicht', 'werelderfgoed'):
        for source in fetch(soort):
            shape = geometry(source)
            if shape is None:
                print(f'\nZonder geometrie: {source["@id"]}', file=sys.stderr)
                continue
            gebieden.append({'soort': soort, 'nummer': first(source.get(f'{S}identifier')), 'naam': first(source.get(f'{S}name')),
                             'categorie': first(source.get(f'{S}category')), 'id': source['@id'], 'shape': shape})
    print(f'\nGebieden: {len(gebieden)}', file=sys.stderr)
    tree = STRtree([gebied['shape'] for gebied in gebieden])
    prepared = [prep(gebied['shape']) for gebied in gebieden]
    for gebied in gebieden:
        gebied['rijksmonument'], gebied['complex'] = [], []
    for soort in ('rijksmonument', 'complex'):
        zonder = 0
        for source in fetch(soort):
            shape, nummer = geometry(source), first(source.get(f'{S}identifier'))
            if shape is None or not nummer:
                zonder += 1
                continue
            point = shape.point_on_surface()
            for index in tree.query(shape, predicate='intersects'):
                if inside(shape, point, gebieden[index]['shape'], prepared[index]):
                    gebieden[index][soort].append(nummer)
        print(f'\n{soort}: {zonder} zonder geometrie of nummer overgeslagen', file=sys.stderr)
    result = []
    for gebied in sorted(gebieden, key=lambda g: (g['soort'] != 'werelderfgoed', (g['naam'] or '').lower())):
        minx, miny, maxx, maxy = gebied.pop('shape').bounds
        result.append({**gebied, 'bbox': [round(miny, 5), round(minx, 5), round(maxy, 5), round(maxx, 5)],
                       'rijksmonument': sorted(gebied['rijksmonument'], key=int), 'complex': sorted(gebied['complex'], key=int)})
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        'bijgewerkt': date.today().isoformat(),
        'methode': METHODE,
        'gebieden': result}, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'Geschreven: {OUT} ({OUT.stat().st_size // 1024} kB); monumenten in een gebied: '
          f'{len({n for g in result for n in g["rijksmonument"]})}', file=sys.stderr)


if __name__ == '__main__':
    main()
