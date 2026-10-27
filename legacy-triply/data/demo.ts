import type { GroupTrip } from '@/types/travel';
export const groupTrips: GroupTrip[] = [
 { id: 'amalfi', title: 'Costiera senza fretta', destination: 'Amalfi, Italia', creator: 'Giulia B.', duration: '5 giorni', spots: '3 posti', price: '€ 680', image: require('@/assets/images/amalfi-coast.jpg') },
 { id: 'kyoto', title: 'Kyoto tra templi e botteghe', destination: 'Kyoto, Giappone', creator: 'Marco R.', duration: '8 giorni', spots: '2 posti', price: '€ 1.240', image: require('@/assets/images/kyoto-autumn.jpg') },
];
export const featuredTrip = { destination: 'Lisbona', dates: '12 — 16 settembre', days: 5, progress: 0.72 };
