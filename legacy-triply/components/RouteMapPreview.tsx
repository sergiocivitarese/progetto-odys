import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Svg, { Circle, Line, Text as SvgText } from 'react-native-svg';
import { NativeOfflineMap, nativeOfflineMapAvailable } from '@/components/NativeOfflineMap';
import { EmptyState, StatusBadge } from '@/components/TravelUI';
import { useColors } from '@/hooks/useColors';
import { MAP_FALLBACK_MESSAGE, MAP_LOCAL_ATTRIBUTION, MAP_PROVIDER_ATTRIBUTION, deriveDayMapSnapshot, deriveMapSnapshot, filterMapSnapshot } from '@/lib/mapModel';
import { mapTilerStyleUrl, searchGeoapifyPlaces } from '@/lib/locationServices';
import type { Itinerary, LocationNode, MapSnapshot, MapViewMode } from '@/types/travel';

interface RouteMapPreviewProps {
  itinerary: Itinerary;
  selectedNodeId?: string;
  selectedSegmentId?: string;
  viewMode?: MapViewMode;
  selectedDay?: number;
  onViewModeChange?: (mode: MapViewMode) => void;
  onSelectedDayChange?: (day: number) => void;
  title?: string;
  showSearch?: boolean;
  onSelectNode: (nodeId: string) => void;
  onSelectSegment?: (segmentId: string) => void;
  onAddSearchResult?: (node: LocationNode) => void;
  onMapSnapshotChange?: (snapshot: MapSnapshot) => void;
}

function staticMapUrl(snapshot: ReturnType<typeof deriveMapSnapshot>): string | null {
  const key = process.env.EXPO_PUBLIC_MAPTILER_KEY?.trim();
  if (!key || snapshot.markers.length === 0) return null;
  const lon = snapshot.markers.reduce((sum, marker) => sum + marker.longitude, 0) / snapshot.markers.length;
  const lat = snapshot.markers.reduce((sum, marker) => sum + marker.latitude, 0) / snapshot.markers.length;
  return `https://api.maptiler.com/maps/streets-v2/static/${lon},${lat},12/700x380.png?key=${encodeURIComponent(key)}`;
}

