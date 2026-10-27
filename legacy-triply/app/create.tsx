import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { Screen, Header, Button, Pill } from '@/components/TravelUI';
import { useColors } from '@/hooks/useColors';
import { useSavedTrip } from '@/hooks/useSavedTrip';
import { generateItinerary, validateArrivalDate, validateDateRange, validateSchedule, validateTime } from '@/lib/generateItinerary';
import { nodeIdForLabel } from '@/lib/routeModel';
import type { ArrivalDestinationKind, ArrivalTransport, Interest, LocationNode, Pace, RecommendedInterest, TripForm } from '@/types/travel';

const interests: RecommendedInterest[] = ['Arte', 'Cibo', 'Natura', 'Storia', 'Benessere', 'Design'];
const paceOptions: Pace[] = ['rilassato', 'equilibrato', 'intenso'];
const arrivalModes: ArrivalTransport[] = ['aereo', 'treno', 'auto', 'autobus', 'traghetto', 'altro'];
const arrivalLabels: Record<ArrivalTransport, string> = { aereo: 'Aereo', treno: 'Treno', auto: 'Auto', autobus: 'Autobus', traghetto: 'Traghetto', altro: 'Altro' };

function slug(value: string) {
  return value.toLocaleLowerCase('it').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'destinazione';
}

function pointType(mode: ArrivalTransport): LocationNode['type'] {
  if (mode === 'aereo') return 'airport';
  if (mode === 'treno') return 'station';
  if (mode === 'traghetto') return 'port';
  return 'custom';
}

function pointLabel(mode: ArrivalTransport, destination: string) {
  const city = destination.trim() || 'la destinazione';
  if (mode === 'aereo') return `Aeroporto di ${city}`;
  if (mode === 'treno') return `Stazione di ${city}`;
  if (mode === 'traghetto') return `Porto o terminal di ${city}`;
  if (mode === 'autobus') return `Terminal autobus di ${city}`;
  return mode === 'auto' ? `Città o indirizzo a ${city}` : `Punto di arrivo a ${city}`;
}

function arrivalOption(mode: ArrivalTransport, destination: string): LocationNode {
  const label = pointLabel(mode, destination);
  return {
    id: `arrival-${slug(destination)}-${mode}`,
    label,
    type: pointType(mode),
    placeId: `demo-arrivo-${mode}-${slug(destination)}`,
    city: destination.trim() || undefined,
    country: 'Da verificare',
    timezone: 'Da verificare',
    source: 'Catalogo demo locale Travel Companion',
    updatedAt: '2026-08-25',
    reliabilityStatus: 'DEMO',
    geoStatus: 'DEMO',
  };
}

