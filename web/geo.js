export const WKT_FIELD = 'http://www opengis net/ont/geosparql#asWKT';
const valid = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
const list = value => (Array.isArray(value) ? value : value == null ? [] : [value]);
// geoPoint kan in Elasticsearch als "lat,lon", {lat, lon}, [lon, lat] of WKT zijn opgeslagen.
function parseGeoPoint(value) {
  if (typeof value === 'string' && /^\s*-?[\d.]+\s*,\s*-?[\d.]+\s*$/.test(value)) { const [lat, lon] = value.split(',').map(Number); return { lat, lon }; }
  if (typeof value === 'string') return parsePointWkt(value);
  if (Array.isArray(value) && value.length >= 2) return { lat: Number(value[1]), lon: Number(value[0]) };
  if (value && typeof value === 'object') return { lat: Number(value.lat), lon: Number(value.lon) };
  return null;
}
// WKT is altijd POINT(longitude latitude); Leaflet wil [latitude, longitude].
function stripCrs(wkt) {
  const match = /^\s*<([^>]*)>\s*(.*)$/s.exec(wkt);
  if (!match) return wkt;
  return /CRS84|EPSG\/0\/4326/i.test(match[1]) ? match[2] : null;
}
function parsePointWkt(wkt) {
  const match = /^\s*POINT\s*Z?\s*\(\s*(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/i.exec(stripCrs(wkt) ?? '');
  return match ? { lat: Number(match[2]), lon: Number(match[1]) } : null;
}
// POLYGON/MULTIPOLYGON naar Leaflet-coördinaten: lijst van polygonen, elk een lijst ringen van [lat, lon].
function parseShapeWkt(wkt) {
  const match = /^\s*(MULTI)?POLYGON\s*Z?\s*(\(.*\))\s*$/is.exec(stripCrs(wkt) ?? '');
  if (!match) return null;
  try {
    const json = match[2].replace(/(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)(\s+-?[\d.eE+-]+)?/g, '[$2,$1]').replace(/\(/g, '[').replace(/\)/g, ']');
    const parsed = JSON.parse(json);
    const polygons = match[1] ? parsed : [parsed];
    const ok = polygons.every(rings => rings.every(ring => ring.length >= 3 && ring.every(([lat, lon]) => valid(lat, lon))));
    return ok && polygons.length ? polygons : null;
  } catch { return null; }
}
// Zwaartepunt van de grootste buitenring; alleen bedoeld als plek voor het label naast het getekende vlak.
function labelPoint(polygons) {
  let best = null;
  for (const [outer] of polygons) {
    let area = 0, cx = 0, cy = 0;
    for (let i = 0; i < outer.length; i++) {
      const [y1, x1] = outer[i], [y2, x2] = outer[(i + 1) % outer.length], cross = x1 * y2 - x2 * y1;
      area += cross; cx += (x1 + x2) * cross; cy += (y1 + y2) * cross;
    }
    const point = Math.abs(area) > 1e-18 ? { lat: cy / (3 * area), lon: cx / (3 * area) } : { lat: outer[0][0], lon: outer[0][1] };
    if (!best || Math.abs(area) > best.area) best = { ...point, area: Math.abs(area) };
  }
  return { lat: best.lat, lon: best.lon };
}
// Voorkeursvolgorde: geoPoint, dan POINT uit geo:asWKT, dan POLYGON/MULTIPOLYGON uit geo:asWKT.
// Een vlak wordt altijd als vlak getoond; het zwaartepunt draagt alleen het label met het monumentnummer.
export function geometryFor(source) {
  for (const value of list(source?.geoPoint)) { const p = parseGeoPoint(value); if (p && valid(p.lat, p.lon)) return { kind: 'punt', point: p }; }
  const wkts = list(source?.[WKT_FIELD]).filter(value => typeof value === 'string');
  for (const wkt of wkts) { const p = parsePointWkt(wkt); if (p && valid(p.lat, p.lon)) return { kind: 'punt', point: p }; }
  for (const wkt of wkts) { const polygons = parseShapeWkt(wkt); if (polygons) return { kind: 'vlak', point: labelPoint(polygons), polygons }; }
  return null;
}
