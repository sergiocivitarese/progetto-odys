import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Screen, Header, EmptyState } from '@/components/TravelUI';
import { useColors } from '@/hooks/useColors';
import { useSavedTrip } from '@/hooks/useSavedTrip';

export default function SavedTripsScreen() {
  const C = useColors();
  const router = useRouter();
  const { trips, loading } = useSavedTrip();

  return (
    <Screen>
      <Header eyebrow="Raccolta locale" title="Tutti i miei viaggi" onBack={() => router.back()} />
      <Text style={[s.intro, { color: C.mutedForeground }]}>I viaggi sono ordinati dall’ultima modifica e restano salvati su questo dispositivo.</Text>
      {!loading && trips.length === 0 ? (
        <EmptyState
          testID="empty-all-trips"
          icon="bookmark"
          title="La raccolta è vuota"
          description="I viaggi salvati restano sul dispositivo e sono disponibili anche senza connessione."
          actionLabel="Crea un viaggio"
          onAction={() => router.push('/create')}
        />
      ) : null}
      {trips.map((trip) => (
        <Pressable key={trip.id} onPress={() => router.push({ pathname: '/itinerary', params: { data: JSON.stringify(trip.itinerary), tripId: trip.id, saved: '1' } })} style={[s.card, { backgroundColor: C.card, borderColor: C.border }]}>
          <View style={[s.icon, { backgroundColor: C.secondary }]}><Feather name="map-pin" size={19} color={C.primary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={[s.title, { color: C.foreground }]}>{trip.title}</Text>
            <Text style={[s.meta, { color: C.mutedForeground }]}>{trip.itinerary.destination} · {trip.itinerary.duration} giorni</Text>
            <Text style={[s.meta, { color: C.mutedForeground }]}>Aggiornato {trip.updatedAt ? new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' }).format(new Date(trip.updatedAt)) : 'di recente'}</Text>
          </View>
          <Feather name="chevron-right" size={20} color={C.primary} />
        </Pressable>
      ))}
    </Screen>
  );
}

const s = StyleSheet.create({
  intro: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, marginBottom: 16 },
  card: { borderWidth: 1, borderRadius: 19, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  icon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 16, marginBottom: 3 },
  meta: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },
});