export function RouteMapPreview({
  itinerary,
  selectedNodeId,
  selectedSegmentId,
  viewMode,
  selectedDay,
  onViewModeChange,
  onSelectedDayChange,
  title,
  showSearch = true,
  onSelectNode,
  onSelectSegment,
  onAddSearchResult,
  onMapSnapshotChange,
}: RouteMapPreviewProps) {
  const C = useColors();
  const [localViewMode, setLocalViewMode] = useState<MapViewMode>('trip');
  const [localSelectedDay, setLocalSelectedDay] = useState(itinerary.days[0]?.day);
  const [mapError, setMapError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<LocationNode[]>([]);
  const [searchMessage, setSearchMessage] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const searchInputRef = useRef<TextInput>(null);
  const activeViewMode = viewMode ?? localViewMode;
  const activeDay = selectedDay ?? localSelectedDay;
  const setActiveViewMode = (nextMode: MapViewMode) => {
    if (viewMode === undefined) setLocalViewMode(nextMode);
    onViewModeChange?.(nextMode);
  };
  const setActiveDay = (nextDay: number) => {
    if (selectedDay === undefined) setLocalSelectedDay(nextDay);
    onSelectedDayChange?.(nextDay);
  };
  const snapshot = useMemo(() => activeViewMode === 'day' && activeDay
    ? deriveDayMapSnapshot(itinerary, activeDay, itinerary.mapSnapshot)
    : deriveMapSnapshot(itinerary, itinerary.mapSnapshot), [activeDay, activeViewMode, itinerary]);
  const visible = useMemo(() => activeViewMode === 'day' ? snapshot : filterMapSnapshot(snapshot, activeViewMode, activeDay), [activeDay, activeViewMode, snapshot]);
  const selectedNode = visible.markers.find((marker) => marker.nodeId === selectedNodeId);
  const mapUrl = staticMapUrl(visible);
  const shouldUseNativeMap = nativeOfflineMapAvailable && Boolean(mapTilerStyleUrl());
  const lons = visible.markers.map((marker) => marker.longitude);
  const lats = visible.markers.map((marker) => marker.latitude);
  const minLon = Math.min(...lons, 0), maxLon = Math.max(...lons, 1);
  const minLat = Math.min(...lats, 0), maxLat = Math.max(...lats, 1);
  const point = (longitude: number, latitude: number) => ({
    x: 18 + ((longitude - minLon) / Math.max(maxLon - minLon, 0.01)) * 284,
    y: 18 + ((maxLat - latitude) / Math.max(maxLat - minLat, 0.01)) * 144,
  });
  const markerById = new Map(visible.markers.map((marker) => [marker.nodeId, marker]));

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setSearchMessage('');
      return;
    }
    const timer = setTimeout(() => {
      setIsSearching(true);
      void searchGeoapifyPlaces(searchQuery).then((result) => {
        setSearchResults(result.nodes);
        setSearchMessage(result.message ?? (result.nodes.length ? 'Risultati online: verifica il luogo prima di salvarlo.' : 'Nessun risultato. Puoi inserire un punto manuale.'));
      }).finally(() => setIsSearching(false));
    }, 450);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (searchFocused) searchInputRef.current?.focus();
  }, [searchFocused]);

  return (
    <View testID="route-map-preview" style={[s.card, { backgroundColor: C.backgroundDark }]}>
      <View style={s.header}>
        <View style={[s.icon, { backgroundColor: C.accent }]}><Feather name="map" size={17} color={C.accentForeground} /></View>
        <View style={{ flex: 1 }}>
          <Text style={[s.title, { color: C.card }]}>{title ?? (activeViewMode === 'day' ? 'Mappa del giorno' : 'Mappa del viaggio')}</Text>
          <Text style={[s.subtitle, { color: C.primaryContainer }]}>{mapUrl && !mapError ? 'Cartografia online MapTiler' : 'Vista locale di nodi e collegamenti'}</Text>
        </View>
        <Text style={[s.count, { color: C.secondary }]}>{visible.markers.length}</Text>
      </View>
      <View style={s.controls}>
        <MapPill label="Oggi" active={activeViewMode === 'day'} onPress={() => setActiveViewMode('day')} />
        <MapPill label="Tutto il viaggio" active={activeViewMode === 'trip'} onPress={() => setActiveViewMode('trip')} />
        <MapPill label="Arrivo/rientro" active={activeViewMode === 'arrival-return'} onPress={() => setActiveViewMode('arrival-return')} />
        <MapPill label="Attività" active={activeViewMode === 'activities'} onPress={() => setActiveViewMode('activities')} />
      </View>
      {(activeViewMode === 'day' || activeViewMode === 'activities') && itinerary.days.length > 1 ? (
        <View style={s.dayControls}>{itinerary.days.map((day) => <MapPill key={day.day} label={`G${day.day}`} active={activeDay === day.day} onPress={() => setActiveDay(day.day)} />)}</View>
      ) : null}
      {visible.markers.length === 0 ? (
        <EmptyState
          testID={itinerary.destinationNode?.geoStatus === 'CONFIRMED' ? 'map-no-coordinates' : 'map-no-confirmed-destination'}
          icon="map-pin"
          title={itinerary.destinationNode?.geoStatus === 'CONFIRMED' ? 'Nessuna posizione disponibile' : 'Nessuna destinazione confermata'}
          description={itinerary.destinationNode?.geoStatus === 'CONFIRMED'
            ? 'Conserviamo i luoghi e le tratte senza inventare coordinate. Potrai aggiungerle quando saranno disponibili.'
            : 'Il nome della destinazione resta nel piano, ma la sua posizione deve ancora essere verificata.'}
          actionLabel={showSearch ? 'Cerca un luogo' : undefined}
          onAction={showSearch ? () => setSearchFocused(true) : undefined}
        />
      ) : (
        <View testID="map-canvas" style={[s.canvas, { backgroundColor: C.card }]}>
          {shouldUseNativeMap ? (
            <NativeOfflineMap snapshot={snapshot} displaySnapshot={visible} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode} onSelectSegment={onSelectSegment} onSnapshotChange={onMapSnapshotChange ?? (() => undefined)} />
          ) : (
            <>
              {mapUrl && !mapError ? <Image source={{ uri: mapUrl }} onError={() => setMapError(true)} style={StyleSheet.absoluteFillObject} resizeMode="cover" /> : null}
              <Svg width="100%" height="180" viewBox="0 0 320 180" style={StyleSheet.absoluteFillObject}>
                {visible.routeLinks.map((link) => {
                  const from = markerById.get(link.fromNodeId), to = markerById.get(link.toNodeId);
                  if (!from || !to) return null;
                  const a = point(from.longitude, from.latitude), b = point(to.longitude, to.latitude);
                  return <Line key={link.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={link.segmentId === selectedSegmentId ? C.accent : C.primary} strokeWidth={link.segmentId === selectedSegmentId ? 4 : 2} strokeDasharray={link.geometry?.kind === 'coordinate-link' ? '5 4' : undefined} onPress={() => onSelectSegment?.(link.segmentId)} />;
                })}
                {visible.markers.map((marker) => {
                  const position = point(marker.longitude, marker.latitude);
                  const selected = marker.nodeId === selectedNodeId;
                  return (
                    <React.Fragment key={marker.id}>
                      <Circle cx={position.x} cy={position.y} r={selected ? 10 : 8} fill={selected ? C.accent : C.primary} stroke={C.card} strokeWidth="2" onPress={() => onSelectNode(marker.nodeId)} />
                      {marker.sequence ? <SvgText x={position.x} y={position.y + 3.5} textAnchor="middle" fill={selected ? C.accentForeground : C.primaryForeground} fontSize="8" fontWeight="700" onPress={() => onSelectNode(marker.nodeId)}>{marker.sequence}</SvgText> : null}
                    </React.Fragment>
                  );
                })}
              </Svg>
              <View style={[s.mapCaption, { backgroundColor: C.card }]}><Text style={[s.mapCaptionText, { color: C.foreground }]}>{mapUrl && !mapError ? 'Nodi e tratte restano locali; stile cartografico online.' : MAP_FALLBACK_MESSAGE}</Text></View>
            </>
          )}
        </View>
      )}
      <View style={[s.detail, { backgroundColor: C.card }]}>
        {selectedNode ? (
          <>
            <Text testID="map-selected-node" style={[s.detailTitle, { color: C.foreground }]}>{selectedNode.label}</Text>
            <Text style={[s.detailText, { color: C.mutedForeground }]}>Stato posizione: {selectedNode.reliabilityStatus === 'VERIFIED' ? 'verificata' : selectedNode.reliabilityStatus === 'DEMO' ? 'simulata' : selectedNode.reliabilityStatus === 'TO_VERIFY' ? 'da verificare' : 'da definire'}</Text>
            <Text style={[s.detailText, { color: C.mutedForeground }]}>Fonte: {selectedNode.source}</Text>
          </>
        ) : <Text style={[s.detailText, { color: C.mutedForeground }]}>Tocca un marker, una tratta nella timeline o un’attività per evidenziare il collegamento.</Text>}
      </View>
       <Text style={[s.attribution, { color: C.primaryContainer }]}>{shouldUseNativeMap || (mapUrl && !mapError) ? MAP_PROVIDER_ATTRIBUTION : MAP_LOCAL_ATTRIBUTION}</Text>
       <View style={s.statusRow}><StatusBadge state={snapshot.offline.status === 'PREPARED' ? 'confermato' : 'offline'} detail={snapshot.offline.status === 'PREPARED' ? 'Cartografia locale pronta' : 'Cartografia offline non scaricata'} /></View>
        <Text style={[s.status, { color: C.secondary }]}>{snapshot.offline.note}</Text>
      {!nativeOfflineMapAvailable ? <Text style={[s.status, { color: C.secondary }]}>Il download dei pacchetti offline richiede una development build Android o iOS; Expo Go e Web mostrano solo i dati locali.</Text> : null}
      {!mapTilerStyleUrl() ? <Text style={[s.status, { color: C.secondary }]}>Mappa online non configurata: imposta solo una chiave pubblica MapTiler limitata al dominio/app.</Text> : null}
      {showSearch ? <View style={[s.search, { backgroundColor: C.card }]}>
        <Text style={[s.searchTitle, { color: C.foreground }]}>Cerca un luogo</Text>
         <TextInput ref={searchInputRef} testID="geo-place-search" value={searchQuery} onChangeText={setSearchQuery} onFocus={() => setSearchFocused(false)} placeholder="Minimo 3 caratteri" placeholderTextColor={C.mutedForeground} style={[s.searchInput, { color: C.foreground, borderColor: C.border }]} />
        {isSearching ? <Text style={[s.searchText, { color: C.mutedForeground }]}>Ricerca in corso…</Text> : null}
        {searchMessage ? <Text testID="geo-search-message" style={[s.searchText, { color: C.mutedForeground }]}>{searchMessage}</Text> : null}
        {searchResults.map((node) => <Pressable key={node.id} testID={`geo-search-result-${node.id}`} onPress={() => onAddSearchResult?.(node)} style={[s.searchResult, { borderColor: C.border }]}>
          <Feather name="plus-circle" size={14} color={C.primary} /><View style={{ flex: 1 }}><Text style={[s.searchResultTitle, { color: C.foreground }]}>{node.label}</Text><Text style={[s.searchText, { color: C.mutedForeground }]}>Fonte: {node.source} · da verificare</Text></View>
        </Pressable>)}
      </View> : null}
    </View>
  );
}

