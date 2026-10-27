import type { Activity, DayPlan } from '../types/travel';
import { hasCoordinates, locationNodeForActivity } from './mapModel';

export interface RepositionSuggestion {
  activityIndex: number;
  suggestedIndex: number;
  currentOrder: number;
  suggestedOrder: number;
  distanceDifferenceKm?: number;
  durationDifference?: string;
  reason: string;
  usedData: string[];
  missingData: string[];
  status: 'CALCULABLE' | 'NOT_CALCULABLE' | 'DISMISSED';
}

function distanceKm(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }): number {
  const rad = (value: number) => value * Math.PI / 180;
  const latDistance = rad(to.latitude - from.latitude);
  const lonDistance = rad(to.longitude - from.longitude);
  const a = Math.sin(latDistance / 2) ** 2 + Math.cos(rad(from.latitude)) * Math.cos(rad(to.latitude)) * Math.sin(lonDistance / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function sequenceCost(activities: Activity[]): number | null {
  const nodes = activities.map((activity, index) => locationNodeForActivity(activity, index));
  const coordinates = nodes.map((node) => hasCoordinates(node) && node.geoStatus === 'CONFIRMED'
    ? { latitude: node.latitude, longitude: node.longitude }
    : null);
  if (coordinates.some((node) => node === null)) return null;
  return coordinates.slice(1).reduce((total, node, index) => total + distanceKm(coordinates[index]!, node!), 0);
}

export function proposeRepositioning(day: DayPlan, activityIndex: number): RepositionSuggestion {
  const activities = day.activities;
  const activity = activities[activityIndex];
  const base = { activityIndex, suggestedIndex: activityIndex, currentOrder: activityIndex + 1, suggestedOrder: activityIndex + 1 };
  if (activity?.repositioningDecision === 'KEPT') {
    return {
      ...base,
      reason: 'Hai scelto di mantenere questa posizione. Modifica luogo o vincoli prima di richiedere una nuova valutazione.',
      usedData: [],
      missingData: [],
      status: 'DISMISSED',
    };
  }
  if (!activity || activities.length < 3 || !hasCoordinates(locationNodeForActivity(activity, activityIndex)) || locationNodeForActivity(activity, activityIndex).geoStatus !== 'CONFIRMED') {
    return {
      ...base,
      reason: 'Riposizionamento non calcolabile: servono almeno tre attività con coordinate confermate.',
      usedData: ['Ordine corrente della timeline'],
      missingData: ['Coordinate confermate per tutte le attività del giorno', 'Routing configurato per stimare durate stradali'],
      status: 'NOT_CALCULABLE',
    };
  }
  const withActivityRemoved = activities.filter((_, index) => index !== activityIndex);
  const currentCost = sequenceCost(activities);
  if (currentCost === null) {
    return {
      ...base,
      reason: 'Riposizionamento non calcolabile: mancano coordinate confermate per confrontare le tappe vicine.',
      usedData: ['Ordine corrente della timeline'],
      missingData: ['Coordinate confermate per tutte le attività del giorno', 'Routing configurato per stimare durate stradali'],
      status: 'NOT_CALCULABLE',
    };
  }

  let bestIndex = activityIndex;
  let bestCost = currentCost;
  for (let index = 0; index <= withActivityRemoved.length; index += 1) {
    const candidate = [...withActivityRemoved.slice(0, index), activity, ...withActivityRemoved.slice(index)];
    const cost = sequenceCost(candidate);
    if (cost !== null && cost + 0.001 < bestCost) {
      bestCost = cost;
      bestIndex = index;
    }
  }
  if (bestIndex === activityIndex) {
    return {
      ...base,
      reason: 'L’ordine attuale è già il più coerente con le coordinate confermate disponibili.',
      usedData: ['Coordinate confermate', 'Ordine corrente delle attività'],
      missingData: ['Durate stradali: routing non configurato'],
      status: 'CALCULABLE',
    };
  }
  return {
    ...base,
    suggestedIndex: bestIndex,
    suggestedOrder: bestIndex + 1,
    distanceDifferenceKm: Math.max(0, currentCost - bestCost),
    reason: 'La posizione suggerita riduce il collegamento diretto tra le tappe vicine. Orari e disponibilità restano da verificare.',
    usedData: ['Coordinate confermate', 'Ordine corrente delle attività'],
    missingData: ['Durate e distanze stradali: routing non configurato'],
    status: 'CALCULABLE',
  };
}

export function applyRepositioning(activities: Activity[], fromIndex: number, toIndex: number): Activity[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= activities.length || toIndex >= activities.length) return activities;
  const next = [...activities];
  const [activity] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, activity);
  return next;
}