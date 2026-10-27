import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type PressableProps, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { designTokens } from '@/constants/colors';
import { useColors } from '@/hooks/useColors';

export function Screen({ children }: { children: React.ReactNode }) {
  const C = useColors();
  return <ScrollView style={{ flex: 1, backgroundColor: C.background }} contentContainerStyle={ui.scroll} showsVerticalScrollIndicator={false}>{children}</ScrollView>;
}

export function Header({ eyebrow, title, onBack, onInfo }: { eyebrow?: string; title: string; onBack?: () => void; onInfo?: () => void }) {
  const C = useColors();
  return (
    <View style={ui.header}>
      {onBack ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Torna indietro" onPress={onBack} hitSlop={12} style={ui.iconButton}>
          <Feather name="arrow-left" size={21} color={C.foreground} />
        </Pressable>
      ) : (
        <View style={[ui.logoMark, { backgroundColor: C.backgroundDark }]}>
          <Feather name="compass" size={20} color={C.primaryForeground} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        {eyebrow && <Text style={[ui.eyebrow, { color: C.primary }]}>{eyebrow.toUpperCase()}</Text>}
        <Text style={[ui.headerTitle, { color: C.foreground }]}>{title}</Text>
      </View>
      {!onBack && (
        <Pressable accessibilityRole="button" accessibilityLabel={onInfo ? 'Come funziona Triply' : 'Notifiche'} onPress={onInfo} style={ui.iconButton}>
          <Feather name={onInfo ? 'info' : 'bell'} size={20} color={C.foreground} />
        </Pressable>
      )}
    </View>
  );
}

export function Button({ children, variant = 'primary', icon, style, ...props }: PressableProps & {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
  icon?: keyof typeof Feather.glyphMap;
  style?: ViewStyle;
}) {
  const C = useColors();
  const backgroundColor = variant === 'primary' ? C.primaryAction : variant === 'secondary' ? C.accent : variant === 'destructive' ? C.destructive : 'transparent';
  const foreground = variant === 'primary' ? C.primaryForeground : variant === 'secondary' ? C.accentForeground : variant === 'destructive' ? C.destructiveForeground : C.primary;
  return (
    <Pressable
      accessibilityRole="button"
      {...props}
      style={({ pressed }) => [
        ui.button,
        {
          backgroundColor,
          borderColor: variant === 'ghost' ? C.border : 'transparent',
          borderWidth: variant === 'ghost' ? 1 : 0,
          opacity: pressed ? 0.78 : 1,
        },
        style,
      ]}
    >
      {icon && <Feather name={icon} size={18} color={foreground} />}
      <Text style={[ui.buttonText, { color: foreground }]}>{children}</Text>
    </Pressable>
  );
}

export function SectionTitle({ title, action }: { title: string; action?: string }) {
  const C = useColors();
  return <View style={ui.sectionTitle}><Text style={[ui.sectionHeading, { color: C.foreground }]}>{title}</Text>{action && <Text style={[ui.action, { color: C.primary }]}>{action}</Text>}</View>;
}

export function Pill({ children, active = false, onPress, testID }: { children: React.ReactNode; active?: boolean; onPress?: () => void; testID?: string }) {
  const C = useColors();
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={[ui.pill, { backgroundColor: active ? C.primaryAction : C.card, borderColor: active ? C.primaryAction : C.border }]}>
      <Text style={{ color: active ? C.primaryForeground : C.foreground, fontFamily: 'Inter_500Medium', fontSize: 13 }}>{children}</Text>
      {active && <Feather name="check" size={14} color={C.primaryForeground} />}
    </Pressable>
  );
}

export function InfoRow({ icon, title, value }: { icon: keyof typeof Feather.glyphMap; title: string; value: string }) {
  const C = useColors();
  return <View style={ui.infoRow}><View style={[ui.infoIcon, { backgroundColor: C.primaryContainer }]}><Feather name={icon} size={16} color={C.primary} /></View><View><Text style={[ui.infoLabel, { color: C.mutedForeground }]}>{title}</Text><Text style={[ui.infoValue, { color: C.foreground }]}>{value}</Text></View></View>;
}

export type DataState = 'confermato' | 'simulato' | 'offline' | 'da-verificare' | 'mancante' | 'da-definire' | 'non-disponibile' | 'completata';

const dataStateLabels: Record<DataState, string> = {
  confermato: 'Confermato',
  simulato: 'Simulato',
  offline: 'Offline',
  'da-verificare': 'Da verificare',
  mancante: 'Mancante',
  'da-definire': 'Da definire',
  'non-disponibile': 'Non disponibile',
  completata: 'Completata',
};

