'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, CalendarDays, Copy, Info, Plus, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import type { AdminData, Resource, Service, TourDeparture } from '../lib/types';
import '../inventory.css';

type Mutation = (body: Record<string, unknown>, success: string) => Promise<boolean>;
type Props = { data: AdminData; mutate: Mutation; busy: boolean; refresh?: () => Promise<void> };
type Draft = {
  id: string;
  serviceId: string;
  date: string;
  startTime: string;
  endDate: string;
  endTime: string;
  daySpan: number;
  capacity: string;
  guideId: string;
  vehicleId: string;
  status: TourDeparture['status'];
  version: number;
};
type DateFilter = 'upcoming' | 'past' | 'all';

export function useUnsavedDraft(dirty: boolean, scope: string) {
  useEffect(() => {
    if (!dirty) return;
    function guard(event: Event) { const target = (event as CustomEvent<{ scope?: string }>).detail?.scope; if (!target || target === scope) event.preventDefault(); }
    function unload(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ''; }
    window.addEventListener('admin:beforeleave', guard);
    window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('admin:beforeleave', guard); window.removeEventListener('beforeunload', unload); };
  }, [dirty, scope]);
}

export function mayLeave(scope?: string, message = 'You have unsaved changes. Leave without saving them?') {
  const clear = window.dispatchEvent(new CustomEvent('admin:beforeleave', { cancelable: true, detail: { scope } }));
  return clear || window.confirm(message);
}

