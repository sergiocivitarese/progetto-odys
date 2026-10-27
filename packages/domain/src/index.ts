/**
 * @odys/domain — logica di dominio condivisa fra backend (Node) e frontend (Angular).
 * Nessuna dipendenza da framework, storage o variabili d'ambiente.
 */
export * from './types/travel';
export * from './lib/config';
export * from './lib/routeModel';
export * from './lib/generateItinerary';
export * from './lib/mapModel';
export * from './lib/weather';
export * from './lib/geocoding';
export * from './lib/placeSuggestions';
export * from './lib/routing';
export * from './lib/repositioning';
export * from './lib/tripTransfer';
export * from './lib/offlineMap';
export * from './lib/savedTrips';
export * from './lib/itineraryEditing';
export * from './lib/tripForm';
export * from './data/places';
export * from './data/demo';
