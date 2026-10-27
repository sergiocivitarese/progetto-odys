import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import Constants from 'expo-constants';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { mapTilerStyleUrl } from '@/lib/locationServices';
import { initialOfflineArea, isApprovedMapTilerStyle, offlineNote, ROME_HISTORIC_CENTRE_AREA, styleUrlHash } from '@/lib/offlineMap';
import { useColors } from '@/hooks/useColors';
import type { MapSnapshot, OfflineMapArea, OfflineMapStatus } from '@/types/travel';
import type { OfflinePack } from '@maplibre/maplibre-react-native';
import type { CameraRef } from '@maplibre/maplibre-react-native';

const OFFLINE_METADATA_KEY = 'travel_companion_offline_map_areas_v1';
const isCustomNativeBuild = Constants.executionEnvironment !== 'storeClient' && Constants.appOwnership !== 'expo';
const mapLibre: typeof import('@maplibre/maplibre-react-native') | null = isCustomNativeBuild
  ? require('@maplibre/maplibre-react-native') as typeof import('@maplibre/maplibre-react-native')
  : null;

interface NativeOfflineMapProps {
  snapshot: MapSnapshot;
  displaySnapshot: MapSnapshot;
  selectedNodeId?: string;
  onSelectNode?: (nodeId: string) => void;
  onSelectSegment?: (segmentId: string) => void;
  onSnapshotChange: (snapshot: MapSnapshot) => void;
}

export const nativeOfflineMapAvailable = isCustomNativeBuild;

function statusForNativeState(state: string, previousStatus?: OfflineMapStatus): OfflineMapStatus {
  if (state === 'complete') return 'PREPARED';
  if (state === 'active') return 'DOWNLOADING';
  if (previousStatus === 'ERROR' || previousStatus === 'CANCELLED') return previousStatus;
  return 'PREPARING';
}

function megabytes(bytes: number | undefined): number | undefined {
  return Number.isFinite(bytes) ? Number(((bytes ?? 0) / 1_000_000).toFixed(2)) : undefined;
}

