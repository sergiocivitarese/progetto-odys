import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Button, EmptyState, StatusBadge, type DataState } from '@/components/TravelUI';
import { useColors } from '@/hooks/useColors';
import type { WeatherSnapshot } from '@/types/travel';

function temperature(record: WeatherSnapshot): string {
  if (record.temperatureMinC === undefined && record.temperatureMaxC === undefined) return 'Temperature non disponibili';
  if (record.temperatureMinC !== undefined && record.temperatureMaxC !== undefined) return `${Math.round(record.temperatureMinC)}°–${Math.round(record.temperatureMaxC)}°`;
  return `${Math.round(record.temperatureMinC ?? record.temperatureMaxC ?? 0)}°`;
}

function updatedLabel(record: WeatherSnapshot): string {
  if (!record.updatedAt && !record.lastSuccessfulAt) return 'aggiornamento non disponibile';
  const value = record.updatedAt ?? record.lastSuccessfulAt;
  return `aggiornato alle ${new Date(value as string).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
}

export function WeatherCard({
  record,
  title = 'Meteo del giorno',
  loading = false,
  expanded = false,
  alerts = [],
  onToggle,
  onRefresh,
  onResolveLocation,
}: {
  record?: WeatherSnapshot;
  title?: string;
  loading?: boolean;
  expanded?: boolean;
  alerts?: string[];
  onToggle?: () => void;
  onRefresh?: () => void;
  onResolveLocation?: () => void;
}) {
  const C = useColors();
  if (!record) {
    return (
      <View testID="weather-unavailable-no-node">
        <EmptyState
          icon="cloud-off"
          title="Meteo non disponibile"
          description="Questo giorno non ha ancora un luogo con coordinate confermate. Il piano resta utilizzabile offline."
          actionLabel={onResolveLocation ? 'Verifica luoghi' : onRefresh ? 'Riprova aggiornamento' : undefined}
          onAction={onResolveLocation ?? onRefresh}
        />
        <View style={s.emptyStatus}><StatusBadge state="non-disponibile" /></View>
      </View>
    );
  }
  const isHistorical = record.status === 'HISTORICAL_CLIMATE';
  const isOffline = record.status === 'OFFLINE';
  const state: DataState = isOffline ? 'offline' : record.status === 'UNAVAILABLE' ? 'non-disponibile' : isHistorical ? 'simulato' : record.status === 'TO_VERIFY' || record.status === 'UPDATE_NEEDED' ? 'da-verificare' : 'confermato';
  return (
    <View testID={`weather-card-${record.localDate}`} style={[s.card, { backgroundColor: C.card, borderColor: C.border }]}>
      <Pressable testID="weather-toggle-details" accessibilityRole="button" onPress={onToggle} style={s.heading}>
        <View style={[s.icon, { backgroundColor: C.secondary }]}><Feather name={isHistorical ? 'bar-chart-2' : isOffline ? 'wifi-off' : 'cloud'} size={18} color={C.primary} /></View>
        <View style={{ flex: 1 }}><Text style={[s.kicker, { color: C.primary }]}>{title.toUpperCase()}</Text><Text style={[s.title, { color: C.foreground }]}>{record.nodeLabel}</Text></View>
        <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={C.primary} />
      </Pressable>
      <View style={s.summary}>
        <Text style={[s.temperature, { color: C.foreground }]}>{temperature(record)}</Text>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[s.condition, { color: C.foreground }]}>{record.conditionDescription ?? (isHistorical ? 'Temperature tipiche' : 'Condizioni non disponibili')}</Text>
          <Text style={[s.muted, { color: C.mutedForeground }]}>{record.precipitationMm !== undefined ? `Piogge ${record.precipitationMm.toFixed(1)} mm` : 'Piogge non disponibili'} · {record.windKmh !== undefined ? `vento ${Math.round(record.windKmh)} km/h` : 'vento non disponibile'}</Text>
        </View>
      </View>
      <View style={s.statusRow}><StatusBadge state={state} detail={updatedLabel(record)} /></View>
      {isHistorical ? <Text style={[s.muted, { color: C.mutedForeground }]}>Non è una previsione del giorno specifico.</Text> : null}
      {record.status === 'UNAVAILABLE' ? <Text style={[s.muted, { color: C.mutedForeground }]}>Meteo non disponibile offline</Text> : null}
      {alerts.length ? <View testID="weather-alerts" style={[s.alerts, { borderColor: C.border }]}>{alerts.map((alert) => <View key={alert} style={s.alert}><Feather name="alert-triangle" size={14} color={C.primary} /><Text style={[s.muted, { color: C.foreground }]}>{alert}</Text></View>)}</View> : null}
      {expanded ? (
        <View testID="weather-details" style={[s.details, { borderTopColor: C.border }]}>
          {record.precipitationProbability !== undefined ? <Text style={[s.muted, { color: C.mutedForeground }]}>Probabilità di pioggia: {Math.round(record.precipitationProbability)}%</Text> : null}
          <Text style={[s.muted, { color: C.mutedForeground }]}>Data locale: {record.localDate} · fuso: {record.timezone}</Text>
          <Text style={[s.muted, { color: C.mutedForeground }]}>Fonte: {record.source} · provider: {record.provider}</Text>
          <Text style={[s.muted, { color: C.mutedForeground }]}>Licenza: {record.license}</Text>
          <Text style={[s.muted, { color: C.mutedForeground }]}>{record.attribution}</Text>
          {record.note ? <Text style={[s.muted, { color: C.mutedForeground }]}>{record.note}</Text> : null}
        </View>
      ) : null}
      {onRefresh ? <Button testID="refresh-weather" variant="ghost" icon="refresh-cw" onPress={onRefresh} disabled={loading}>{loading ? 'Aggiornamento in corso…' : 'Aggiorna meteo'}</Button> : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 17, padding: 12, marginTop: 12, gap: 8 },
  emptyStatus: { alignItems: 'center', marginTop: 6 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  icon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  kicker: { fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 0.8 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 14, marginTop: 2 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  temperature: { fontFamily: 'Inter_700Bold', fontSize: 24, minWidth: 83 },
  condition: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  muted: { fontFamily: 'Inter_400Regular', fontSize: 10, lineHeight: 15, flexShrink: 1 },
  statusRow: { alignItems: 'flex-start' },
  details: { borderTopWidth: 1, paddingTop: 8, gap: 3 },
  alerts: { borderWidth: 1, borderRadius: 10, padding: 8, gap: 6 },
  alert: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
});