export default function CreateTrip() {
  const C = useColors();
  const router = useRouter();
  const { save } = useSavedTrip();
  const [form, setForm] = useState<TripForm>({
    destination: '',
    departure: '',
    returnDate: '',
    arrivalTime: '',
    departureTime: '',
    travelers: '2',
    budget: '800€',
    budgetPerTraveler: '800€',
    pace: 'equilibrato',
    interests: ['Cibo', 'Natura'],
    customInterests: [],
    constraints: '',
    transport: 'trasporto pubblico',
    arrivalTransport: 'aereo',
    arrivalDayOffset: 0,
    arrivalDestinationKind: 'first-activity',
    stops: [],
    lodging: {},
  });
  const [activeSection, setActiveSection] = useState<'destination' | 'arrival' | 'lodging' | 'interests'>('destination');
  const [customInterest, setCustomInterest] = useState('');
  const [stopDraft, setStopDraft] = useState('');
  const [returnDetailsVisible, setReturnDetailsVisible] = useState(false);
  const [error, setError] = useState('');
  const [savingLater, setSavingLater] = useState(false);
  const pointOption = useMemo(() => arrivalOption(form.arrivalTransport ?? 'aereo', form.destination), [form.arrivalTransport, form.destination]);

  const update = <K extends keyof TripForm>(key: K, value: TripForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError('');
  };
  const selectArrivalMode = (mode: ArrivalTransport) => {
    update('arrivalTransport', mode);
    update('arrivalPoint', undefined);
  };
  const selectArrivalDay = (value: 'same-day' | 'next-day' | 'specific') => {
    if (value === 'specific') {
      update('arrivalDate', form.arrivalDate || form.departure);
      update('arrivalDayOffset', undefined);
      return;
    }
    update('arrivalDate', undefined);
    update('arrivalDayOffset', value === 'next-day' ? 1 : 0);
  };
  const selectArrivalDestination = (kind: ArrivalDestinationKind) => {
    update('arrivalDestinationKind', kind);
    if (kind !== 'custom') update('arrivalDestinationPoint', undefined);
  };
  const updateLodging = (key: keyof NonNullable<TripForm['lodging']>, value: string) => {
    update('lodging', { ...(form.lodging ?? {}), [key]: value } as NonNullable<TripForm['lodging']>);
  };
  const toggleRecommended = (interest: RecommendedInterest) => {
    update('interests', form.interests.includes(interest) ? form.interests.filter((item) => item !== interest) : [...form.interests, interest]);
  };
  const addInterest = () => {
    const value = customInterest.trim();
    if (!value) return setError('Scrivi un interesse prima di aggiungerlo.');
    if ([...form.interests, ...form.customInterests].some((item) => item.toLocaleLowerCase('it') === value.toLocaleLowerCase('it'))) return setError('Questo interesse è già selezionato.');
    update('customInterests', [...form.customInterests, value]);
    setCustomInterest('');
  };
  const addStop = () => {
    const value = stopDraft.trim();
    if (!value) return;
    if ((form.stops ?? []).some((stop) => stop.toLocaleLowerCase('it') === value.toLocaleLowerCase('it'))) return setError('Questa tappa è già presente.');
    update('stops', [...(form.stops ?? []), value]);
    setStopDraft('');
  };
  const locationFromText = (label: string, type: LocationNode['type'] = 'custom'): LocationNode | undefined => {
    const value = label.trim();
    return value ? { id: nodeIdForLabel(value, 'manual'), label: value, type, placeId: `manual-${slug(value)}`, source: 'Inserito manualmente', reliabilityStatus: 'MISSING', geoStatus: 'MISSING' } : undefined;
  };
  const validate = () => {
    if (!form.destination.trim()) return 'Inserisci una destinazione.';
    if (!form.departure) return 'Scegli la data di partenza.';
    if (!form.returnDate) return 'Scegli la data di rientro.';
    const dateError = validateDateRange(form.departure, form.returnDate);
    if (dateError) return dateError;
    if (form.arrivalPoint) {
      const arrivalDateError = validateArrivalDate(form.departure, form.returnDate, form.arrivalDayOffset, form.arrivalDate);
      if (arrivalDateError) return arrivalDateError;
      if (form.arrivalDestinationKind === 'custom' && !form.arrivalDestinationPoint?.label?.trim()) return 'Inserisci il punto personalizzato dopo l’arrivo oppure scegli un’altra prima destinazione.';
    }
    if (form.arrivalTime) {
      const arrivalError = validateTime(form.arrivalTime, 'Orario di arrivo');
      if (arrivalError) return arrivalError;
    }
    if (form.departureTime) {
      const departureError = validateTime(form.departureTime, 'Orario di partenza');
      if (departureError) return departureError;
    }
    return form.arrivalTime && form.departureTime ? validateSchedule(form.departure, form.returnDate, form.arrivalTime, form.departureTime) : null;
  };
  const createPlan = () => {
    const issue = validate();
    if (issue) { setError(issue); return null; }
    setError('');
    return generateItinerary(form);
  };
  const submit = () => {
    const plan = createPlan();
    if (!plan) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.push({ pathname: '/itinerary', params: { data: JSON.stringify(plan) } });
  };
  const saveAndCompleteLater = async () => {
    const plan = createPlan();
    if (!plan) return;
    setSavingLater(true);
    try {
      const saved = await save(plan);
      router.replace({ pathname: '/itinerary', params: { saved: '1', tripId: saved.id } });
    } catch {
      setError('Non è stato possibile salvare il viaggio su questo dispositivo.');
    } finally {
      setSavingLater(false);
    }
  };

  return (
    <Screen>
      <Header eyebrow="Nuovo itinerario" title="Pianifica il mio viaggio" onBack={() => router.back()} />
      <Text style={[s.intro, { color: C.mutedForeground }]}>Inizia dall’essenziale. Potrai completare i dettagli in seguito.</Text>
      {error ? <View testID="create-form-error" accessibilityRole="alert" style={[s.error, { backgroundColor: C.destructive }]}><Feather name="alert-circle" size={16} color={C.destructiveForeground} /><Text style={[s.errorText, { color: C.destructiveForeground }]}>{error}</Text></View> : null}

      <PlannerSection id="destination" title="Dove vuoi andare?" hint="Destinazione, tappe e date" active={activeSection === 'destination'} onPress={() => setActiveSection('destination')}>
        <Field label="Destinazione principale" value={form.destination} onChangeText={(value) => update('destination', value)} placeholder="Es. Lisbona, Portogallo" icon="map-pin" testID="destination-input" />
        <Text style={[s.fieldLabel, { color: C.foreground }]}>Tappe intermedie</Text>
        <Text style={[s.helper, { color: C.mutedForeground }]}>Aggiungi una località alla volta: le tratte saranno sempre indicate come demo o da verificare.</Text>
        <View style={[s.inlineInput, { backgroundColor: C.background, borderColor: C.border }]}>
          <TextInput testID="stops-input" value={stopDraft} onChangeText={setStopDraft} onSubmitEditing={addStop} placeholder="Es. Cancún" placeholderTextColor={C.mutedForeground} style={[s.input, { color: C.foreground }]} />
          <Pressable testID="add-stop" onPress={addStop} style={[s.addButton, { backgroundColor: C.secondary }]}><Feather name="plus" size={17} color={C.primary} /><Text style={[s.addButtonText, { color: C.primary }]}>Aggiungi una tappa</Text></Pressable>
        </View>
        {(form.stops ?? []).map((stop, index) => <View key={stop} style={[s.stopRow, { backgroundColor: C.secondary }]}><Text style={[s.stopText, { color: C.foreground }]}>{index + 1}. {stop}</Text><Pressable accessibilityLabel={`Rimuovi ${stop}`} onPress={() => update('stops', (form.stops ?? []).filter((_, current) => current !== index))}><Feather name="x" size={17} color={C.primary} /></Pressable></View>)}
        <View style={s.row}><View style={s.flex}><Field label="Partenza" value={form.departure} onChangeText={(value) => update('departure', value)} placeholder="2026-09-12" icon="calendar" testID="departure-date" /></View><View style={s.flex}><Field label="Rientro" value={form.returnDate} onChangeText={(value) => update('returnDate', value)} placeholder="2026-09-16" icon="calendar" testID="return-date" /></View></View>
      </PlannerSection>

      <PlannerSection id="arrival" title="Come raggiungerai la destinazione?" hint="Arrivo e rientro facoltativi" active={activeSection === 'arrival'} onPress={() => setActiveSection('arrival')}>
        <Text style={[s.helperTop, { color: C.mutedForeground }]}>Serve per organizzare l’arrivo e il rientro. Gli spostamenti durante il viaggio verranno pianificati separatamente.</Text>
        <Field label="Parto da" value={form.departurePoint?.label ?? ''} onChangeText={(value) => update('departurePoint', locationFromText(value))} placeholder="Es. Roma, Italia (facoltativo)" icon="navigation" testID="departure-point" />
        <Text style={[s.fieldLabel, { color: C.foreground }]}>Mezzo di arrivo</Text>
        <View style={s.pills}>{arrivalModes.map((mode) => <Pill key={mode} testID={`arrival-mode-${mode}`} active={form.arrivalTransport === mode} onPress={() => selectArrivalMode(mode)}>{arrivalLabels[mode]}</Pill>)}</View>
        <Text style={[s.fieldLabel, { color: C.foreground }]}>{form.arrivalTransport === 'aereo' ? 'Aeroporto di arrivo' : form.arrivalTransport === 'treno' ? 'Stazione di arrivo' : form.arrivalTransport === 'traghetto' ? 'Porto o terminal di arrivo' : 'Punto di arrivo'}</Text>
        <Pressable testID="arrival-point-option" onPress={() => update('arrivalPoint', pointOption)} style={[s.pointOption, { backgroundColor: form.arrivalPoint?.placeId === pointOption.placeId ? C.secondary : C.background, borderColor: form.arrivalPoint?.placeId === pointOption.placeId ? C.primary : C.border }]}>
          <Feather name={form.arrivalTransport === 'aereo' ? 'airplay' : form.arrivalTransport === 'treno' ? 'map-pin' : form.arrivalTransport === 'traghetto' ? 'anchor' : 'navigation'} size={18} color={C.primary} />
          <View style={s.flex}><Text style={[s.pointTitle, { color: C.foreground }]}>{pointOption.label}</Text><Text style={[s.pointMeta, { color: C.mutedForeground }]}>Demo locale · la posizione sarà cercata dopo la creazione del piano</Text></View>
          {form.arrivalPoint?.placeId === pointOption.placeId ? <Feather name="check-circle" size={18} color={C.primary} /> : null}
        </Pressable>
        {form.arrivalPoint ? (
          <View testID="arrival-details" style={[s.arrivalPanel, { backgroundColor: C.background, borderColor: C.border }]}>
            <Text style={[s.fieldLabel, { color: C.foreground }]}>Quando arrivi?</Text>
            <Text style={[s.helper, { color: C.mutedForeground }]}>Indica il giorno; l’ora serve soltanto a posizionare la timeline.</Text>
            <View style={s.pills}>
              <Pill testID="arrival-day-same" active={!form.arrivalDate && form.arrivalDayOffset !== 1} onPress={() => selectArrivalDay('same-day')}>Lo stesso giorno</Pill>
              <Pill testID="arrival-day-next" active={!form.arrivalDate && form.arrivalDayOffset === 1} onPress={() => selectArrivalDay('next-day')}>Il giorno successivo</Pill>
              <Pill testID="arrival-day-specific" active={Boolean(form.arrivalDate)} onPress={() => selectArrivalDay('specific')}>Data specifica</Pill>
            </View>
            {form.arrivalDate ? <Field label="Data di arrivo specifica" value={form.arrivalDate} onChangeText={(value) => update('arrivalDate', value)} placeholder="2026-09-13" icon="calendar" testID="arrival-date" /> : null}
            <Field label="Ora prevista di arrivo" value={form.arrivalTime} onChangeText={(value) => update('arrivalTime', value)} placeholder="15:30 (facoltativo)" icon="clock" testID="arrival-time" />
            <Text style={[s.fieldLabel, { color: C.foreground }]}>Prima destinazione dopo l’arrivo</Text>
            <View style={s.pills}>
              <Pill testID="arrival-destination-lodging" active={form.arrivalDestinationKind === 'lodging'} onPress={() => selectArrivalDestination('lodging')}>Alloggio</Pill>
              <Pill testID="arrival-destination-activity" active={form.arrivalDestinationKind === 'first-activity'} onPress={() => selectArrivalDestination('first-activity')}>Prima attività</Pill>
              <Pill testID="arrival-destination-custom" active={form.arrivalDestinationKind === 'custom'} onPress={() => selectArrivalDestination('custom')}>Punto personalizzato</Pill>
            </View>
            {form.arrivalDestinationKind === 'lodging' && !form.lodging?.name ? <Text style={[s.helper, { color: C.mutedForeground }]}>Alloggio non ancora inserito: la prima tratta resterà da definire finché non lo aggiungi.</Text> : null}
            {form.arrivalDestinationKind === 'custom' ? <Field label="Punto personalizzato" value={form.arrivalDestinationPoint?.label ?? ''} onChangeText={(value) => update('arrivalDestinationPoint', locationFromText(value))} placeholder="Es. Piazza principale" icon="map-pin" testID="arrival-destination-custom-input" /> : null}
          </View>
        ) : null}
        <Pressable testID="toggle-return-details" onPress={() => setReturnDetailsVisible((visible) => !visible)} style={s.advancedToggle}><Text style={[s.advancedText, { color: C.primary }]}>Dati di rientro (facoltativi)</Text><Feather name={returnDetailsVisible ? 'chevron-up' : 'chevron-down'} size={17} color={C.primary} /></Pressable>
        {returnDetailsVisible ? <View style={[s.advancedPanel, { borderColor: C.border, backgroundColor: C.background }]}><Text style={[s.fieldLabel, { color: C.foreground }]}>Mezzo di rientro</Text><View style={s.pills}>{arrivalModes.map((mode) => <Pill key={mode} active={form.returnTransport === mode} onPress={() => update('returnTransport', mode)}>{arrivalLabels[mode]}</Pill>)}</View><Field label="Punto di rientro" value={form.returnPoint?.label ?? ''} onChangeText={(value) => update('returnPoint', locationFromText(value))} placeholder="Aeroporto, stazione o terminal" icon="map-pin" testID="return-point" /><Field label="Orario di partenza" value={form.departureTime} onChangeText={(value) => update('departureTime', value)} placeholder="11:00 (facoltativo)" icon="clock" testID="departure-time" /></View> : null}
      </PlannerSection>

      <PlannerSection id="lodging" title="Dove soggiornerai?" hint={form.lodging?.name ? form.lodging.name : 'Alloggio non ancora inserito'} active={activeSection === 'lodging'} onPress={() => setActiveSection('lodging')}>
        <Text style={[s.helperTop, { color: C.mutedForeground }]}>È facoltativo: puoi aggiungerlo anche dopo aver creato il piano. Senza alloggio, le tratte restano esplicitamente da definire.</Text>
        <Field label="Alloggio" value={form.lodging?.name ?? ''} onChangeText={(value) => updateLodging('name', value)} placeholder="Es. Hotel vicino al centro" icon="home" />
        <Field label="Indirizzo" value={form.lodging?.address ?? ''} onChangeText={(value) => updateLodging('address', value)} placeholder="Facoltativo" icon="map-pin" />
        <Field label="Zona" value={form.lodging?.zone ?? ''} onChangeText={(value) => updateLodging('zone', value)} placeholder="Facoltativo" icon="map" />
        <Text style={[s.helper, { color: C.mutedForeground }]}>Cercheremo la posizione in automatico dopo la generazione; puoi sempre confermarla o modificarla con un nome o indirizzo.</Text>
        <Field label="Fonte" value={form.lodging?.source ?? ''} onChangeText={(value) => updateLodging('source', value)} placeholder="Es. inserito manualmente" icon="info" />
      </PlannerSection>

      <PlannerSection id="interests" title="Cosa ti interessa?" hint={`${[...form.interests, ...form.customInterests].length} preferenze selezionate`} active={activeSection === 'interests'} onPress={() => setActiveSection('interests')}>
        <View style={s.pills}>{interests.map((item) => <Pill key={item} active={form.interests.includes(item)} onPress={() => toggleRecommended(item)}>{item}</Pill>)}</View>
        <View style={[s.inlineInput, { backgroundColor: C.background, borderColor: C.border }]}><TextInput testID="custom-interest-input" value={customInterest} onChangeText={(value) => { setCustomInterest(value); setError(''); }} onSubmitEditing={addInterest} placeholder="Aggiungi un interesse" placeholderTextColor={C.mutedForeground} style={[s.input, { color: C.foreground }]} /><Pressable testID="add-custom-interest" onPress={addInterest} style={[s.addButton, { backgroundColor: C.secondary }]}><Feather name="plus" size={17} color={C.primary} /><Text style={[s.addButtonText, { color: C.primary }]}>Aggiungi</Text></Pressable></View>
        <View style={s.pills}>{[...form.customInterests].map((item) => <Pill key={item} active onPress={() => update('customInterests', form.customInterests.filter((current) => current !== item))}>{item} ×</Pill>)}</View>
        <Text style={[s.fieldLabel, { color: C.foreground }]}>Il tuo ritmo</Text><View style={s.pills}>{paceOptions.map((item) => <Pill key={item} active={form.pace === item} onPress={() => update('pace', item)}>{item}</Pill>)}</View>
        <View style={s.row}><View style={s.flex}><Field label="Viaggiatori" value={form.travelers} onChangeText={(value) => update('travelers', value)} placeholder="2" icon="users" /></View><View style={s.flex}><Field label="Budget per viaggiatore" value={form.budgetPerTraveler ?? ''} onChangeText={(value) => update('budgetPerTraveler', value)} placeholder="Es. 800€" icon="credit-card" testID="budget-per-traveler" /></View></View>
        <Text style={[s.helper, { color: C.mutedForeground }]}>Indica quanto vuoi spendere per ogni viaggiatore, esclusi o inclusi i trasporti secondo l’impostazione del piano.</Text>
        <Text style={[s.fieldLabel, { color: C.foreground }]}>Preferenze e vincoli</Text><TextInput value={form.constraints} onChangeText={(value) => update('constraints', value)} placeholder="Es. niente sveglie presto, vegetariano..." placeholderTextColor={C.mutedForeground} multiline style={[s.notes, { color: C.foreground, backgroundColor: C.background, borderColor: C.border }]} />
      </PlannerSection>

      <View style={s.ctaArea}><Button testID="generate-itinerary" onPress={submit} icon="zap">Crea il mio itinerario</Button><Button testID="save-complete-later" variant="ghost" onPress={() => void saveAndCompleteLater()} disabled={savingLater} icon="bookmark">Salva e completa più tardi</Button><Text style={[s.disclaimer, { color: C.mutedForeground }]}>Piano e metadati demo locali · nessuna prenotazione viene modificata</Text></View>
    </Screen>
  );
}