export function NativeOfflineMap({ snapshot, displaySnapshot, selectedNodeId, onSelectNode, onSelectSegment, onSnapshotChange }: NativeOfflineMapProps) {
  const C = useColors();
  const styleUrl = mapTilerStyleUrl();
  const approvedStyle = isApprovedMapTilerStyle(styleUrl);
  const [area, setArea] = useState<OfflineMapArea>(() => snapshot.offline.areas.find((item) => item.id === ROME_HISTORIC_CENTRE_AREA.id) ?? initialOfflineArea());
  const [confirmationVisible, setConfirmationVisible] = useState(false);
  const packRef = useRef<OfflinePack | null>(null);
  const cameraRef = useRef<CameraRef>(null);
  const offlineManager = mapLibre?.OfflineManager;
  const snapshotRef = useRef(snapshot);
  const onSnapshotChangeRef = useRef(onSnapshotChange);
  snapshotRef.current = snapshot;
  onSnapshotChangeRef.current = onSnapshotChange;

  const publishArea = useCallback((patch: Partial<OfflineMapArea>) => {
    setArea((current) => {
      const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
      const latestSnapshot = snapshotRef.current;
      const areas = [...latestSnapshot.offline.areas.filter((item) => item.id !== next.id), next];
      const status = next.status;
      onSnapshotChangeRef.current({
        ...latestSnapshot,
        offline: { status, areas, note: offlineNote(status) },
      });
      void AsyncStorage.setItem(OFFLINE_METADATA_KEY, JSON.stringify({ version: 1, areas }));
      return next;
    });
  }, []);

  useEffect(() => {
    const next = snapshot.offline.areas.find((item) => item.id === ROME_HISTORIC_CENTRE_AREA.id);
    if (next && next.updatedAt !== area.updatedAt) setArea(next);
  }, [area.updatedAt, snapshot.offline.areas]);

  useEffect(() => {
    if (!offlineManager) return undefined;
    let active = true;
    const persistProgress = (offlinePack: OfflinePack, status: Awaited<ReturnType<OfflinePack['status']>>, persistedStatus?: OfflineMapStatus) => {
      const currentStatus = persistedStatus ?? snapshotRef.current.offline.areas.find((item) => item.id === ROME_HISTORIC_CENTRE_AREA.id)?.status;
      const nextStatus = statusForNativeState(status.state, currentStatus);
      publishArea({
        packId: offlinePack.id,
        status: nextStatus,
        progress: Math.round(status.percentage),
        completedResources: status.completedResourceCount,
        requiredResources: status.requiredResourceCount,
        actualSizeMb: megabytes(status.completedResourceSize),
        downloadedAt: nextStatus === 'PREPARED' ? new Date().toISOString() : undefined,
      });
    };
    const persistError = (_offlinePack: OfflinePack, error: { message: string }) => {
      publishArea({ status: 'ERROR', lastError: error.message });
    };
    void (async () => {
      try {
        const storedRaw = await AsyncStorage.getItem(OFFLINE_METADATA_KEY);
        const stored = storedRaw ? JSON.parse(storedRaw) as { areas?: OfflineMapArea[] } : null;
        const storedArea = stored?.areas?.find((item) => item.id === ROME_HISTORIC_CENTRE_AREA.id);
        const packs = await offlineManager.getPacks();
        const matchingPack = packs.find((pack) => pack.metadata.areaId === ROME_HISTORIC_CENTRE_AREA.id);
        if (!active) return;
        if (!matchingPack) {
          const currentArea = snapshotRef.current.offline.areas.find((item) => item.id === ROME_HISTORIC_CENTRE_AREA.id);
          if (currentArea?.status === 'PREPARED' || storedArea?.status === 'PREPARED') publishArea({ status: 'NOT_DOWNLOADED', packId: undefined, progress: 0, actualSizeMb: undefined });
          return;
        }
        packRef.current = matchingPack;
        const status = await matchingPack.status();
        if (!active) return;
        if (storedArea && Date.parse(storedArea.updatedAt ?? '') > Date.parse(snapshotRef.current.offline.areas.find((item) => item.id === storedArea.id)?.updatedAt ?? '')) {
          publishArea({ ...storedArea, packId: matchingPack.id });
        }
        const persistedStatus = storedArea?.status ?? snapshotRef.current.offline.areas.find((item) => item.id === ROME_HISTORIC_CENTRE_AREA.id)?.status;
        if (status.state === 'inactive' && persistedStatus !== 'ERROR') {
          publishArea({ packId: matchingPack.id, status: 'ERROR', lastError: 'Download interrotto prima del completamento. Riprova per scaricare nuovamente l’area.' });
          return;
        }
        persistProgress(matchingPack, status, persistedStatus);
        if (status.state === 'active') await offlineManager.addListener(matchingPack.id, persistProgress, persistError);
      } catch {
        // La prima apertura in una development build può non avere ancora il database offline.
      }
    })();
    return () => {
      active = false;
      if (packRef.current) offlineManager.removeListener(packRef.current.id);
    };
  }, [offlineManager, publishArea]);

  useEffect(() => {
    const camera = cameraRef.current;
    if (!camera || !displaySnapshot.markers.length) return;
    const selected = displaySnapshot.markers.find((marker) => marker.nodeId === selectedNodeId);
    if (selected) {
      camera.easeTo({ center: [selected.longitude, selected.latitude], zoom: 14, duration: 350 });
      return;
    }
    const longitudes = displaySnapshot.markers.map((marker) => marker.longitude);
    const latitudes = displaySnapshot.markers.map((marker) => marker.latitude);
    if (displaySnapshot.markers.length === 1) {
      camera.easeTo({ center: [longitudes[0], latitudes[0]], zoom: 13, duration: 350 });
      return;
    }
    camera.fitBounds([Math.min(...longitudes), Math.min(...latitudes), Math.max(...longitudes), Math.max(...latitudes)], { duration: 350 });
  }, [displaySnapshot.markers, selectedNodeId]);

  const markers = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: displaySnapshot.markers.map((marker) => ({
      type: 'Feature' as const,
      properties: { id: marker.nodeId, selected: marker.nodeId === selectedNodeId, sequence: marker.sequence ? String(marker.sequence) : '' },
      geometry: { type: 'Point' as const, coordinates: [marker.longitude, marker.latitude] },
    })),
  }), [displaySnapshot.markers, selectedNodeId]);

  const routes = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: displaySnapshot.routeLinks.flatMap((link) => {
      const coordinates = link.geometry?.coordinates;
      return coordinates && coordinates.length > 1 ? [{
        type: 'Feature' as const,
      properties: { id: link.segmentId },
        geometry: { type: 'LineString' as const, coordinates },
      }] : [];
    }),
  }), [displaySnapshot.routeLinks]);

  const downloadPack = async () => {
    if (!approvedStyle || !styleUrl || !offlineManager) {
      publishArea({ status: 'UNAVAILABLE', lastError: 'Style MapTiler non configurato o non autorizzato.' });
      setConfirmationVisible(false);
      return;
    }
    setConfirmationVisible(false);
    if (area.packId && area.status !== 'PREPARED') {
      try {
        await offlineManager.deletePack(area.packId);
        offlineManager.removeListener(area.packId);
      } catch {
        const remainingPacks = await offlineManager.getPacks();
        if (remainingPacks.some((pack) => pack.id === area.packId)) {
          publishArea({ status: 'ERROR', lastError: 'Non è stato possibile rimuovere il download incompleto. Riprova più tardi senza avviare un secondo pacchetto.' });
          return;
        }
      }
      packRef.current = null;
    }
    publishArea({
      status: 'PREPARING',
      lastError: undefined,
      provider: 'MapTiler',
      bounds: ROME_HISTORIC_CENTRE_AREA.bounds,
      minZoom: ROME_HISTORIC_CENTRE_AREA.minZoom,
      maxZoom: ROME_HISTORIC_CENTRE_AREA.maxZoom,
      styleId: ROME_HISTORIC_CENTRE_AREA.styleId,
      styleVersion: ROME_HISTORIC_CENTRE_AREA.styleVersion,
      styleUrlHash: styleUrlHash(styleUrl),
      progress: 0,
    });
    try {
      const pack = await offlineManager.createPack(
        {
          mapStyle: styleUrl,
          bounds: ROME_HISTORIC_CENTRE_AREA.bounds,
          minZoom: ROME_HISTORIC_CENTRE_AREA.minZoom,
          maxZoom: ROME_HISTORIC_CENTRE_AREA.maxZoom,
          metadata: {
            areaId: ROME_HISTORIC_CENTRE_AREA.id,
            provider: 'MapTiler',
            styleId: ROME_HISTORIC_CENTRE_AREA.styleId,
            styleVersion: ROME_HISTORIC_CENTRE_AREA.styleVersion,
            styleUrlHash: styleUrlHash(styleUrl),
            createdAt: new Date().toISOString(),
          },
        },
        (offlinePack, status) => {
          const nextStatus = status.state === 'inactive' ? 'PREPARING' : statusForNativeState(status.state);
          publishArea({
            packId: offlinePack.id,
            status: nextStatus,
            progress: Math.round(status.percentage),
            completedResources: status.completedResourceCount,
            requiredResources: status.requiredResourceCount,
            actualSizeMb: megabytes(status.completedResourceSize),
            downloadedAt: nextStatus === 'PREPARED' ? new Date().toISOString() : undefined,
          });
        },
        (_offlinePack, error) => {
          publishArea({ status: 'ERROR', lastError: error.message });
        },
      );
      packRef.current = pack;
      publishArea({ packId: pack.id, status: 'DOWNLOADING' });
      await pack.resume();
    } catch (error) {
      publishArea({ status: 'ERROR', lastError: error instanceof Error ? error.message : 'Impossibile avviare il download.' });
    }
  };

  const cancelDownload = async () => {
    const pack = packRef.current;
    try {
      if (!offlineManager) throw new Error('MapLibre non disponibile in Expo Go.');
      if (pack) {
        await pack.pause();
        await offlineManager.deletePack(pack.id);
        offlineManager.removeListener(pack.id);
      }
      packRef.current = null;
      publishArea({ status: 'CANCELLED', packId: undefined, progress: 0, actualSizeMb: undefined, completedResources: 0, requiredResources: undefined });
    } catch (error) {
      publishArea({ status: 'ERROR', lastError: error instanceof Error ? error.message : 'Impossibile annullare il download.' });
    }
  };

  const deletePack = async () => {
    const packId = area.packId;
    try {
      if (!offlineManager) throw new Error('MapLibre non disponibile in Expo Go.');
      if (packId) {
        await offlineManager.deletePack(packId);
        offlineManager.removeListener(packId);
      }
      packRef.current = null;
      publishArea({ status: 'NOT_DOWNLOADED', packId: undefined, progress: 0, actualSizeMb: undefined, completedResources: 0, requiredResources: undefined, lastError: undefined });
    } catch (error) {
      publishArea({ status: 'ERROR', lastError: error instanceof Error ? error.message : 'Impossibile eliminare il pacchetto.' });
    }
  };

  if (!approvedStyle || !styleUrl || !mapLibre || !offlineManager) return null;
  const { Camera, GeoJSONSource, Layer, Map } = mapLibre;

  return (
    <View style={s.wrap}>
      <Map testID="native-maplibre-map" mapStyle={styleUrl} logo={false} compassPosition={{ top: 12, right: 12 }} style={s.map}>
        <Camera ref={cameraRef} initialViewState={{ center: [12.481, 41.902], zoom: 14 }} />
        <GeoJSONSource id="travel-routes" data={routes} onPress={(event) => {
          const id = event.nativeEvent.features?.[0]?.properties?.id;
          if (typeof id === 'string') onSelectSegment?.(id);
        }}>
          <Layer id="travel-route-line" type="line" style={{ lineColor: C.primary, lineWidth: 3, lineOpacity: 0.82 }} />
        </GeoJSONSource>
        <GeoJSONSource id="travel-markers" data={markers} onPress={(event) => {
          const id = event.nativeEvent.features?.[0]?.properties?.id;
          if (typeof id === 'string') onSelectNode?.(id);
        }}>
          <Layer id="travel-marker-circle" type="circle" style={{ circleColor: ['case', ['boolean', ['get', 'selected'], false], C.accent, C.primary], circleRadius: ['case', ['boolean', ['get', 'selected'], false], 8, 6], circleStrokeColor: C.card, circleStrokeWidth: 2 }} />
          <Layer id="travel-marker-number" type="symbol" style={{ textField: ['get', 'sequence'], textSize: 10, textColor: C.primaryForeground, textAllowOverlap: true, textIgnorePlacement: true }} />
        </GeoJSONSource>
      </Map>

      <View style={[s.offlinePanel, { backgroundColor: C.card }]}>
        <View style={s.panelHeader}>
          <View style={s.panelTitleWrap}><Feather name="download-cloud" size={15} color={C.foreground} /><Text style={[s.panelTitle, { color: C.foreground }]}>Pacchetto offline</Text></View>
          <Text style={[s.status, { color: C.primary }]}>{area.status === 'PREPARED' ? 'Disponibile' : area.status === 'DOWNLOADING' ? `${area.progress ?? 0}%` : area.status === 'ERROR' ? 'Errore' : area.status === 'CANCELLED' ? 'Annullato' : 'Non scaricato'}</Text>
        </View>
        <Text style={[s.panelText, { color: C.mutedForeground }]}>{area.label} · zoom {ROME_HISTORIC_CENTRE_AREA.minZoom}–{ROME_HISTORIC_CENTRE_AREA.maxZoom}</Text>
        <Text style={[s.panelText, { color: C.mutedForeground }]}>Stima {area.estimatedSizeMb ?? initialOfflineArea().estimatedSizeMb} MB · {area.completedResources ?? 0}/{area.requiredResources ?? '—'} risorse</Text>
        <Text style={[s.panelHint, { color: C.mutedForeground }]}>{offlineNote(area.status)}</Text>
        {area.lastError ? <Text style={[s.error, { color: C.destructive }]}>{area.lastError}</Text> : null}
        {area.status === 'DOWNLOADING' || area.status === 'PREPARING' ? (
          <Pressable testID="cancel-offline-map-download" onPress={() => void cancelDownload()} style={[s.ghostButton, { borderColor: C.border }]}><Text style={[s.ghostButtonText, { color: C.foreground }]}>Annulla download</Text></Pressable>
        ) : area.status === 'PREPARED' ? (
          <Pressable testID="delete-offline-map-pack" onPress={() => void deletePack()} style={[s.ghostButton, { borderColor: C.border }]}><Text style={[s.ghostButtonText, { color: C.foreground }]}>Elimina pacchetto</Text></Pressable>
        ) : (
          <Pressable testID="prepare-offline-map-download" onPress={() => setConfirmationVisible(true)} style={[s.downloadButton, { backgroundColor: C.primaryAction }]}><Feather name="download" size={15} color={C.primaryForeground} /><Text style={[s.downloadButtonText, { color: C.primaryForeground }]}>{area.status === 'ERROR' ? 'Riprova download' : 'Scarica area limitata'}</Text></Pressable>
        )}
      </View>

      <Modal visible={confirmationVisible} transparent animationType="fade" onRequestClose={() => setConfirmationVisible(false)}>
        <View style={[s.modalBackdrop, { backgroundColor: C.overlay }]}>
          <View style={[s.modalCard, { backgroundColor: C.card }]}>
            <Text style={[s.modalTitle, { color: C.foreground }]}>Conferma download</Text>
            <Text style={[s.modalText, { color: C.mutedForeground }]}>Scaricherai solo “{ROME_HISTORIC_CENTRE_AREA.label}”, zoom {ROME_HISTORIC_CENTRE_AREA.minZoom}–{ROME_HISTORIC_CENTRE_AREA.maxZoom}.</Text>
            <Text style={[s.modalText, { color: C.mutedForeground }]}>Bounding box: {ROME_HISTORIC_CENTRE_AREA.bounds.join(', ')}. Stima prudenziale: {initialOfflineArea().estimatedSizeMb} MB.</Text>
            <Text style={[s.modalText, { color: C.mutedForeground }]}>Provider: MapTiler. Nessun download partirà automaticamente.</Text>
            <View style={s.actions}>
              <Pressable testID="cancel-offline-map-confirmation" onPress={() => setConfirmationVisible(false)} style={[s.ghostButton, { borderColor: C.border }]}><Text style={[s.ghostButtonText, { color: C.foreground }]}>Annulla</Text></Pressable>
              <Pressable testID="confirm-offline-map-download" onPress={() => void downloadPack()} style={[s.downloadButton, { backgroundColor: C.primaryAction }]}><Text style={[s.downloadButtonText, { color: C.primaryForeground }]}>Conferma</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { height: 180, borderRadius: 15, overflow: 'hidden' },
  map: { flex: 1 },
  offlinePanel: { position: 'absolute', left: 8, right: 8, bottom: 8, padding: 8, borderRadius: 9 },
  panelHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, alignItems: 'center' },
  panelTitleWrap: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  panelTitle: { fontFamily: 'Inter_700Bold', fontSize: 10 },
  status: { fontFamily: 'Inter_700Bold', fontSize: 9 },
  panelText: { fontFamily: 'Inter_400Regular', fontSize: 8, marginTop: 2 },
  panelHint: { fontFamily: 'Inter_400Regular', fontSize: 8, marginTop: 3, lineHeight: 11 },
  error: { fontFamily: 'Inter_600SemiBold', fontSize: 8, marginTop: 3 },
  downloadButton: { minHeight: 29, marginTop: 6, borderRadius: 8, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 5, paddingHorizontal: 8 },
  downloadButtonText: { fontFamily: 'Inter_700Bold', fontSize: 9 },
  ghostButton: { minHeight: 29, marginTop: 6, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  ghostButtonText: { fontFamily: 'Inter_700Bold', fontSize: 9 },
  modalBackdrop: { flex: 1, justifyContent: 'center', padding: 24 },
  modalCard: { borderRadius: 18, padding: 18, gap: 7 },
  modalTitle: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  modalText: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 3 },
});