import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Button, StatusBadge } from '@/components/TravelUI';
import { useColors } from '@/hooks/useColors';

export function OnboardingModal({
  visible,
  onComplete,
  onSkip,
}: {
  visible: boolean;
  onComplete: () => void;
  onSkip: () => void;
}) {
  const C = useColors();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onSkip} accessibilityViewIsModal>
      <View style={[s.backdrop, { backgroundColor: C.overlay }]}>
        <View testID="onboarding-modal" style={[s.card, { backgroundColor: C.card, borderColor: C.border }]}>
          <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
            <View style={[s.logo, { backgroundColor: C.backgroundDark }]}><Feather name="compass" size={24} color={C.primaryForeground} /></View>
            <Text style={[s.eyebrow, { color: C.primary }]}>BENVENUTO IN TRIPLY</Text>
            <Text accessibilityRole="header" style={[s.title, { color: C.foreground }]}>Il tuo viaggio, senza il rumore.</Text>
            <Text style={[s.intro, { color: C.mutedForeground }]}>Triply ti aiuta a costruire un piano chiaro, direttamente sul tuo dispositivo. Puoi iniziare anche senza account, rete o provider esterni.</Text>

            <View style={[s.feature, { backgroundColor: C.primaryContainer }]}>
              <View style={[s.featureIcon, { backgroundColor: C.card }]}><Feather name="smartphone" size={18} color={C.primary} /></View>
              <View style={s.featureCopy}><Text style={[s.featureTitle, { color: C.foreground }]}>Prima di tutto, locale</Text><Text style={[s.featureText, { color: C.mutedForeground }]}>I tuoi viaggi restano salvati qui. Puoi completarli con calma e riaprirli anche offline.</Text></View>
            </View>
            <View style={[s.feature, { backgroundColor: C.background }]}>
              <View style={[s.featureIcon, { backgroundColor: C.secondary }]}><Feather name="check-circle" size={18} color={C.secondaryForeground} /></View>
              <View style={s.featureCopy}><Text style={[s.featureTitle, { color: C.foreground }]}>Ogni dato dichiara il suo stato</Text><Text style={[s.featureText, { color: C.mutedForeground }]}>Niente viene presentato come certo se non lo è. Vedrai sempre se un dato è confermato, simulato, offline o ancora da verificare.</Text></View>
            </View>
            <View style={s.badges}>
              <StatusBadge state="confermato" />
              <StatusBadge state="simulato" />
              <StatusBadge state="offline" />
              <StatusBadge state="da-verificare" />
              <StatusBadge state="mancante" />
              <StatusBadge state="da-definire" />
              <StatusBadge state="non-disponibile" />
            </View>
            <View style={[s.feature, { backgroundColor: C.background }]}>
              <View style={[s.featureIcon, { backgroundColor: C.accent }]}><Feather name="sliders" size={18} color={C.accentForeground} /></View>
              <View style={s.featureCopy}><Text style={[s.featureTitle, { color: C.foreground }]}>I provider sono opzionali</Text><Text style={[s.featureText, { color: C.mutedForeground }]}>Mappa, geocoding, routing e meteo possono aggiungere dati aggiornati, ma Triply non blocca il planner se non sono configurati.</Text></View>
            </View>
            <Text style={[s.reopenHint, { color: C.mutedForeground }]}>Potrai riaprire questa introduzione dall’icona informazioni nella Home.</Text>
            <Button testID="complete-onboarding" onPress={onComplete} icon="arrow-right">Inizia con Triply</Button>
            <Pressable testID="skip-onboarding" accessibilityRole="button" onPress={onSkip} style={s.skip}><Text style={[s.skipText, { color: C.primary }]}>Salta introduzione</Text></Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', padding: 18 },
  card: { maxHeight: '92%', borderRadius: 26, borderWidth: 1, overflow: 'hidden' },
  content: { padding: 22, gap: 12 },
  logo: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  eyebrow: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.1 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 28, lineHeight: 33 },
  intro: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21 },
  feature: { borderRadius: 16, padding: 12, flexDirection: 'row', gap: 10 },
  featureIcon: { width: 35, height: 35, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  featureCopy: { flex: 1, gap: 3 },
  featureTitle: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  featureText: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  reopenHint: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 2 },
  skip: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  skipText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
});