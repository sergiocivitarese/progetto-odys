import React, { useCallback, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Screen, Header, Button, SectionTitle } from '@/components/TravelUI';
import { EmptyState } from '@/components/TravelUI';
import { OnboardingModal } from '@/components/OnboardingModal';
import { useColors } from '@/hooks/useColors';
import { useSavedTrip } from '@/hooks/useSavedTrip';
import { useOnboarding } from '@/hooks/useOnboarding';
import { parseTripExport } from '@/lib/tripTransfer';
import type { SavedTrip } from '@/types/travel';

export default function Home() {
  const C = useColors();
  const router = useRouter();
  const { trips, loading, remove, rename, save, refresh } = useSavedTrip();
  const onboarding = useOnboarding();
  const [renamingTrip, setRenamingTrip] = useState<SavedTrip | null>(null);
  const [deletingTrip, setDeletingTrip] = useState<SavedTrip | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [importVisible, setImportVisible] = useState(false);
  const [importValue, setImportValue] = useState('');
  const [importError, setImportError] = useState('');
  const [pendingImportedTrip, setPendingImportedTrip] = useState<SavedTrip | null>(null);
  const [importedMessage, setImportedMessage] = useState('');
  const latestTrip = trips[0];

  useFocusEffect(useCallback(() => {
    void refresh();
  }, [refresh]));

  const openTrip = (trip: SavedTrip) => {
    router.push({ pathname: '/itinerary', params: { data: JSON.stringify(trip.itinerary), tripId: trip.id, saved: '1' } });
  };
  const openRename = (trip: SavedTrip) => { setRenamingTrip(trip); setRenameValue(trip.title); };
  const closeRename = () => { setRenamingTrip(null); setRenameValue(''); };
  const confirmRename = async () => {
    if (!renamingTrip || !renameValue.trim()) return;
    await rename(renamingTrip.id, renameValue);
    closeRename();
  };
  const closeDelete = () => setDeletingTrip(null);
  const confirmDelete = async () => {
    if (!deletingTrip) return;
    await remove(deletingTrip.id);
    closeDelete();
  };
  const closeImport = () => {
    setImportVisible(false);
    setImportValue('');
    setImportError('');
    setPendingImportedTrip(null);
  };
  const persistImportedTrip = async (trip: SavedTrip) => {
    try {
      const existing = trips.find((item) => item.id === trip.id);
      await save(trip.itinerary, trip.id, trip.title);
      setImportedMessage(existing ? `“${trip.title}” è stato sostituito con l’export confermato.` : `“${trip.title}” è stato importato sul dispositivo.`);
      closeImport();
    } catch {
      setImportError('Non è stato possibile salvare il viaggio importato su questo dispositivo.');
    }
  };
  const submitImport = () => {
    const { trip, error } = parseTripExport(importValue);
    if (error || !trip) {
      setImportError(error ?? 'Non è stato possibile leggere questo export.');
      return;
    }
    if (trips.some((item) => item.id === trip.id)) {
      setPendingImportedTrip(trip);
      setImportError('');
      return;
    }
    void persistImportedTrip(trip);
  };

  return (
    <Screen>
      <Header eyebrow="Your trip, your way." title="Triply" onInfo={onboarding.reopen} />
      <View style={[s.welcome, { backgroundColor: C.backgroundDark }]}>
        <View style={s.copy}>
          <Text style={[s.kicker, { color: C.secondary }]}>PARTI CON UN’IDEA</Text>
          <Text style={[s.welcomeTitle, { color: C.card }]}>Il viaggio giusto, senza il rumore.</Text>
          <Text style={[s.body, { color: C.primaryContainer }]}>Costruisci un itinerario che segue il tuo ritmo, non il contrario.</Text>
          <Button onPress={() => router.push('/create')} icon="arrow-up-right">Pianifica il mio viaggio</Button>
        </View>
        <View style={[s.orbit, { borderColor: C.primary }]}><Feather name="compass" size={54} color={C.accent} /></View>
      </View>
      <Button testID="open-import-trip" variant="ghost" icon="upload" onPress={() => { setImportVisible(true); setImportedMessage(''); }}>Importa viaggio JSON</Button>
      {importedMessage ? <Text testID="import-trip-message" style={[s.importMessage, { color: C.primary }]}>{importedMessage}</Text> : null}

      {!loading && (
        <>
          <SectionTitle title="Viaggi salvati" action={trips.length > 0 ? `${trips.length} ${trips.length === 1 ? 'viaggio' : 'viaggi'}` : undefined} />
          {trips.length > 0 ? (
            <>
              {trips.map((savedTrip) => (
                <SavedTripCard key={savedTrip.id} trip={savedTrip} onOpen={openTrip} onRename={openRename} onDelete={setDeletingTrip} />
              ))}
              {trips.length > 1 ? <Button testID="view-all-trips" variant="ghost" onPress={() => router.push('/trips')} icon="list">Vedi tutti i miei viaggi</Button> : null}
            </>
          ) : (
            <EmptyState
              testID="empty-saved-trips"
              icon="bookmark"
              title="Nessun viaggio salvato ancora"
              description="Parti da un’idea e salvala sul dispositivo per ritrovarla anche offline."
              actionLabel="Crea il primo viaggio"
              onAction={() => router.push('/create')}
            />
          )}
        </>
      )}

      <SectionTitle title="Il tuo prossimo viaggio" action={latestTrip ? 'Ultimo aggiornato' : 'Demo'} />
      {latestTrip ? (
        <Pressable testID="latest-trip" onPress={() => openTrip(latestTrip)} style={[s.tripCard, { backgroundColor: C.card, borderColor: C.border }]}>
          <View style={[s.latestAccent, { backgroundColor: C.primary }]}><Feather name="bookmark" size={22} color={C.sand} /></View>
          <View style={s.latestBody}>
            <Text style={[s.tripKicker, { color: C.primary }]}>{latestTrip.updatedAt ? `AGGIORNATO ${new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' }).format(new Date(latestTrip.updatedAt))}` : 'VIAGGIO SALVATO'}</Text>
            <Text style={[s.latestTitle, { color: C.foreground }]}>{latestTrip.title}</Text>
            <Text style={[s.latestMeta, { color: C.mutedForeground }]}>{latestTrip.itinerary.destination} · {latestTrip.itinerary.duration} {latestTrip.itinerary.duration === 1 ? 'giorno' : 'giorni'}</Text>
            <Text style={[s.latestMeta, { color: C.mutedForeground }]}>{latestTrip.itinerary.departure ?? 'Date da definire'} · {latestTrip.itinerary.pace}</Text>
          </View>
          <Feather name="arrow-right" size={20} color={C.primary} />
        </Pressable>
      ) : (
        <EmptyState
          testID="empty-no-itinerary"
          icon="compass"
          title="Nessun itinerario generato"
          description="Crea un piano da una destinazione, le date e il tuo ritmo. I dettagli possono restare da definire."
          actionLabel="Pianifica un viaggio"
          onAction={() => router.push('/create')}
        />
      )}

      <SectionTitle title="Viaggi di gruppo da scoprire" action="Vedi tutti" />
      <View style={[s.discovery, { backgroundColor: C.secondary }]}>
        <View style={[s.discoveryIcon, { backgroundColor: C.card }]}><Feather name="users" size={20} color={C.primary} /></View>
        <View style={{ flex: 1 }}>
          <Text style={[s.discoveryTitle, { color: C.foreground }]}>Trova la tua prossima compagnia</Text>
          <Text style={[s.discoveryText, { color: C.mutedForeground }]}>Itinerari pubblici demo creati da persone che viaggiano come te.</Text>
        </View>
        <Pressable onPress={() => router.push('/groups')} hitSlop={10}><Feather name="arrow-right" size={20} color={C.primary} /></Pressable>
      </View>

      <Modal visible={renamingTrip !== null} transparent animationType="fade" onRequestClose={closeRename}>
        <View style={[s.modalBackdrop, { backgroundColor: C.overlay }]}><View style={[s.renameCard, { backgroundColor: C.card, borderColor: C.border }]}>
          <Text style={[s.renameTitle, { color: C.foreground }]}>Rinomina viaggio</Text>
          <Text style={[s.renameHint, { color: C.mutedForeground }]}>Scegli un nome per ritrovarlo più facilmente.</Text>
          <TextInput testID="rename-trip-input" autoFocus value={renameValue} onChangeText={setRenameValue} placeholder="Nome del viaggio" placeholderTextColor={C.mutedForeground} style={[s.renameInput, { color: C.foreground, backgroundColor: C.background, borderColor: C.border }]} />
          <View style={s.renameActions}><Button testID="cancel-rename-trip" variant="ghost" onPress={closeRename} icon="x">Annulla</Button><Button testID="confirm-rename-trip" onPress={() => void confirmRename()} disabled={!renameValue.trim()} icon="check">Salva nome</Button></View>
        </View></View>
      </Modal>

      <Modal visible={deletingTrip !== null} transparent animationType="fade" onRequestClose={closeDelete}>
        <View style={[s.modalBackdrop, { backgroundColor: C.overlay }]}><View style={[s.renameCard, { backgroundColor: C.card, borderColor: C.border }]}>
          <Text style={[s.renameTitle, { color: C.foreground }]}>Eliminare il viaggio?</Text>
          <Text style={[s.renameHint, { color: C.mutedForeground }]}>{deletingTrip ? `“${deletingTrip.title}” verrà rimosso da questo dispositivo.` : ''}</Text>
          <View style={s.renameActions}><Button testID="cancel-delete-trip" variant="ghost" onPress={closeDelete} icon="x">Annulla</Button><Pressable testID="confirm-delete-trip" accessibilityRole="button" onPress={() => void confirmDelete()} style={[s.deleteConfirmButton, { backgroundColor: C.destructive }]}><Feather name="trash-2" size={18} color={C.destructiveForeground} /><Text style={[s.deleteConfirmText, { color: C.destructiveForeground }]}>Elimina viaggio</Text></Pressable></View>
        </View></View>
      </Modal>

      <Modal visible={importVisible} transparent animationType="fade" onRequestClose={closeImport}>
        <View style={[s.modalBackdrop, { backgroundColor: C.overlay }]}><View style={[s.renameCard, { backgroundColor: C.card, borderColor: C.border }]}>
          <Text style={[s.renameTitle, { color: C.foreground }]}>{pendingImportedTrip ? 'Sostituire il viaggio esistente?' : 'Importa viaggio JSON'}</Text>
          {pendingImportedTrip ? (
            <>
              <Text style={[s.renameHint, { color: C.mutedForeground }]}>L’export contiene “{pendingImportedTrip.title}” con lo stesso identificativo di un viaggio già salvato. Conferma prima di sostituirlo su questo dispositivo.</Text>
              <View style={s.renameActions}><Button testID="cancel-import-overwrite" variant="ghost" onPress={() => setPendingImportedTrip(null)} icon="x">Annulla</Button><Button testID="confirm-import-overwrite" onPress={() => void persistImportedTrip(pendingImportedTrip)} icon="check">Sostituisci</Button></View>
            </>
          ) : (
            <>
              <Text style={[s.renameHint, { color: C.mutedForeground }]}>Incolla un export Triply v5. I file corrotti o di un’altra versione vengono rifiutati senza modificare i viaggi già salvati.</Text>
              {importError ? <Text testID="import-trip-error" style={[s.importError, { color: C.destructive }]}>{importError}</Text> : null}
              <TextInput testID="import-trip-json" value={importValue} onChangeText={(value) => { setImportValue(value); setImportError(''); }} multiline placeholder='{"format":"travel-companion-trip", ...}' placeholderTextColor={C.mutedForeground} style={[s.importInput, { color: C.foreground, backgroundColor: C.background, borderColor: C.border }]} />
              <View style={s.renameActions}><Button testID="cancel-import-trip" variant="ghost" onPress={closeImport} icon="x">Annulla</Button><Button testID="confirm-import-trip" onPress={submitImport} disabled={!importValue.trim()} icon="upload">Importa</Button></View>
            </>
          )}
        </View></View>
      </Modal>
      {onboarding.ready ? <OnboardingModal visible={onboarding.visible} onComplete={() => void onboarding.complete()} onSkip={() => void onboarding.skip()} /> : null}
    </Screen>
  );
}

