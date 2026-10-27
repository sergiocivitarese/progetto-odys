import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button, Header, InfoRow, Screen, SectionTitle } from '@/components/TravelUI';
import { findPlace } from '@/data/places';
import { useColors } from '@/hooks/useColors';
import { useSavedTrip } from '@/hooks/useSavedTrip';
import { recalculateRoutes } from '@/lib/generateItinerary';
import { searchGeoapifyPlaces } from '@/lib/locationServices';
import type { Activity, Itinerary, LocationNode, PlaceMetadata } from '@/types/travel';

function parsePlace(value?: string | string[]): PlaceMetadata {
  try {
    const raw = Array.isArray(value) ? value[0] : value;
    if (!raw) return findPlace('mercato-locale');
    const place = JSON.parse(raw) as PlaceMetadata;
    const fallback = findPlace(place.id, place.title, place.city);
    return { ...fallback, ...place };
  } catch {
    return findPlace('mercato-locale');
  }
}

export default function PlaceScreen() {
  const C = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ data?: string; tripId?: string }>();
  const tripId = Array.isArray(params.tripId) ? params.tripId[0] : params.tripId;
  const initialPlace = useMemo(() => parsePlace(params.data), [params.data]);
  const [place, setPlace] = useState(initialPlace);
  const { trips, save } = useSavedTrip();
  const [audioOpen, setAudioOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [locationEditorOpen, setLocationEditorOpen] = useState(false);
  const [locationQuery, setLocationQuery] = useState('');
  const [locationResults, setLocationResults] = useState<LocationNode[]>([]);
  const [locationMessage, setLocationMessage] = useState('');
  const trip = tripId ? trips.find((item) => item.id === tripId) : undefined;

  const addToTrip = async () => {
    if (!trip) {
      setMessage('Salva prima il viaggio: potrai poi aggiungere questa tappa senza perderla.');
      return;
    }
    const alreadyPresent = trip.itinerary.days.some((day) => day.activities.some((activity) => activity.place?.id === place.id));
    if (alreadyPresent) {
      setMessage('Questo luogo è già presente nel viaggio.');
      return;
    }
    const activity: Activity = {
      time: '16:30',
      title: place.title,
      detail: place.whyRecommended,
      category: place.category,
      transport: 'a piedi',
      setting: place.setting ?? 'outdoor',
      requiresBooking: false,
      place,
    };
    const itinerary: Itinerary = {
      ...trip.itinerary,
      days: trip.itinerary.days.map((day, index) => index === 0 ? { ...day, activities: [...day.activities, activity] } : day),
      version: 5,
    };
    await save(recalculateRoutes(itinerary, itinerary.lodging), trip.id, trip.title);
    setMessage('Luogo aggiunto al primo giorno del viaggio.');
  };

  const searchLocation = async () => {
    const result = await searchGeoapifyPlaces(locationQuery);
    setLocationResults(result.nodes);
    setLocationMessage(result.message ?? (result.nodes.length ? 'Scegli il luogo corretto per confermare la posizione.' : 'Nessun risultato: conserviamo il testo senza inventare una posizione.'));
  };

  const selectLocation = (node: LocationNode) => {
    setPlace((current) => ({
      ...current,
      id: node.providerPlaceId ? `geoapify-${node.providerPlaceId}` : current.id,
      title: node.label,
      address: node.address ?? current.address,
      city: node.city ?? current.city,
      country: node.country ?? current.country,
      timezone: node.timezone ?? current.timezone,
      latitude: node.latitude,
      longitude: node.longitude,
      placeId: node.providerPlaceId ?? node.providerId ?? current.placeId,
      providerId: node.providerId,
      providerPlaceId: node.providerPlaceId,
      confidence: node.confidence,
      source: node.source ?? current.source,
      updatedAt: node.updatedAt ?? current.updatedAt,
      geoStatus: node.geoStatus === 'TO_VERIFY' ? 'TO_VERIFY' : 'CONFIRMED',
    }));
    setLocationResults([]);
    setLocationEditorOpen(false);
    setMessage('Luogo aggiornato: la posizione selezionata verrà salvata quando lo aggiungi al viaggio.');
  };

  return (
    <Screen>
      <Header eyebrow="Guida luogo" title={place.title} onBack={() => router.back()} />
      <View style={[s.hero, { backgroundColor: C.backgroundDark }]}>
        <View style={[s.icon, { backgroundColor: C.accent }]}><Feather name="map-pin" size={23} color={C.accentForeground} /></View>
        <Text style={[s.heroTitle, { color: C.card }]}>{place.title}</Text>
        <Text style={[s.heroMeta, { color: C.primaryContainer }]}>{place.city ?? 'Località da definire'} · {place.category}</Text>
        <Text style={[s.source, { color: C.secondary }]}>{place.source} · aggiornato {place.updatedAt}</Text>
      </View>

      <SectionTitle title="Perché visitarlo" />
      <Text style={[s.body, { color: C.foreground }]}>{place.whyRecommended}</Text>
      <SectionTitle title="Una guida per orientarti" />
      <Text style={[s.subheading, { color: C.foreground }]}>Storia</Text>
      <Text style={[s.body, { color: C.mutedForeground }]}>Questo testo è una guida demo originale: propone un modo di leggere il luogo attraverso la sua posizione, le persone che lo attraversano e i dettagli che rendono utile fermarsi, senza riprodurre contenuti di editori terzi.</Text>
      <Text style={[s.subheading, { color: C.foreground }]}>Cosa osservare</Text>
      {['Il rapporto tra il luogo e il quartiere', 'Luce, materiali e dettagli architettonici', 'Il ritmo della strada e le soste vicine'].map((item) => <Text key={item} style={[s.listItem, { color: C.mutedForeground }]}>• {item}</Text>)}

      <SectionTitle title="Informazioni pratiche" />
      <View style={[s.infoCard, { backgroundColor: C.card, borderColor: C.border }]}>
        <InfoRow icon="clock" title="Durata consigliata" value={place.visitDuration ?? 'Da verificare'} />
        <InfoRow icon="calendar" title="Orari" value={place.openingHours ?? 'Da verificare'} />
        <InfoRow icon="credit-card" title="Costi" value="Da verificare" />
        <InfoRow icon="bookmark" title="Prenotazione" value="Da verificare" />
        <InfoRow icon="heart" title="Accessibilità" value="Da verificare" />
        <InfoRow icon="navigation" title="Come arrivare" value={place.geoStatus === 'MISSING' ? 'Inserisci alloggio per calcolare' : 'Percorso demo da verificare'} />
      </View>
      <Text style={[s.sourceNote, { color: C.mutedForeground }]}>Stato geolocalizzazione: {place.geoStatus === 'DEMO' ? 'simulato' : place.geoStatus === 'MISSING' ? 'posizione assente' : place.geoStatus.toLowerCase()}. Nessun dato è presentato come reale.</Text>
      <Text style={[s.sourceNote, { color: C.mutedForeground }]}>Località: {place.city ?? 'Da definire'} · Paese: {place.country ?? 'Da verificare'} · Fuso: {place.timezone ?? 'Da verificare'}</Text>

      <Pressable testID="edit-place-location" onPress={() => setLocationEditorOpen((open) => !open)} style={[s.editLocation, { backgroundColor: C.secondary, borderColor: C.border }]}>
        <Feather name="edit-3" size={16} color={C.primary} /><Text style={[s.editLocationText, { color: C.primary }]}>Modifica luogo</Text>
      </Pressable>
      {locationEditorOpen ? (
        <View testID="place-location-editor" style={[s.locationEditor, { backgroundColor: C.card, borderColor: C.border }]}>
          <Text style={[s.locationLabel, { color: C.foreground }]}>Cerca per nome o indirizzo</Text>
          <TextInput testID="place-location-query" value={locationQuery} onChangeText={setLocationQuery} placeholder="Es. Museo del Prado, Madrid" placeholderTextColor={C.mutedForeground} style={[s.locationInput, { borderColor: C.border, color: C.foreground }]} />
          <Button testID="search-place-location" onPress={() => void searchLocation()} icon="search">Cerca posizione</Button>
          {locationMessage ? <Text style={[s.locationHint, { color: C.mutedForeground }]}>{locationMessage}</Text> : null}
          {locationResults.map((node) => <Pressable key={node.id} testID={`select-place-location-${node.id}`} onPress={() => selectLocation(node)} style={[s.locationResult, { borderColor: C.border }]}><Feather name="map-pin" size={14} color={C.primary} /><View style={{ flex: 1 }}><Text style={[s.locationLabel, { color: C.foreground }]}>{node.label}</Text><Text style={[s.locationHint, { color: C.mutedForeground }]}>Fonte: {node.source ?? 'Fonte non disponibile'}</Text></View></Pressable>)}
        </View>
      ) : null}

      <Pressable testID="open-demo-audio" onPress={() => setAudioOpen((open) => !open)} style={[s.audio, { backgroundColor: C.secondary, borderColor: C.border }]}>
        <Feather name="headphones" size={19} color={C.primary} /><View style={{ flex: 1 }}><Text style={[s.audioTitle, { color: C.foreground }]}>Audioguida demo</Text><Text style={[s.audioText, { color: C.mutedForeground }]}>{audioOpen ? 'Traccia demo pronta: osserva il luogo con calma e scegli ciò che ti incuriosisce.' : 'Apri una breve traccia testuale demo.'}</Text></View>
      </Pressable>

      {message ? <Text testID="place-action-message" style={[s.message, { color: C.primary }]}>{message}</Text> : null}
      <Button testID="add-place-to-trip" onPress={() => void addToTrip()} icon="plus">Aggiungi al viaggio</Button>
    </Screen>
  );
}