function localParts(value: string) {
  const time = new Date(value).getTime();
  const local = Number.isFinite(time) ? new Date(time + 4 * 3600000).toISOString().slice(0, 16) : '';
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

function toDraft(departure: TourDeparture): Draft {
  const start = localParts(departure.start);
  const end = localParts(departure.end);
  return { id: departure.id, serviceId: departure.serviceId, date: start.date, startTime: start.time, endDate: end.date, endTime: end.time, daySpan: daysBetween(start.date, end.date), capacity: String(departure.capacity), guideId: departure.guideId, vehicleId: departure.vehicleId || '', status: departure.status, version: departure.version };
}

function newDraft(tours: Service[], source?: TourDeparture): Draft {
  return { id: crypto.randomUUID(), serviceId: source?.serviceId || tours[0]?.id || '', date: '', startTime: source ? localParts(source.start).time : '', endDate: '', endTime: source ? localParts(source.end).time : '', daySpan: source ? daysBetween(localParts(source.start).date, localParts(source.end).date) : 0, capacity: String(source?.capacity || tours[0]?.maxGuests || 1), guideId: source?.guideId || '', vehicleId: source?.vehicleId || '', status: 'open', version: 0 };
}

function daysBetween(start: string, end: string) { return start && end ? Math.max(0, Math.round((new Date(`${end}T12:00:00+04:00`).getTime() - new Date(`${start}T12:00:00+04:00`).getTime()) / 86400000)) : 0; }
function shiftDate(date: string, days: number) { return date ? new Date(new Date(`${date}T12:00:00+04:00`).getTime() + days * 86400000).toISOString().slice(0, 10) : ''; }

function dateLabel(value: string) {
  return new Date(value).toLocaleDateString('en-GB', { timeZone: 'Asia/Tbilisi', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function timeLabel(value: string) {
  return new Date(value).toLocaleTimeString('en-GB', { timeZone: 'Asia/Tbilisi', hour: '2-digit', minute: '2-digit', hour12: false });
}

function scheduleLabel(departure: TourDeparture) {
  return localParts(departure.start).date === localParts(departure.end).date
    ? `${timeLabel(departure.start)} – ${timeLabel(departure.end)}`
    : `${timeLabel(departure.start)} – ${dateLabel(departure.end)}, ${timeLabel(departure.end)}`;
}

function goToResources() {
  window.dispatchEvent(new CustomEvent('admin:navigate', { detail: 'resources' }));
}

function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return <label className="admin-field"><span>{label}</span>{children}{help && <small>{help}</small>}</label>;
}

function SeatCounts({ departure }: { departure: TourDeparture }) {
  return <div className="inventory-seats" aria-label="Departure capacity">
    <div><strong>{departure.bookedSeats ?? '—'}</strong><span>confirmed</span></div>
    <div><strong>{departure.remainingSeats ?? '—'}</strong><span>places free</span></div>
    <div><strong>{departure.capacity}</strong><span>total places</span></div>
  </div>;
}

export default function TourInventory({ data, mutate, busy, refresh }: Props) {
  const tours = data.services.filter(service => service.kind === 'tour');
  const activeGuides = data.resources.filter(resource => resource.kind === 'guide' && resource.active);
  const departures = data.departures || [];
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [period, setPeriod] = useState<DateFilter>('upcoming');
  const [tourFilter, setTourFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  useEffect(() => { if (selected || draft) document.getElementById('departure-editor-title')?.focus(); }, [selected, draft]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60000); return () => window.clearInterval(timer); }, []);
  const departure = departures.find(item => item.id === selected);
  const upcoming = departures.filter(item => item.status !== 'cancelled' && new Date(item.start).getTime() > now);
  const openPlaces = upcoming.filter(item => item.status === 'open').reduce((sum, item) => sum + (item.remainingSeats ?? 0), 0);
  const requestedPlaces = upcoming.reduce((sum, item) => sum + (item.requestedSeats ?? 0), 0);
  const filtered = departures.filter(item => {
    const ended = new Date(item.end).getTime() <= now;
    return (period === 'all' || (period === 'past' ? ended : !ended && item.status !== 'cancelled')) && (!tourFilter || item.serviceId === tourFilter) && (!dateFilter || localParts(item.start).date === dateFilter);
  }).sort((a, b) => period === 'past' ? b.start.localeCompare(a.start) : a.start.localeCompare(b.start));

  function clearSelection() { if (busy || !mayLeave('departure')) return false; setSelected(null); setDraft(null); return true; }
  function addDeparture(source?: TourDeparture) { if (busy || !mayLeave('departure')) return; const next = newDraft(tours, source); if (!source && activeGuides.length === 1) next.guideId = activeGuides[0].id; setSelected(null); setDraft(next); }

  return <>
    <div className="admin-heading"><div><div className="admin-eyebrow">A clear place for every guest</div><h1>Tour inventory</h1><p>Set your operating limit, then add dates with a guide and total places.</p></div><div className="admin-actions">{refresh && <button className="admin-btn" type="button" disabled={busy} onClick={refresh}><RefreshCw size={16} />Refresh</button>}<button className="admin-btn primary" type="button" onClick={() => addDeparture()} disabled={busy || !tours.length || !activeGuides.length}><Plus size={16} />Add departure</button></div></div>

    {departures.length > 0 && <div className="inventory-overview" aria-label="Upcoming tour summary"><div><strong>{upcoming.length}</strong><span>upcoming departures</span></div><div><strong>{openPlaces}</strong><span>places open for requests</span></div><div><strong>{requestedPlaces}</strong><span>places requested · not reserved</span></div></div>}

    <TourLimit key={data.tourInventory?.maxConcurrentTours ?? data.settings.maxConcurrentTours ?? 1} data={data} mutate={mutate} busy={busy} guideCount={activeGuides.length} />

    {!activeGuides.length && <div className="admin-notice info inventory-setup"><Info aria-hidden="true" size={18} /><div><strong>Add your guides first</strong><p>Each departure needs one active guide. Add guides, vehicles and rooms in Resources.</p></div><button className="admin-btn small" type="button" onClick={goToResources}>Open Resources</button></div>}
    {!tours.length && <div className="admin-notice info"><Info aria-hidden="true" size={18} /><p>Add a tour in Catalogue before scheduling its departure dates.</p></div>}

    <div className={`admin-grid inventory-grid ${departure || draft ? 'has-selection' : ''}`}>
      <aside className="admin-panel admin-sidebar">
        <div className="admin-filters" aria-label="Departure dates">{(['upcoming', 'past', 'all'] as const).map(value => <button className={`admin-filter ${period === value ? 'active' : ''}`} key={value} type="button" disabled={busy} aria-pressed={period === value} onClick={() => { if (clearSelection()) setPeriod(value); }}>{value === 'upcoming' ? 'Upcoming' : value === 'past' ? 'Past' : 'All dates'}</button>)}</div>
        <div className="inventory-list-filters"><Field label="Tour"><select disabled={busy} value={tourFilter} onChange={event => { if (clearSelection()) setTourFilter(event.target.value); }}><option value="">All tours</option>{tours.map(tour => <option key={tour.id} value={tour.id}>{tour.title}</option>)}</select></Field><Field label="Departure date"><input type="date" disabled={busy} value={dateFilter} onChange={event => { if (clearSelection()) setDateFilter(event.target.value); }} /></Field>{dateFilter && <button type="button" className="inventory-text-button" disabled={busy} onClick={() => { if (clearSelection()) setDateFilter(''); }}>Clear date</button>}</div>
        <div className="admin-list">{filtered.length ? filtered.map(item => {
          const guide = data.resources.find(resource => resource.id === item.guideId);
          return <button className={`admin-listitem inventory-listitem ${selected === item.id ? 'active' : ''}`} aria-pressed={selected === item.id} type="button" disabled={busy} key={item.id} onClick={() => { if (selected !== item.id && !mayLeave('departure')) return; setSelected(item.id); setDraft(null); }}><div className="admin-listitem-top"><strong>{tours.find(tour => tour.id === item.serviceId)?.title || 'Tour'}</strong><span className={`admin-badge ${item.status === 'open' ? 'green' : item.status === 'cancelled' ? 'red' : 'amber'}`}>{item.status === 'open' ? 'Open' : item.status === 'closed' ? 'Closed' : 'Cancelled'}</span></div><span className="inventory-list-date">{dateLabel(item.start)}</span><small>{scheduleLabel(item)} · {guide?.name || 'Guide unavailable'}</small><span className="inventory-list-capacity">{item.bookedSeats ?? '—'} confirmed · {item.remainingSeats ?? '—'} places free</span>{typeof item.requestedSeats === 'number' && item.requestedSeats > 0 && <small>{item.requestedSeats} places requested · not reserved</small>}</button>;
        }) : <div className="admin-empty"><CalendarDays aria-hidden="true" /><h3>{departures.length ? 'No departures match' : 'Add your first departure'}</h3><p>{departures.length ? 'Choose another date or view all dates.' : 'Choose a tour, date, guide and total places. You can copy a departure to add another date quickly.'}</p>{departures.length > 0 && <button type="button" className="admin-btn small" disabled={busy} onClick={() => { setPeriod('all'); setTourFilter(''); setDateFilter(''); }}>Show all departures</button>}</div>}</div>
      </aside>
      <section className="admin-detail">
        {departure || draft ? <><button className="admin-btn small admin-mobile-back" type="button" disabled={busy} onClick={clearSelection}><ArrowLeft size={15} />Departures</button><DepartureEditor key={draft?.id || `${departure?.id}-${departure?.version}`} initial={draft || toDraft(departure!)} departure={draft ? undefined : departure} data={data} mutate={mutate} busy={busy} now={now} onCopy={addDeparture} onSaved={id => { setDraft(null); setSelected(id); setTourFilter(''); setDateFilter(''); setPeriod('all'); }} /></> : <div className="admin-panel"><div className="admin-empty"><Users aria-hidden="true" /><h2>Select a departure</h2><p>See confirmed places, remaining seats and requests. Change capacity or pause new requests without losing existing bookings.</p><div className="inventory-empty-note"><ShieldCheck size={18} aria-hidden="true" /><span>One departure uses one guide and one tour slot. Guests booking that same departure share its places.</span></div></div></div>}
      </section>
    </div>
  </>;
}

function TourLimit({ data, mutate, busy, guideCount }: Props & { guideCount: number }) {
  const current = data.tourInventory?.maxConcurrentTours ?? data.settings.maxConcurrentTours ?? 1;
  const [limit, setLimit] = useState(String(current));
  const [error, setError] = useState('');
  const number = Number(limit);
  useUnsavedDraft(limit !== String(current), 'inventory-limit');
  return <section className="admin-panel inventory-limit"><div className="admin-panel-inner"><div className="inventory-limit-copy"><h2>Maximum tours at the same time</h2><p>Limit overlapping departures across all tours. Each departure still needs its own available guide, and any assigned vehicle.</p><span className="admin-smalltext">{guideCount} active {guideCount === 1 ? 'guide' : 'guides'} · Travel buffers and unavailable times are checked too.</span></div><form className="inventory-limit-form" onSubmit={async event => { event.preventDefault(); setError(''); if (!Number.isInteger(number) || number < 1 || number > 20) { setError('Choose a whole number between 1 and 20.'); return; } await mutate({ action: 'setTourLimit', maxConcurrentTours: number }, 'Simultaneous tour limit saved.'); }}><Field label="Simultaneous tours"><input required disabled={busy} type="number" min="1" max="20" step="1" value={limit} onChange={event => { setLimit(event.target.value); setError(''); }} aria-invalid={!!error} /></Field><button className="admin-btn primary" disabled={busy || number === current} type="submit">Save limit</button>{error && <p className="inventory-form-message" role="alert">{error}</p>}{number > guideCount && <p className="admin-smalltext inventory-limit-hint">This limit can be higher than your guide count. Tours still cannot overlap on the same guide.</p>}</form></div></section>;
}

function ResourceOptions({ resources, selectedId, kind }: { resources: Resource[]; selectedId: string; kind: 'guide' | 'vehicle' }) {
  return <>{resources.filter(resource => resource.kind === kind && (resource.active || resource.id === selectedId)).map(resource => <option key={resource.id} value={resource.id} disabled={!resource.active}>{resource.name}{kind === 'vehicle' ? ` · ${resource.capacity} passengers` : ''}{!resource.active ? ' (inactive)' : ''}</option>)}</>;
}

function DepartureEditor({ initial, departure, data, mutate, busy, now, onCopy, onSaved }: Props & { initial: Draft; departure?: TourDeparture; now: number; onCopy: (departure: TourDeparture) => void; onSaved: (id: string) => void }) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState('');
  const tours = data.services.filter(service => service.kind === 'tour');
  const booked = departure?.bookedSeats;
  const bookingsUnknown = !!departure && booked === undefined;
  const locked = bookingsUnknown || (booked ?? 0) > 0;
  const vehicle = data.resources.find(resource => resource.id === value.vehicleId && resource.kind === 'vehicle');
  const maxCapacity = Math.min(50, vehicle?.capacity ?? 50);
  const service = tours.find(tour => tour.id === value.serviceId);
  const ended = !!departure && new Date(departure.end).getTime() <= now;
  const started = !!departure && new Date(departure.start).getTime() <= now;
  const dirty = JSON.stringify(value) !== JSON.stringify(initial);
  useUnsavedDraft(dirty, 'departure');

  function update<K extends keyof Draft>(field: K, next: Draft[K]) { setValue(previous => ({ ...previous, [field]: next })); setError(''); }
  async function save() {
    setError('');
    const start = `${value.date}T${value.startTime}:00+04:00`;
    const end = `${value.endDate}T${value.endTime}:00+04:00`;
    const capacity = Number(value.capacity);
    if (!value.serviceId) { setError('Choose a tour from your catalogue.'); return; }
    if (!Number.isFinite(new Date(start).getTime()) || !Number.isFinite(new Date(end).getTime()) || new Date(end).getTime() <= new Date(start).getTime()) { setError('Choose a finish date and time after the departure starts.'); return; }
    if (!Number.isInteger(capacity) || capacity < Math.max(1, booked ?? 0) || capacity > maxCapacity) { setError(vehicle ? `Choose ${Math.max(1, booked ?? 0)}–${maxCapacity} total places. ${vehicle.name} carries ${vehicle.capacity} passengers.` : `Choose ${Math.max(1, booked ?? 0)}–50 total places, keeping every confirmed guest’s place.`); return; }
    const guide = data.resources.find(resource => resource.id === value.guideId && resource.kind === 'guide');
    if (!guide || (!locked && !guide.active)) { setError('Choose an active guide. You can add or activate guides in Resources.'); return; }
    if (value.vehicleId && (!vehicle || (!locked && !vehicle.active))) { setError('Choose an active vehicle, or select “No vehicle needed”.'); return; }
    if (value.status === 'cancelled' && locked) { setError('Cancel affected bookings in Requests before cancelling this departure.'); return; }
    const saved = await mutate({ action: 'saveDeparture', departure: { id: value.id, serviceId: value.serviceId, start, end, capacity, guideId: value.guideId, vehicleId: value.vehicleId, status: value.status, version: value.version } }, 'Tour departure saved.');
    if (saved) onSaved(value.id);
  }

  return <div className="admin-panel"><div className="admin-panel-inner">
    <div className="admin-detail-heading"><div><div className="admin-eyebrow">Georgia local time · UTC+4</div><h2 id="departure-editor-title" tabIndex={-1}>{departure ? service?.title || 'Edit departure' : 'Add a tour departure'}</h2><p>{departure ? `${dateLabel(departure.start)} · ${scheduleLabel(departure)}${ended ? ' · Past departure' : ''}` : 'Set a real date and the places you can offer.'}</p></div>{departure && <button className="admin-btn small" type="button" disabled={busy} aria-label="Copy saved departure to a new date" onClick={() => onCopy(departure)}><Copy size={15} />Copy to new date</button>}</div>

    {departure && <><SeatCounts departure={departure} /><p className="admin-smalltext inventory-requested"><strong>{departure.requestedSeats ?? '—'}</strong> places requested · Requests and quotes do not reserve seats.</p></>}
    {started && <div className="admin-notice info"><Info aria-hidden="true" size={18} /><p>This departure has started. Its schedule and capacity are available to view; copy it to schedule another date.</p></div>}
    {locked && <div className="admin-notice info"><ShieldCheck aria-hidden="true" size={18} /><p>{bookingsUnknown ? 'Booking counts are unavailable. Reload inventory before changing the schedule or cancelling.' : 'This departure has confirmed guests. Its tour, schedule, guide and vehicle stay fixed. You can change total places or close and reopen requests.'}</p></div>}

    <form className="admin-form" onSubmit={async event => { event.preventDefault(); await save(); }}>
      <fieldset className="inventory-fieldset" disabled={locked || busy || started}>
        <Field label="Tour" help="The tour must be published with checked details before guests can request it."><select required value={value.serviceId} onChange={event => { const tour = tours.find(item => item.id === event.target.value); setValue(previous => ({ ...previous, serviceId: event.target.value, capacity: departure ? previous.capacity : String(tour?.maxGuests || 1) })); setError(''); }}><option value="">Choose a tour</option>{tours.map(tour => <option key={tour.id} value={tour.id}>{tour.title}{tour.proposed ? ' (proposal)' : !tour.published ? ' (draft)' : ''}</option>)}</select></Field>
        <div className="admin-form-row"><Field label="Departure date"><input required type="date" value={value.date} onChange={event => { const date = event.target.value; setValue(previous => ({ ...previous, date, endDate: shiftDate(date, previous.daySpan) })); setError(''); }} /></Field><Field label="Starts at"><input required type="time" value={value.startTime} onChange={event => update('startTime', event.target.value)} /></Field></div>
        <div className="admin-form-row"><Field label="Finish date" help="Use the same date for a day tour."><input required type="date" min={value.date} value={value.endDate} onChange={event => { const endDate = event.target.value; setValue(previous => ({ ...previous, endDate, daySpan: daysBetween(previous.date, endDate) })); setError(''); }} /></Field><Field label="Finishes at"><input required type="time" value={value.endTime} onChange={event => update('endTime', event.target.value)} /></Field></div>
        <div className="admin-form-row"><Field label="Guide" help="One guide cannot lead two overlapping departures."><select required value={value.guideId} onChange={event => update('guideId', event.target.value)}><option value="">Choose a guide</option><ResourceOptions resources={data.resources} selectedId={value.guideId} kind="guide" /></select></Field><Field label="Vehicle (if needed)" help="The same vehicle cannot be assigned to overlapping jobs."><select value={value.vehicleId} onChange={event => update('vehicleId', event.target.value)}><option value="">No vehicle needed</option><ResourceOptions resources={data.resources} selectedId={value.vehicleId} kind="vehicle" /></select></Field></div>
      </fieldset>
      <div className="admin-form-row"><Field label="Total places on this departure" help={vehicle ? `Maximum ${vehicle.capacity} passengers in ${vehicle.name}. Confirmed places cannot be removed.` : 'Guests in separate bookings share these places. Confirmed places cannot be removed.'}><input required type="number" min={Math.max(1, booked ?? 0)} max={maxCapacity} step="1" value={value.capacity} onChange={event => update('capacity', event.target.value)} disabled={busy || bookingsUnknown || started} /></Field><Field label="Departure status" help={value.status === 'closed' ? 'Pauses requests; the guide, vehicle and tour slot remain scheduled.' : value.status === 'cancelled' ? 'Releases the schedule when there are no confirmed bookings.' : 'Guests can request remaining places; confirmation still needs your checks.'}><select value={value.status} onChange={event => update('status', event.target.value as Draft['status'])} disabled={busy || started}><option value="open">Open for requests</option><option value="closed">Closed to requests</option><option value="cancelled" disabled={locked}>Cancelled</option></select></Field></div>
      {locked && !bookingsUnknown && <p className="admin-smalltext inventory-cancel-help">To cancel this departure, cancel its affected bookings in Requests first.</p>}
      {error && <div className="admin-notice error inventory-local-error" role="alert"><p>{error}</p></div>}
      <div className="inventory-save"><button className="admin-btn primary" type="submit" disabled={busy || bookingsUnknown || started || (!!departure && !dirty)}>{busy ? 'Saving…' : 'Save departure'}</button><span className="admin-smalltext">{dirty ? 'Unsaved changes · availability checked when you save.' : departure ? 'All changes saved.' : 'Availability and capacity are checked when you save.'}</span></div>
    </form>
  </div></div>;
}