function MapPill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const C = useColors();
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={[s.pill, { borderColor: active ? C.accent : C.primaryContainer, backgroundColor: active ? C.accent : 'transparent' }]}><Text style={[s.pillText, { color: active ? C.accentForeground : C.card }]}>{label}</Text></Pressable>;
}

const s = StyleSheet.create({
  card: { borderRadius: 22, padding: 16, marginTop: 25 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 3 },
  count: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 13 },
  dayControls: { flexDirection: 'row', gap: 6, marginTop: 7 },
  pill: { borderRadius: 99, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 5 },
  pillText: { fontFamily: 'Inter_600SemiBold', fontSize: 10 },
  canvas: { height: 180, borderRadius: 15, overflow: 'hidden', marginTop: 13 },
  mapCaption: { position: 'absolute', left: 8, right: 8, bottom: 8, padding: 6, borderRadius: 7 },
  mapCaptionText: { fontFamily: 'Inter_600SemiBold', fontSize: 9 },
  statusRow: { marginTop: 8 },
  detail: { borderRadius: 12, padding: 10, marginTop: 10 },
  detailTitle: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  detailText: { fontFamily: 'Inter_400Regular', fontSize: 10, lineHeight: 15, marginTop: 2 },
  attribution: { fontFamily: 'Inter_400Regular', fontSize: 9, marginTop: 9 },
  status: { fontFamily: 'Inter_400Regular', fontSize: 10, lineHeight: 14, marginTop: 4 },
  search: { borderRadius: 12, padding: 10, marginTop: 10 },
  searchTitle: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  searchInput: { minHeight: 38, borderWidth: 1, borderRadius: 9, paddingHorizontal: 10, marginTop: 7, fontFamily: 'Inter_400Regular', fontSize: 11 },
  searchText: { fontFamily: 'Inter_400Regular', fontSize: 10, lineHeight: 14, marginTop: 5 },
  searchResult: { borderTopWidth: 1, paddingTop: 7, marginTop: 7, flexDirection: 'row', gap: 7 },
  searchResultTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
});