function SavedTripCard({ trip, onOpen, onRename, onDelete }: { trip: SavedTrip; onOpen: (trip: SavedTrip) => void; onRename: (trip: SavedTrip) => void; onDelete: (trip: SavedTrip) => void }) {
  const C = useColors();
  return (
    <View testID={`saved-trip-${trip.id}`} style={[s.savedCard, { backgroundColor: C.card, borderColor: C.border }]}>
      <View style={s.savedTop}>
        <View style={[s.savedIcon, { backgroundColor: C.secondary }]}><Feather name="bookmark" size={18} color={C.primary} /></View>
        <View style={{ flex: 1 }}>
          <Text style={[s.savedTitle, { color: C.foreground }]}>{trip.title}</Text>
          <Text style={[s.savedDestination, { color: C.mutedForeground }]}>{trip.itinerary.destination}</Text>
          <Text style={[s.savedText, { color: C.mutedForeground }]}>{trip.itinerary.duration} giorni · {trip.itinerary.pace} · {trip.itinerary.estimate}</Text>
        </View>
      </View>
      <View style={s.savedActions}>
        <Button testID={`open-trip-${trip.id}`} onPress={() => onOpen(trip)} icon="arrow-right">Riapri viaggio</Button>
        <View style={s.secondaryActions}>
          <Pressable testID={`rename-trip-${trip.id}`} accessibilityRole="button" accessibilityLabel={`Rinomina ${trip.title}`} onPress={() => onRename(trip)} style={s.actionButton}><Feather name="edit-3" size={17} color={C.primary} /><Text style={[s.actionText, { color: C.primary }]}>Rinomina</Text></Pressable>
          <Pressable testID={`delete-trip-${trip.id}`} accessibilityRole="button" accessibilityLabel={`Elimina ${trip.title}`} onPress={() => onDelete(trip)} style={s.actionButton}><Feather name="trash-2" size={17} color={C.destructive} /><Text style={[s.actionText, { color: C.destructive }]}>Elimina</Text></Pressable>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  welcome: { borderRadius: 28, padding: 22, minHeight: 238, overflow: 'hidden', flexDirection: 'row' },
  copy: { flex: 1, gap: 12 },
  kicker: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 1.2 },
  welcomeTitle: { fontFamily: 'Inter_700Bold', fontSize: 29, lineHeight: 34, maxWidth: 240 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, maxWidth: 240 },
  orbit: { position: 'absolute', right: -30, top: 30, width: 150, height: 150, borderRadius: 90, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  savedCard: { borderRadius: 21, borderWidth: 1, padding: 15, marginBottom: 12 },
  savedTop: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  savedIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  savedTitle: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  savedDestination: { fontFamily: 'Inter_500Medium', fontSize: 12, marginTop: 3 },
  savedText: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 3 },
  savedActions: { gap: 11, marginTop: 15 },
  secondaryActions: { flexDirection: 'row', gap: 10 },
  actionButton: { flex: 1, minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  actionText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  tripCard: { borderRadius: 24, borderWidth: 1, overflow: 'hidden', minHeight: 144, flexDirection: 'row', alignItems: 'center', padding: 17 },
  latestAccent: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginRight: 13 },
  latestBody: { flex: 1 },
  tripKicker: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.9 },
  latestTitle: { fontFamily: 'Inter_700Bold', fontSize: 23, marginVertical: 4 },
  latestMeta: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },
  discovery: { borderRadius: 21, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  discoveryIcon: { width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  discoveryTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14, marginBottom: 4 },
  discoveryText: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },
  modalBackdrop: { flex: 1, justifyContent: 'center', padding: 20 },
  renameCard: { borderRadius: 22, borderWidth: 1, padding: 18 },
  renameTitle: { fontFamily: 'Inter_700Bold', fontSize: 19 },
  renameHint: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, marginTop: 5 },
  renameInput: { minHeight: 48, borderRadius: 14, borderWidth: 1, paddingHorizontal: 13, fontFamily: 'Inter_400Regular', fontSize: 14, marginTop: 16 },
  renameActions: { gap: 9, marginTop: 16 },
  importMessage: { fontFamily: 'Inter_500Medium', fontSize: 12, lineHeight: 17, marginTop: 10 },
  importError: { fontFamily: 'Inter_600SemiBold', fontSize: 12, lineHeight: 17, marginTop: 12 },
  importInput: { minHeight: 150, borderRadius: 14, borderWidth: 1, padding: 12, textAlignVertical: 'top', fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 14 },
  deleteConfirmButton: { minHeight: 52, borderRadius: 17, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9, paddingHorizontal: 18 },
  deleteConfirmText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
});