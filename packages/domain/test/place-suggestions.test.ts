import assert from 'node:assert/strict';
import test from 'node:test';
import { FALLBACK_TRIP_FORM, generateItinerary, openStreetMapUrl, PhotonSuggestionProvider, photonFeatureToNode } from '../src/index.ts';

const lisbon = { properties: { osm_type: 'R', osm_id: 5400890, osm_key: 'place', osm_value: 'city', type: 'city', name: 'Lisbon', county: 'Lisbon', country: 'Portugal', countrycode: 'PT' }, geometry: { coordinates: [-9.1365919, 38.7077507] as [number, number] } };
const street = { properties: { osm_type: 'W', osm_id: 42, osm_key: 'highway', type: 'street', name: 'Via Lisbona', city: 'Padova', country: 'Italy', countrycode: 'IT' }, geometry: { coordinates: [11.87, 45.4] as [number, number] } };
const trevi = { properties: { osm_type: 'N', osm_id: 7, osm_key: 'tourism', osm_value: 'attraction', type: 'house', name: 'Fontana di Trevi', city: 'Roma', country: 'Italy', countrycode: 'IT' }, geometry: { coordinates: [12.4833, 41.9009] as [number, number] } };

function fakeFetch(features: unknown[], seen: string[] = []) {
  return async (input: RequestInfo | URL) => {
    seen.push(String(input));
    return new Response(JSON.stringify({ features }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

test('un risultato Photon diventa un luogo confermato con riferimento OpenStreetMap e paese in italiano', () => {
  const node = photonFeatureToNode(lisbon, 'place')!.node;
  assert.equal(node.label, 'Lisbon, Portogallo');
  assert.equal(node.osmId, 'relation/5400890');
  assert.equal(node.geoStatus, 'CONFIRMED');
  assert.equal(node.type, 'final');
  assert.equal(openStreetMapUrl(node), 'https://www.openstreetmap.org/relation/5400890');
});

test('per la destinazione le città vengono prima delle vie; per un punto restano i luoghi precisi', async () => {
  const urls: string[] = [];
  const places = await new PhotonSuggestionProvider(fakeFetch([street, lisbon], urls)).suggest({ query: 'Lisbona', kind: 'place' });
  assert.deepEqual(places.map((node) => node.label), ['Lisbon, Portogallo']);
  assert.match(urls[0], /layer=city/);
  const points = await new PhotonSuggestionProvider(fakeFetch([trevi])).suggest({ query: 'Fontana di Trevi', kind: 'point' });
  assert.deepEqual(points.map((node) => node.label), ['Fontana di Trevi, Roma, Italia']);
});

test('senza riferimento OSM il collegamento usa le coordinate; senza coordinate non c’è collegamento', () => {
  assert.equal(openStreetMapUrl({ latitude: 41.9, longitude: 12.5 }), 'https://www.openstreetmap.org/?mlat=41.90000&mlon=12.50000#map=15/41.90000/12.50000');
  assert.equal(openStreetMapUrl({}), null);
});

test('una destinazione scelta tra i suggerimenti nasce confermata nel piano', () => {
  const destinationPoint = photonFeatureToNode(lisbon, 'place')!.node;
  const confirmed = generateItinerary({ ...FALLBACK_TRIP_FORM, destination: destinationPoint.label, destinationPoint, departure: '2027-03-10', returnDate: '2027-03-12' });
  assert.equal(confirmed.destinationNode?.geoStatus, 'CONFIRMED');
  assert.equal(confirmed.destinationNode?.latitude, 38.7077507);
  // Se dopo la scelta il testo è stato cambiato, la posizione non si riusa.
  const edited = generateItinerary({ ...FALLBACK_TRIP_FORM, destination: 'Porto', destinationPoint, departure: '2027-03-10', returnDate: '2027-03-12' });
  assert.notEqual(edited.destinationNode?.geoStatus, 'CONFIRMED');
});