function PlannerSection({ id, title, hint, active, onPress, children }: { id: string; title: string; hint: string; active: boolean; onPress: () => void; children: React.ReactNode }) {
  const C = useColors();
  return <View style={[s.section, { backgroundColor: C.card, borderColor: active ? C.primary : C.border }]}><Pressable testID={`toggle-section-${id}`} accessibilityRole="button" accessibilityState={{ expanded: active }} onPress={onPress} style={s.sectionHeader}><View style={s.flex}><Text style={[s.sectionTitle, { color: C.foreground }]}>{title}</Text><Text style={[s.sectionHint, { color: C.mutedForeground }]}>{hint}</Text></View><Feather name={active ? 'chevron-up' : 'chevron-down'} size={20} color={C.primary} /></Pressable>{active ? <View style={[s.sectionContent, { borderTopColor: C.border }]}>{children}</View> : null}</View>;
}

function Field({ label, icon, value, onChangeText, placeholder, testID }: { label: string; icon: keyof typeof Feather.glyphMap; value: string; onChangeText: (value: string) => void; placeholder: string; testID?: string }) {
  const C = useColors();
  return <View style={s.field}><Text style={[s.fieldLabel, { color: C.foreground }]}>{label}</Text><View style={[s.inputWrap, { backgroundColor: C.background, borderColor: C.border }]}><Feather name={icon} size={16} color={C.primary} /><TextInput testID={testID} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={C.mutedForeground} style={[s.input, { color: C.foreground }]} /></View></View>;
}

