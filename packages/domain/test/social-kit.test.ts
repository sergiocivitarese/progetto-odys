import assert from 'node:assert/strict';
import test from 'node:test';
import { SOCIAL_FORMATS, socialKitContent, wrapWords } from '../src/lib/socialKit.ts';

const trip = {
  title: 'Matera e i Sassi in piccolo gruppo',
  destination: 'Matera',
  country: 'Italia',
  startDate: '2027-04-02',
  endDate: '2027-04-05',
  priceCents: 69000,
  currency: 'EUR',
  capacity: 12,
  seatsLeft: 12,
  interests: ['Storia', 'Cibo', 'Natura', 'Arte'],
  coordinatorName: 'Nora C.',
};

test('testi del kit social: meta, date, durata, prezzo, posti e link (CB-06)', () => {
  const content = socialKitContent(trip, 'https://odys.app/gruppi/abc');
  assert.equal(content.destination, 'MATERA');
  assert.equal(content.kicker, 'Italia · 4 giorni');
  assert.equal(content.dates, '2–5 aprile 2027');
  assert.equal(content.price, 'da 690 €');
  assert.equal(content.seats, '12 posti · piccolo gruppo');
  assert.deepEqual(content.tags, ['Storia', 'Cibo', 'Natura']);
  assert.equal(content.coordinator, 'con Nora C.');
  assert.equal(content.link, 'odys.app/gruppi/abc');
  assert.match(content.bioText, /Matera e i Sassi in piccolo gruppo · 2–5 aprile 2027 · da 690 €\nPrenota il tuo posto: https:\/\/odys\.app\/gruppi\/abc/);
});

test('date su mesi o anni diversi, posti in esaurimento, dati mancanti', () => {
  const across = socialKitContent({ ...trip, startDate: '2027-04-29', endDate: '2027-05-03', seatsLeft: 3 }, 'https://odys.app/gruppi/abc');
  assert.equal(across.dates, '29 aprile – 3 maggio 2027');
  assert.equal(across.seats, 'Ultimi 3 posti');
  const newYear = socialKitContent({ ...trip, startDate: '2027-12-30', endDate: '2028-01-02' }, 'https://odys.app/x');
  assert.equal(newYear.dates, '30 dicembre 2027 – 2 gennaio 2028');
  const bare = socialKitContent({ ...trip, startDate: undefined, endDate: undefined, priceCents: undefined, capacity: undefined, seatsLeft: undefined, country: '', interests: [] }, 'http://localhost:4200/gruppi/x');
  assert.equal(bare.dates, 'Date in arrivo');
  assert.equal(bare.price, '');
  assert.equal(bare.seats, '');
  assert.equal(bare.kicker, 'Viaggio di gruppo');
  assert.equal(bare.link, 'localhost:4200/gruppi/x');
  assert.equal(socialKitContent({ ...trip, seatsLeft: 1 }, 'https://o.app/g').seats, 'Ultimo posto');
  assert.equal(socialKitContent({ ...trip, seatsLeft: 0 }, 'https://o.app/g').seats, 'Tutto esaurito');
});

test('a capo per larghezza e formati delle grafiche', () => {
  const width = (text: string) => text.length * 10;
  assert.deepEqual(wrapWords('Matera e i Sassi in piccolo gruppo', 120, width), ['Matera e i', 'Sassi in', 'piccolo', 'gruppo']);
  // Una parola più lunga della riga resta intera; massimo di righe con puntini.
  assert.deepEqual(wrapWords('Supercalifragilistico breve', 100, width), ['Supercalifragilistico', 'breve']);
  assert.deepEqual(wrapWords('uno due tre quattro cinque sei', 80, width, 2), ['uno due', 'tre…']);
  assert.deepEqual(SOCIAL_FORMATS.story, { width: 1080, height: 1920, label: 'Story 9:16' });
  assert.deepEqual(SOCIAL_FORMATS.post, { width: 1080, height: 1350, label: 'Post 4:5' });
});