const dataStateIcons: Record<DataState, keyof typeof Feather.glyphMap> = {
  confermato: 'check-circle',
  simulato: 'copy',
  offline: 'wifi-off',
  'da-verificare': 'help-circle',
  mancante: 'minus-circle',
  'da-definire': 'edit-3',
  'non-disponibile': 'slash',
  completata: 'check-square',
};

export function StatusBadge({ state, detail }: { state: DataState; detail?: string }) {
  const C = useColors();
  const palette = state === 'confermato' || state === 'completata'
    ? { backgroundColor: C.secondary, color: C.secondaryForeground }
    : state === 'simulato'
      ? { backgroundColor: C.primaryContainer, color: C.primary }
      : state === 'offline' || state === 'non-disponibile'
        ? { backgroundColor: C.muted, color: C.mutedForeground }
        : state === 'da-verificare'
          ? { backgroundColor: C.warningContainer, color: C.warning }
          : state === 'mancante'
            ? { backgroundColor: C.destructiveContainer, color: C.destructive }
            : { backgroundColor: C.background, color: C.mutedForeground };
  return (
    <View accessibilityLabel={`${dataStateLabels[state]}${detail ? `: ${detail}` : ''}`} style={[ui.statusBadge, { backgroundColor: palette.backgroundColor }]}>
      <Feather name={dataStateIcons[state]} size={13} color={palette.color} />
      <Text style={[ui.statusBadgeText, { color: palette.color }]}>{dataStateLabels[state]}</Text>
      {detail ? <Text style={[ui.statusBadgeDetail, { color: palette.color }]}>{detail}</Text> : null}
    </View>
  );
}

export function EmptyState({
  icon = 'inbox',
  title,
  description,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
  testID,
}: {
  icon?: keyof typeof Feather.glyphMap;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  testID?: string;
}) {
  const C = useColors();
  return (
    <View testID={testID} style={[ui.emptyState, { backgroundColor: C.card, borderColor: C.border }]}>
      <View style={[ui.emptyIcon, { backgroundColor: C.primaryContainer }]}><Feather name={icon} size={20} color={C.primary} /></View>
      <Text style={[ui.emptyTitle, { color: C.foreground }]}>{title}</Text>
      <Text style={[ui.emptyDescription, { color: C.mutedForeground }]}>{description}</Text>
      {actionLabel && onAction ? <Button onPress={onAction} icon="arrow-right">{actionLabel}</Button> : null}
      {secondaryLabel && onSecondary ? <Pressable accessibilityRole="button" onPress={onSecondary} style={ui.emptySecondary}><Text style={[ui.emptySecondaryText, { color: C.primary }]}>{secondaryLabel}</Text></Pressable> : null}
    </View>
  );
}

export const ui = StyleSheet.create({
  scroll: { paddingHorizontal: designTokens.spacing.lg, paddingTop: 18, paddingBottom: 42 },
  header: { flexDirection: 'row', alignItems: 'center', gap: designTokens.spacing.sm, marginBottom: 22 },
  logoMark: { width: 42, height: 42, borderRadius: designTokens.radius.md, alignItems: 'center', justifyContent: 'center' },
  iconButton: { width: 42, height: 42, borderRadius: designTokens.radius.md, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { fontFamily: 'Inter_600SemiBold', fontSize: 11, letterSpacing: 1.1 },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 22 },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 26, marginBottom: 12 },
  sectionHeading: { fontFamily: 'Inter_700Bold', fontSize: 19 },
  action: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  button: { minHeight: designTokens.touch.comfortable, paddingHorizontal: 18, borderRadius: designTokens.radius.md, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9 },
  buttonText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, paddingVertical: 11, borderRadius: designTokens.radius.md, borderWidth: 1 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 15 },
  infoIcon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  infoLabel: { fontFamily: 'Inter_400Regular', fontSize: 12, marginBottom: 2 },
  infoValue: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  statusBadge: { minHeight: 28, borderRadius: designTokens.radius.pill, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start' },
  statusBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 10 },
  statusBadgeDetail: { fontFamily: 'Inter_400Regular', fontSize: 10, flexShrink: 1 },
  emptyState: { borderRadius: designTokens.radius.lg, borderWidth: 1, padding: designTokens.spacing.lg, alignItems: 'center', gap: 9, marginTop: 12 },
  emptyIcon: { width: 42, height: 42, borderRadius: designTokens.radius.md, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 16, textAlign: 'center' },
  emptyDescription: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18, textAlign: 'center', maxWidth: 300 },
  emptySecondary: { minHeight: designTokens.touch.min, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  emptySecondaryText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
});