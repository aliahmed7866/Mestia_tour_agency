import type { PublicDeparture, RequestItem, Service } from './types';

export function refreshSelections(items: RequestItem[], services: Service[], departures: PublicDeparture[], now: number) {
  const unavailable = items.filter(item => !services.some(service => service.id === item.serviceId && service.published));
  const changed = items.filter(item => {
    if (!item.departureId || unavailable.includes(item)) return false;
    const departure = departures.find(candidate => candidate.id === item.departureId && candidate.serviceId === item.serviceId);
    if (!departure || departure.status !== 'open' || Date.parse(departure.start) <= now) return true;
    const local = new Date(Date.parse(departure.start) + 4 * 3600000).toISOString();
    return item.date !== local.slice(0, 10) || item.time !== local.slice(11, 16);
  });
  return {
    unavailable, changed,
    items: items.map(item => {
      if (!changed.includes(item)) return item;
      const { departureId, time, ...rest } = item;
      void departureId; void time;
      return { ...rest, date: '' };
    }),
  };
}