const s = StyleSheet.create({
  hero: { borderRadius: 24, padding: 19 },
  icon: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { fontFamily: 'Inter_700Bold', fontSize: 27, marginTop: 13 },
  heroMeta: { fontFamily: 'Inter_500Medium', fontSize: 13, marginTop: 4 },
  source: { fontFamily: 'Inter_400Regular', fontSize: 10, marginTop: 14 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21 },
  subheading: { fontFamily: 'Inter_700Bold', fontSize: 14, marginTop: 12, marginBottom: 5 },
  listItem: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 20 },
  infoCard: { borderWidth: 1, borderRadius: 18, padding: 14 },
  sourceNote: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16, marginTop: 10, marginBottom: 16 },
  editLocation: { minHeight: 42, borderRadius: 13, borderWidth: 1, paddingHorizontal: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 7, marginBottom: 12 },
  editLocationText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  locationEditor: { borderRadius: 15, borderWidth: 1, padding: 12, marginBottom: 13 },
  locationLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  locationInput: { minHeight: 42, borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, marginTop: 7, marginBottom: 9, fontFamily: 'Inter_400Regular', fontSize: 12 },
  locationHint: { fontFamily: 'Inter_400Regular', fontSize: 10, lineHeight: 14, marginTop: 7 },
  locationResult: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, marginTop: 8, flexDirection: 'row', gap: 7 },
  audio: { borderRadius: 18, borderWidth: 1, padding: 13, flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 13 },
  audioTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  audioText: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16, marginTop: 2 },
  message: { fontFamily: 'Inter_600SemiBold', fontSize: 12, lineHeight: 17, marginBottom: 12 },
});