const s = StyleSheet.create({
  intro: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, marginBottom: 15 },
  error: { padding: 13, borderRadius: 14, marginBottom: 13, flexDirection: 'row', alignItems: 'center', gap: 8 },
  errorText: { fontFamily: 'Inter_500Medium', flex: 1, fontSize: 13 },
  section: { borderRadius: 18, borderWidth: 1, marginBottom: 11, overflow: 'hidden' },
  sectionHeader: { minHeight: 70, paddingHorizontal: 15, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', gap: 12 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  sectionHint: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16, marginTop: 3 },
  sectionContent: { borderTopWidth: StyleSheet.hairlineWidth, padding: 15, paddingTop: 5 },
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: 10 },
  field: { marginTop: 11 },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginBottom: 7 },
  inputWrap: { minHeight: 48, borderRadius: 13, borderWidth: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 8 },
  input: { flex: 1, minWidth: 0, fontFamily: 'Inter_400Regular', fontSize: 14, paddingVertical: 10 },
  helper: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16, marginTop: -1, marginBottom: 8 },
  helperTop: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18, marginTop: 8, marginBottom: 1 },
  inlineInput: { minHeight: 50, borderRadius: 13, borderWidth: 1, flexDirection: 'row', alignItems: 'center', marginBottom: 9, paddingLeft: 12, gap: 7 },
  addButton: { minHeight: 38, borderRadius: 10, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5, marginRight: 5 },
  addButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  stopRow: { minHeight: 38, borderRadius: 11, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  stopText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 12 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 10 },
  pointOption: { borderRadius: 14, borderWidth: 1, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 3 },
  pointTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  pointMeta: { fontFamily: 'Inter_400Regular', fontSize: 10, lineHeight: 14, marginTop: 2 },
  arrivalPanel: { borderRadius: 14, borderWidth: 1, padding: 11, marginTop: 8 },
  advancedToggle: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 5 },
  advancedText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  advancedPanel: { borderRadius: 14, borderWidth: 1, paddingHorizontal: 11, paddingBottom: 11, marginTop: 3 },
  notes: { minHeight: 76, borderRadius: 14, borderWidth: 1, padding: 12, textAlignVertical: 'top', fontFamily: 'Inter_400Regular', fontSize: 13 },
  ctaArea: { gap: 9, marginTop: 7 },
  disclaimer: { textAlign: 'center', fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16, marginTop: 2 },
});