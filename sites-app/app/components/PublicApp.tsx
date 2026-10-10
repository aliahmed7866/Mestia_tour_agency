"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowRight, Check, CheckCircle2, Copy, ChevronDown, ChevronLeft, Clock3, Flame, House, Leaf, MapPin, Mountain, Plus, ShieldCheck, Sparkles, TentTree, Trash2, Users, X, CarFront, MessageCircle, LoaderCircle } from "lucide-react";
import type { PublicDeparture, Service, Settings, RequestItem as TripItem, ServiceKind as Kind } from "../lib/types";
import "../public.css";

type Catalogue = { settings: Settings; services: Service[]; departures: PublicDeparture[] };
type SavedRequest = { reference: string; token: string };
const kinds: { id: Kind; title: string; verb: string; description: string; icon: typeof Mountain }[] = [
  { id: "tour", title: "Tours & adventures", verb: "Explore tours", description: "Find your kind of mountain day.", icon: Mountain },
  { id: "stay", title: "A welcoming stay", verb: "Stay with us", description: "Come back to a little warmth.", icon: House },
  { id: "taxi", title: "Taxis & transfers", verb: "Plan a ride", description: "Get there with one simple request.", icon: CarFront },
];

function Landscape({ variant = "hero" }: { variant?: "hero" | Kind }) {
  const isHero = variant === "hero";
  const illustrationId = useId().replace(/:/g, "");
  return <svg className={`landscape landscape-${variant}`} viewBox="0 0 1000 700" role="img" aria-label="Artistic illustration of mountains, Svan towers and a forested valley in Svaneti" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id={`sky-${illustrationId}`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#d6e1dc"/><stop offset="1" stopColor="#ecede1"/></linearGradient>
      <linearGradient id={`mountain-${illustrationId}`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#6d8984"/><stop offset="1" stopColor="#a4b6a8"/></linearGradient>
      <linearGradient id={`front-${illustrationId}`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#263e32"/><stop offset="1" stopColor="#46644d"/></linearGradient>
      <filter id={`grain-${illustrationId}`}><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".08"/></feComponentTransfer><feBlend in="SourceGraphic" mode="multiply"/></filter>
    </defs>
    <g filter={`url(#grain-${illustrationId})`}>
      <path fill={`url(#sky-${illustrationId})`} d="M0 0h1000v700H0z"/>
      <circle cx="815" cy="124" r="55" fill="#f8f3d9" opacity=".88"/>
      <path d="M0 346 104 239 158 282 264 116 312 198 418 75 514 237 581 189 680 311 760 151 876 289 947 235 1000 284v416H0Z" fill="#bdcec6"/>
      <path d="m158 282 106-166 48 82 106-123 96 162-88-77-8-54-31 54-28 26-57 73-41-87-28 49-27-22-35 79Z" fill="#f0f3e9"/>
      <path d="m699 274 61-123 116 138-84-58-19-32-13 18-23-7Z" fill="#eff2e7"/>
      <path d="M0 420 95 350 170 381 298 253 348 298 474 204 551 336 623 293 703 350 832 254 1000 391v309H0Z" fill={`url(#mountain-${illustrationId})`}/>
      <path d="m298 253 50 45 126-94 77 132-77-74-12-25-26 42-37 9-54 42-33-38-32 30Z" fill="#dce6da" opacity=".85"/>
      <path d="M0 492q172-119 361-40t389-23q100-86 250-39v310H0Z" fill="#789173"/>
      <path d="M0 591q166-156 374-87t351-12q137-80 275-36v244H0Z" fill="#536f54"/>
      <path d="M590 472q-69 48-26 87t-67 57q-65 44 17 84h150q-106-64-49-90t-3-55q-45-24 27-78Z" fill="#a9bdab"/>
      <path d="M0 577q126-44 270-1t210 124H0Z" fill={`url(#front-${illustrationId})`}/>
      <path d="M1000 537Q851 490 765 577t-93 123h328Z" fill="#2f4c39"/>
      {[18,62,112,170,222,850,891,938,979].map((x, i) => <g key={x} transform={`translate(${x} ${510 + (i % 3) * 20}) scale(${.8 + (i % 3) * .2})`}><path d="M-18 52 0-22 18 52Z" fill="#2a4935"/><path d="M-24 75 0-7 24 75Z" fill="#264531"/><path d="M-30 101 0 28 30 101Z" fill="#213f2e"/><path d="M-2 87h4v33h-4Z" fill="#776144"/></g>)}
      <g transform={variant === "stay" ? "translate(400 404) scale(1.3)" : "translate(304 449)"}>
        <path d="M0 65h143v68H0Z" fill="#c7bca5"/><path d="m-15 68 81-48 85 48Z" fill="#865b43"/><path d="m67 20 4 48h80Z" fill="#6d4936"/>
        <path d="M14 81h20v26H14m21-26h20v26H35m44-26h21v26H79m26-26h21v26h-21" fill="#dacaab" stroke="#786f5d" strokeWidth="4"/><path d="M58 96h20v37H58Z" fill="#665c48"/>
        <path d="M112 11h43v122h-43Z" fill="#b9ad94"/><path d="M107 10h54v11h-54Z" fill="#a79a83"/><path d="M109 1h8v17h-8m12-17h9v17h-9m14-17h9v17h-9m13-17h9v17h-9" fill="#b9ad94"/>
        <path d="M127 36h13v19h-13m0 24h13v19h-13" fill="#596050"/><path d="M116 109h12v24h-12" fill="#5d5947"/>
        <path d="M2 133h157" stroke="#a2ae84" strokeWidth="8"/>
      </g>
      {variant === "taxi" && <g transform="translate(582 572)"><path d="M-5 46h160l-9-45H43L24 20H-5Z" fill="#ded9bc"/><path d="M46 7h44v28H25Z" fill="#607972"/><path d="M96 7h36l6 28H96Z" fill="#607972"/><circle cx="28" cy="48" r="17" fill="#253b31"/><circle cx="124" cy="48" r="17" fill="#253b31"/><circle cx="28" cy="48" r="8" fill="#a4aa95"/><circle cx="124" cy="48" r="8" fill="#a4aa95"/></g>}
      {isHero && <g fill="#48655a"><path d="m545 139 10-5 10 5-10-1Zm29-22 8-4 8 4-8-1Zm14 28 8-4 8 4-8-1Z"/></g>}
    </g>
  </svg>;
}

function Modal({ title, onClose, children, wide = false, focusKey }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; elevated?: boolean; focusKey?: string | number }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const surface = dialog.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (surface && !surface.open) surface.showModal();
    return () => {
      surface?.close();
      document.body.style.overflow = oldOverflow;
      (previousFocus?.isConnected ? previousFocus : document.querySelector<HTMLElement>(".mt-header-cta"))?.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const heading = panel.current?.querySelector<HTMLElement>("[data-step-focus]");
    if (heading) {
      panel.current?.scrollTo({ top: 0 });
      heading.focus({ preventScroll: true });
    }
  }, [focusKey]);
  return <dialog ref={dialog} className="mt-modal-dialog" aria-label={title} onCancel={event => { event.preventDefault(); closeRef.current(); }} onMouseDown={event => { if (event.target === event.currentTarget) closeRef.current(); }}><div ref={panel} className={`mt-modal${wide ? " mt-modal-wide" : ""}`}><button type="button" className="mt-icon-button mt-modal-close" onClick={onClose} aria-label="Close dialog"><X size={21}/></button>{children}</div></dialog>;
}

async function fetchCatalogue(): Promise<Catalogue> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch("/api/catalogue", { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error("Catalogue could not be loaded.");
    return await response.json() as Catalogue;
  } finally { window.clearTimeout(timeout); }
}
function serviceImage(service: Service) { return /^(\/(?!\/)|https:\/\/)/.test(service.image) ? service.image : ""; }
function inclusionList(service: Service) { return service.inclusions.split(/\n|;/).map(value => value.trim()).filter(Boolean); }

function Price({ service }: { service: Service }) {
  return <div className="mt-price">{service.price === null ? <span>Price on request</span> : <><strong>{new Intl.NumberFormat("en-GB").format(service.price)} GEL</strong><span>{service.priceBasis}</span></>}</div>;
}
function todayInTbilisi() { const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tbilisi", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()); return ["year", "month", "day"].map(type => parts.find(part => part.type === type)?.value).join("-"); }
function niceDate(date: string) { return date ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)) : "Date to choose"; }
function departureDateTime(value: string) { const local = new Date(new Date(value).getTime() + 4 * 3600000).toISOString(); return { date: local.slice(0, 10), time: local.slice(11, 16) }; }
function remainingLabel(departure?: PublicDeparture) { if (!departure) return "Please choose this tour date again."; const remaining = Math.max(0, departure.remainingSeats ?? departure.capacity - (departure.bookedSeats || 0)); return `${remaining} ${remaining === 1 ? "place" : "places"} currently available`; }
function departureLabel(departure: PublicDeparture) { const local = departureDateTime(departure.start); return `${niceDate(local.date)} at ${local.time} · ${remainingLabel(departure)}`; }
function whatsappLink(number: string, message: string) { const digits = number.replace(/\D/g, ""); return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : ""; }

export default function PublicApp() {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState<Kind | "all">("all");
  const [difficulty, setDifficulty] = useState("all");
  const [detail, setDetail] = useState<Service | null>(null);
  const [items, setItems] = useState<TripItem[]>([]);
  const [requestOpen, setRequestOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ name: "", contact: "", guests: "2", notes: "", website: "" });
  const [formError, setFormError] = useState("");
  const [sending, setSending] = useState(false);
  const [saved, setSaved] = useState<SavedRequest | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [copyNotice, setCopyNotice] = useState("");
  const [info, setInfo] = useState<"policy" | "privacy" | null>(null);
  const idempotency = useRef({ payload: "", key: "" });
  const errorRef = useRef<HTMLDivElement>(null);
  const services = catalogue?.services.filter(service => service.published) || [];
  const departures = catalogue?.departures || [];
  const settings = catalogue?.settings;
  const selected = items.map(item => ({ item, service: services.find(service => service.id === item.serviceId) })).filter((entry): entry is { item: TripItem; service: Service } => !!entry.service);
  const visible = services.filter(service => (filter === "all" || service.kind === filter) && (difficulty === "all" || service.kind !== "tour" || service.difficulty === difficulty));
  const difficulties = [...new Set(services.filter(service => service.kind === "tour" && service.difficulty).map(service => service.difficulty))];
  const minDate = todayInTbilisi();

  async function loadCatalogue() {
    try {
      const next = await fetchCatalogue();
      const refreshedAt = Date.now();
      const changed = items.filter(item => {
        if (!item.departureId) return false;
        const departure = next.departures?.find(candidate => candidate.id === item.departureId);
        if (!departure || departure.status !== "open" || new Date(departure.start).getTime() <= refreshedAt) return true;
        const local = departureDateTime(departure.start);
        return item.date !== local.date || item.time !== local.time;
      });
      setCatalogue(next); setClock(refreshedAt); setLoadError("");
      if (changed.length) {
        setItems(previous => previous.map(item => {
          if (!changed.some(old => old.serviceId === item.serviceId && old.departureId === item.departureId)) return item;
          const { departureId, time, ...rest } = item;
          void departureId; void time;
          return { ...rest, date: "" };
        }));
        setFormError("A selected tour date changed or is no longer open. Please choose its date again.");
      }
    }
    catch { setLoadError("We couldn’t load the catalogue. Please try again."); }
  }
  useEffect(() => {
    let active = true;
    fetchCatalogue().then(data => { if (active) { setCatalogue(data); setClock(Date.now()); } }).catch(() => { if (active) setLoadError("We couldn’t load the catalogue. Please try again."); });
    return () => { active = false; };
  }, []);
  useEffect(() => { if (!requestOpen) return; const timer = window.setInterval(() => setClock(Date.now()), 30000); return () => window.clearInterval(timer); }, [requestOpen]);
  useEffect(() => { if (formError) errorRef.current?.focus(); }, [formError]);
  function browseCatalogue(kind: Kind | "all" = "all") {
    setFilter(kind); setDifficulty("all");
    document.getElementById("experiences")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    document.getElementById("experiences-title")?.focus({ preventScroll: true });
  }
  function chooseKind(kind: Kind) { browseCatalogue(kind); }
  function beginPlan() { if (items.length) openRequest(); else browseCatalogue(); }
  function serviceDepartures(id: string) { return departures.filter(departure => departure.serviceId === id && departure.status === "open" && new Date(departure.start).getTime() > clock).sort((a, b) => a.start.localeCompare(b.start)); }
  async function copyPrivateLink() {
    if (!saved) return;
    try { await navigator.clipboard.writeText(`${window.location.origin}/request#${saved.token}`); setCopyNotice("Private link copied. Keep it somewhere safe."); }
    catch { setCopyNotice("Open your private request, then save its address from your browser."); }
  }
  function addService(service: Service) {
    if (!items.some(item => item.serviceId === service.id)) {
      const sameKind = items.filter(item => services.find(candidate => candidate.id === item.serviceId)?.kind === service.kind);
      if ((service.kind !== "tour" && sameKind.length >= 1) || (service.kind === "tour" && sameKind.length >= 4)) { setStep(0); setRequestOpen(true); setFormError(service.kind === "tour" ? "A request can include up to four tours. Remove a tour to choose another." : `Choose one ${service.kind === "stay" ? "stay" : "ride"} per request. Remove the selected ${service.kind === "stay" ? "stay" : "ride"} to choose this one.`); return; }
    }
    if (!items.some(item => item.serviceId === service.id)) setItems(previous => [...previous, { serviceId: service.id, date: "", ...(service.kind === "stay" ? { endDate: "" } : {}), ...(service.kind === "taxi" ? { time: "", pickup: "", destination: "", luggage: "" } : {}) }]);
    setFormError(""); setSaved(null);
  }
  function addServiceAndFocus(service: Service) {
    addService(service);
    window.requestAnimationFrame(() => document.getElementById(`mt-trip-${service.id}`)?.focus());
  }
  function removeService(id: string) {
    setItems(previous => previous.filter(item => item.serviceId !== id));
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>(".mt-add-services summary")?.focus());
  }
  function updateItem(id: string, field: keyof TripItem, value: string) { setItems(previous => previous.map(item => item.serviceId === id ? { ...item, [field]: value } : item)); setFormError(""); }
  function chooseDeparture(serviceId: string, departureId: string) {
    const departure = departures.find(candidate => candidate.id === departureId);
    setItems(previous => previous.map(item => {
      if (item.serviceId !== serviceId) return item;
      const { departureId: previousDepartureId, time: previousTime, ...rest } = item;
      void previousDepartureId; void previousTime;
      return departure ? { ...rest, departureId, ...departureDateTime(departure.start) } : { ...rest, date: "" };
    }));
    setFormError("");
  }
  function openRequest() { setStep(0); setFormError(""); setRequestOpen(true); void loadCatalogue(); }
  const closeRequest = () => { if (!sending) setRequestOpen(false); };
  function validateDates() {
    if (!selected.length) return "Choose at least one service for your request.";
    for (const { item, service } of selected) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date) || item.date < minDate) return `Choose a date from today onward for ${service.title}.`;
      if (service.kind === "stay" && (!item.endDate || item.endDate <= item.date)) return `Choose a checkout date after arrival for ${service.title}.`;
      if (service.kind === "stay" && item.endDate && (Date.parse(item.endDate) - Date.parse(item.date)) / 86400000 > 30) return "For stays over 30 nights, please contact the team.";
      if (service.kind === "taxi" && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(item.time || "") || !item.pickup?.trim() || !item.destination?.trim())) return `Add a pickup time, pickup place and destination for ${service.title}.`;
      if (item.departureId) { const departure = departures.find(candidate => candidate.id === item.departureId); if (!departure || departure.status !== "open" || new Date(departure.start).getTime() <= clock) return `That scheduled date for ${service.title} is no longer available. Choose another departure or request another date.`; }
    }
    return "";
  }
  function validateParty() {
    const guests = Number(form.guests);
    if (!Number.isInteger(guests) || guests < 1 || guests > 50) return "Choose a group size between 1 and 50.";
    const capacity = selected.find(({ service }) => service.maxGuests > 0 && guests > service.maxGuests);
    if (capacity) return `${capacity.service.title} is listed for up to ${capacity.service.maxGuests} guests. Reduce your group size or remove this service.`;
    for (const { item, service } of selected) {
      if (!item.departureId) continue;
      const departure = departures.find(candidate => candidate.id === item.departureId);
      const remaining = departure ? departure.remainingSeats ?? departure.capacity - (departure.bookedSeats || 0) : 0;
      if (guests > remaining) return `Only ${remaining} ${remaining === 1 ? "place remains" : "places remain"} on that date for ${service.title}. Reduce your group size or choose another date.`;
    }
    return "";
  }
  function validateContact() {
    const partyError = validateParty();
    if (partyError) return partyError;
    if (form.name.trim().length < 2) return "Please add your name.";
    const contact = form.contact.trim();
    if (!( /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) || /^\+?[\d ()-]{7,35}$/.test(contact) && contact.replace(/\D/g, "").length >= 7 )) return "Add a reachable email address or phone number, including the country code.";
    return "";
  }
  function nextStep() { const error = step === 0 ? validateDates() || validateParty() : validateContact(); if (error) { setFormError(error); return; } setFormError(""); setStep(step + 1); }
  async function submitRequest() {
    const error = validateDates() || validateContact();
    if (error) { setFormError(error); return; }
    if (!acknowledged) { setFormError("Please acknowledge that this is a request awaiting confirmation."); return; }
    const payload = { ...form, name: form.name.trim(), contact: form.contact.trim(), guests: Number(form.guests), notes: form.notes.trim(), items: selected.map(({ item }) => { const { departureId, ...rest } = item; return { ...rest, ...(departureId ? { departureId } : {}) }; }) };
    const serialized = JSON.stringify(payload);
    if (idempotency.current.payload !== serialized) idempotency.current = { payload: serialized, key: crypto.randomUUID() };
    setSending(true); setFormError("");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch("/api/requests", { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, idempotencyKey: idempotency.current.key }) });
      const body = await response.json() as { error?: string; reference?: string; token?: string };
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "We couldn’t save your request. Please try again.");
      if (!body.reference || !body.token) throw new Error("The response was incomplete. Please retry to retrieve your saved request.");
      setSaved({ reference: body.reference, token: body.token }); setCopyNotice(""); setForm({ name: "", contact: "", guests: "2", notes: "", website: "" });
    } catch (error) { setFormError(error instanceof Error && error.name !== "AbortError" ? error.message : "The connection took too long. Please retry; your request will not be duplicated."); }
    finally { window.clearTimeout(timeout); setSending(false); }
  }
  const contactLink = settings?.whatsapp ? whatsappLink(settings.whatsapp, "Hello, I’d like to plan a trip to Mestia.") : "";

  return <div className="mt-public">
    <a className="mt-skip" href="#main-content">Skip to content</a>
    <div className="mt-pilot"><span className="mt-pilot-dot"/> Pilot website <span className="mt-pilot-divider">·</span> Proposed catalogue — availability, prices and business details need owner approval.</div>
    <header className="mt-header mt-container">
      <a className="mt-logo" href="#" aria-label={`${settings?.businessName || "Mestia Travel"} home`}><span className="mt-logo-icon"><Mountain size={27} strokeWidth={1.4}/></span><span>{settings?.businessName || "Mestia Travel"}<small>SVANETI, GEORGIA</small></span></a>
      <nav className="mt-nav" aria-label="Main navigation"><a href="#experiences">Explore</a><a href="#stay">The guesthouse</a><a href="#questions">Good to know</a></nav>
      {saved ? <a className="mt-button mt-button-dark mt-header-cta" href={`/request#${saved.token}`}>My request <ArrowRight size={16}/></a> : <button className="mt-button mt-button-dark mt-header-cta" onClick={beginPlan}>{items.length ? "Review my trip" : "Explore services"} <ArrowRight size={16}/></button>}
    </header>

    <main id="main-content">
      <section className="mt-hero mt-container" aria-labelledby="hero-title">
        <div className="mt-hero-copy"><p className="mt-eyebrow"><span/> YOUR WAY INTO THE MOUNTAINS</p><h1 id="hero-title">Big mountain days.<br/><em>A warm place<br className="mt-desktop-break"/> to return to.</em></h1><p className="mt-hero-description">Discover Svaneti with a local guide. Find a tour, settle into a guesthouse, and plan your ride — all in one place.</p><a className="mt-button mt-button-dark" href="#experiences">Find your mountain day <ArrowDown size={16}/></a><div className="mt-hero-footnote"><Leaf size={16}/> A little adventure. A little fireside warmth.</div></div>
        <div className="mt-hero-art"><Landscape/><span className="mt-hero-location"><MapPin size={14}/> MESTIA · SVANETI</span><div className="mt-art-note">An artistic landscape illustration</div><div className="mt-hero-quote"><Mountain size={22} strokeWidth={1.3}/><span>Take the scenic way.<small>We’ll help with the details.</small></span></div></div>
      </section>

      <section className="mt-choice-row mt-container" aria-label="What would you like to do?">{kinds.map(({ id, verb, description, icon: Icon }, index) => <button key={id} className="mt-choice" onClick={() => chooseKind(id)}><span className={`mt-choice-icon mt-choice-${id}`}><Icon size={25} strokeWidth={1.5}/></span><span><small>0{index + 1}</small><strong>{verb}</strong><span>{description}</span></span><ArrowRight className="mt-choice-arrow" size={20}/></button>)}</section>

      <section className="mt-experiences mt-container" id="experiences" aria-labelledby="experiences-title">
        <div className="mt-section-top"><div><p className="mt-eyebrow">START WITH SOMETHING YOU LOVE</p><h2 id="experiences-title" tabIndex={-1}>A few good ways to be here.</h2></div><p>Choose a little or combine it all.<br/>We’ll check the details and send you a quote.</p></div>
        <div className="mt-catalogue-bar"><div className="mt-filters" role="group" aria-label="Filter services"><button className={filter === "all" ? "active" : ""} aria-pressed={filter === "all"} onClick={() => { setFilter("all"); setDifficulty("all"); }}>Everything</button>{kinds.map(({ id, icon: Icon }) => <button key={id} className={filter === id ? "active" : ""} aria-pressed={filter === id} onClick={() => { setFilter(id); setDifficulty("all"); }}><Icon size={16}/>{id === "tour" ? "Tours" : id === "stay" ? "Stays" : "Rides"}</button>)}</div>{filter === "tour" && difficulties.length > 1 && <label className="mt-difficulty">Difficulty <select value={difficulty} onChange={event => setDifficulty(event.target.value)}><option value="all">Any pace</option>{difficulties.map(value => <option key={value}>{value}</option>)}</select><ChevronDown size={14}/></label>}<span className="mt-catalogue-note"><ShieldCheck size={15}/> Request first. Confirm together.</span></div>
        {loadError ? <div className="mt-load-error" role="alert"><p>{loadError}</p><button className="mt-button mt-button-outline" onClick={() => { setLoadError(""); void loadCatalogue(); }}>Try again</button></div> : !catalogue ? <div className="mt-service-grid" aria-label="Loading catalogue" aria-busy="true">{[1,2,3].map(i => <div className="mt-card-skeleton" key={i}><div/><span/><span/></div>)}</div> : visible.length === 0 ? <div className="mt-empty"><Mountain size={30}/><h3>A little more is on the way.</h3><p>There are no published services in this category yet.</p><button className="mt-button mt-button-outline" onClick={() => { setFilter("all"); setDifficulty("all"); }}>See all services</button></div> : <div className="mt-service-grid">{visible.map(service => { const chosen = items.some(item => item.serviceId === service.id); return <article className={`mt-service-card mt-service-${service.kind}`} key={service.id}><button className="mt-card-image" onClick={() => setDetail(service)} aria-label={`View ${service.title}`}>{serviceImage(service) ? <img src={serviceImage(service)} alt={service.title} loading="lazy"/> : <Landscape variant={service.kind}/>}<span className="mt-kind-badge">{service.kind === "tour" ? <Mountain size={13}/> : service.kind === "stay" ? <House size={13}/> : <CarFront size={13}/>} {service.kind === "tour" ? "Explore" : service.kind === "stay" ? "Rest & recharge" : "Get around"}</span>{service.proposed && <span className="mt-proposal">Proposed</span>}</button><div className="mt-card-body"><div className="mt-card-meta">{service.duration && <span><Clock3 size={13}/>{service.duration}</span>}{service.difficulty && <span>{service.difficulty}</span>}</div><button className="mt-card-title" onClick={() => setDetail(service)}><h3>{service.title}</h3></button><p>{service.description}</p><div className="mt-card-bottom"><Price service={service}/><button className={`mt-add-button${chosen ? " chosen" : ""}`} onClick={() => chosen ? openRequest() : addService(service)} aria-label={chosen ? `Review ${service.title} in your trip` : `Add ${service.title} to your trip`}>{chosen ? <Check size={16}/> : <Plus size={16}/>}<span>{chosen ? "Added" : "Add to trip"}</span></button></div></div></article>; })}</div>}
        <p className="mt-catalogue-caption"><Leaf size={14}/> Your dates are a request. Routes, rooms and rides are checked before confirmation.</p>
      </section>

      {settings?.discountEnabled && settings.discountPercent > 0 && <section className="mt-bundle mt-container"><span className="mt-bundle-icon"><Sparkles size={27}/></span><div><p className="mt-eyebrow">A LITTLE MORE TO LOOK FORWARD TO</p><h3>Stay here. Explore together.</h3><p>Request a guesthouse stay and a tour together for a proposed {settings.discountPercent}% tour saving. Eligibility and the final price will be confirmed in your quote.</p></div><button className="mt-button mt-button-outline" onClick={beginPlan}>Build my trip <ArrowRight size={17}/></button></section>}

      <section className="mt-stay-section" id="stay"><div className="mt-stay-inner mt-container"><div className="mt-stay-art"><Landscape variant="stay"/><div className="mt-stay-stamp"><Flame size={30} strokeWidth={1.4}/><span>Outside, adventure.<br/>Inside, a little warmth.</span></div><small>Illustration · Actual room and guesthouse photos to be added</small></div><div className="mt-stay-copy"><p className="mt-eyebrow">MAKE YOURSELF AT HOME</p><h2>Slow down.<br/><em>Stay awhile.</em></h2><p>Mountain views, a fireplace and welcoming shared spaces. A place to take off your boots, swap a story, and start dreaming about tomorrow.</p><ul className="mt-stay-features"><li><Mountain size={20} strokeWidth={1.4}/><span>Mountain views</span></li><li><Flame size={20} strokeWidth={1.4}/><span>Fireside warmth</span></li><li><Users size={20} strokeWidth={1.4}/><span>Space to settle in</span></li></ul><p className="mt-stay-small">Room details, nightly rates and check-in arrangements will be confirmed with your stay request.</p><button className="mt-button mt-button-dark" onClick={() => chooseKind("stay")}>Find your stay <ArrowRight size={16}/></button></div></div></section>

      <section className="mt-how mt-container" aria-labelledby="how-title"><div className="mt-how-intro"><p className="mt-eyebrow">LESS PLANNING. MORE LOOKING FORWARD.</p><h2 id="how-title">A simple path<br/>to your trip.</h2><p>One request brings it together.<br/>Every booking gets a human check.</p></div><div className="mt-how-steps">{[{ title: "Make it yours", copy: "Choose your tour, stay or ride. Add your dates and a way to reach you.", icon: TentTree }, { title: "We check the details", copy: "The team checks availability and sends a quote with prices and terms.", icon: MessageCircle }, { title: "Confirm, then look forward", copy: "Accept your quote. Once any required deposit and arrangements are checked, your booking is confirmed.", icon: CheckCircle2 }].map(({ title, copy, icon: Icon }, i) => <div className="mt-how-step" key={title}><span className="mt-step-number">0{i + 1}</span><Icon size={24} strokeWidth={1.4}/><h3>{title}</h3><p>{copy}</p></div>)}</div></section>

      <section className="mt-faq mt-container" id="questions" aria-labelledby="faq-title"><div className="mt-faq-intro"><p className="mt-eyebrow">GOOD TO KNOW BEFORE YOU GO</p><h2 id="faq-title">Small questions.<br/><em>Clear answers.</em></h2><p>A little clarity makes the mountains feel closer.</p>{contactLink && <a className="mt-text-link" href={contactLink} target="_blank" rel="noopener noreferrer">Still wondering? Open WhatsApp <ArrowRight size={16}/></a>}</div><div className="mt-faq-list">{[
        ["Is my request a confirmed booking?", "Not yet. We check availability, send you a quote, and confirm after you accept the price and terms and any required deposit is verified. Until then, your request is awaiting confirmation."],
        ["Can I book a stay, a tour and a ride together?", "Yes. Add each service to your trip, choose its dates, and send one request. Each part is checked and priced separately so you can see exactly what is included."],
        ["Can I join a scheduled tour?", "When scheduled dates are available, choose a departure and see the places currently left. Several groups can join the same tour. Sending a request does not reserve places; the team checks capacity again before confirming your booking."],
        ["How does a taxi request work?", "Add your pickup, destination, local departure time, passengers and luggage. The team checks the fare and a suitable driver. A ride is confirmed only when you accept the fare and the driver accepts the trip."],
        ["What if the weather changes?", "Mountain conditions can affect an itinerary. The team will check your route and discuss changes or alternatives with you. Your quote will explain the terms for unsafe conditions or operator cancellations."],
        ["Do I need to pay a deposit?", "It depends on the service and the agreed quote. If a deposit is needed, you will receive the amount, method and deadline. A payment is recorded separately from booking confirmation."],
        ["How can I change or cancel my plans?", "Use the private request link you receive after submitting or contact the team with your reference. Changes depend on availability; cancellation and refund terms are shown in your quote before you accept."],
        ["Which time zone are the dates and pickup times in?", "All trip dates and times are local to Mestia, Georgia (Asia/Tbilisi). Stays use local arrival and checkout dates."],
      ].map(([question, answer]) => <details key={question}><summary>{question}<Plus size={17}/></summary><p>{answer}</p></details>)}</div></section>

      <section className="mt-final-cta mt-container"><span className="mt-cta-mountain"><Mountain size={43} strokeWidth={1.1}/></span><div><p className="mt-eyebrow">THE MOUNTAINS CAN WAIT. YOUR PLANS DON’T HAVE TO.</p><h2>Let’s make your Mestia trip.</h2><p>Choose what you love. We’ll help bring it together.</p></div><button className="mt-button mt-button-cream" onClick={beginPlan}>{items.length ? "Review my trip" : "Choose my services"} <ArrowRight size={17}/></button></section>
    </main>

    <footer className="mt-footer mt-container"><div className="mt-footer-top"><a className="mt-logo" href="#"><span className="mt-logo-icon"><Mountain size={27} strokeWidth={1.4}/></span><span>{settings?.businessName || "Mestia Travel"}<small>SVANETI, GEORGIA</small></span></a><p>Mountain days. Warm stays.<br/>A local way into Svaneti.</p><div className="mt-footer-contact"><span><MapPin size={15}/> Mestia, Svaneti, Georgia</span>{settings?.operatingHours && <span><Clock3 size={15}/> {settings.operatingHours}</span>}{contactLink && <a href={contactLink} target="_blank" rel="noopener noreferrer"><MessageCircle size={15}/> Open WhatsApp</a>}</div></div><div className="mt-footer-bottom"><span>© {new Date().getFullYear()} {settings?.businessName || "Mestia Travel"}</span><div><button onClick={() => setInfo("policy")}>Booking terms</button><button onClick={() => setInfo("privacy")}>Privacy</button><a href="/admin">Owner dashboard <ArrowRight size={12}/></a></div></div></footer>

    {(items.length > 0 || saved) && !requestOpen && <div className="mt-trip-dock" role="region" aria-label="Your selected trip"><span className="mt-dock-icon"><TentTree size={24} strokeWidth={1.4}/></span><div><strong>{saved ? "Your request is saved." : "Your trip is taking shape."}</strong><span>{saved ? saved.reference : <>{items.length} {items.length === 1 ? "service" : "services"} selected <span className="mt-dock-desktop">· Dates and details come next</span></>}</span></div>{saved ? <a className="mt-button mt-button-dark" href={`/request#${saved.token}`}>View my request <ArrowRight size={16}/></a> : <button className="mt-button mt-button-dark" onClick={openRequest}>Review my trip <ArrowRight size={16}/></button>}</div>}

    {detail && <Modal title={detail.title} onClose={() => setDetail(null)}><div className="mt-detail-art">{serviceImage(detail) ? <img src={serviceImage(detail)} alt={detail.title}/> : <Landscape variant={detail.kind}/>}</div><div className="mt-detail-content"><p className="mt-eyebrow">{detail.proposed ? "PROPOSED CATALOGUE SERVICE" : kinds.find(kind => kind.id === detail.kind)?.title}</p><h2 tabIndex={-1} data-step-focus>{detail.title}</h2><p className="mt-detail-description">{detail.description}</p><div className="mt-detail-facts">{detail.duration && <span><Clock3 size={17}/><div><small>Duration</small>{detail.duration}</div></span>}{detail.difficulty && <span><Mountain size={17}/><div><small>Pace</small>{detail.difficulty}</div></span>}{detail.maxGuests > 0 && <span><Users size={17}/><div><small>{detail.kind === "tour" ? "Per booking" : "Group size"}</small>Up to {detail.maxGuests}</div></span>}{detail.season && <span><Leaf size={17}/><div><small>Season</small>{detail.season}</div></span>}</div>{inclusionList(detail).length > 0 && <><h3>Included in this proposal</h3><ul className="mt-inclusions">{inclusionList(detail).map(inclusion => <li key={inclusion}><Check size={16}/>{inclusion}</li>)}</ul></>}<p className="mt-helper">Availability, the final itinerary, inclusions and cancellation terms are checked and shown in your quote before you confirm.</p><div className="mt-detail-bottom"><Price service={detail}/><button className="mt-button mt-button-dark" onClick={() => { addService(detail); setDetail(null); }}>Add to my trip <Plus size={16}/></button></div></div></Modal>}

    {info && <Modal title={info === "privacy" ? "Privacy information" : "Booking terms"} onClose={() => setInfo(null)} elevated><div className="mt-info-content"><p className="mt-eyebrow">BEFORE YOU REQUEST</p><h2 tabIndex={-1} data-step-focus>{info === "privacy" ? "Your information" : "Booking terms"}</h2><p className="mt-info-text">{info === "privacy" ? settings?.privacy || "We use your name, contact details and trip information to review and manage your request. Your private request link gives access to your request: keep it safe. Business contact details and the final retention and privacy policy must be confirmed before launch." : settings?.policy || "A request is not a confirmed reservation. Availability and a final quote must be checked, you must accept the price and terms, and any required deposit must be verified before confirmation. Service-specific cancellation, refund and deposit terms will be stated in your quote. The business’s final policies must be approved before launch."}</p></div></Modal>}

    {requestOpen && <Modal title={saved ? "Request saved" : "Plan your trip"} onClose={closeRequest} wide focusKey={saved ? "saved" : step}>
      {saved ? <div className="mt-success"><span className="mt-success-icon"><CheckCircle2 size={38} strokeWidth={1.4}/></span><p className="mt-eyebrow">YOUR REQUEST IS SAVED</p><h2 tabIndex={-1} data-step-focus>Something to<br/><em>look forward to.</em></h2><p>Your request is <strong>awaiting confirmation</strong>. The team will check your plans and send a quote using your contact details.</p><div className="mt-reference"><span>YOUR REFERENCE</span><strong>{saved.reference}</strong></div><a className="mt-button mt-button-dark" href={`/request#${saved.token}`}>View my private request <ArrowRight size={17}/></a><button type="button" className="mt-copy-link" onClick={() => void copyPrivateLink()}><Copy size={15}/>Copy my private link</button><p className="mt-helper">Keep this link safe. Anyone with it can access your request.</p><p className="mt-copy-notice" role="status">{copyNotice}</p>{settings?.whatsapp && <div className="mt-whatsapp-handoff"><a className="mt-button mt-button-outline" href={whatsappLink(settings.whatsapp, `Hello, I submitted request ${saved.reference} for ${selected.map(({ service }) => service.title).join(", ")}. Please help me with the next steps.`)} target="_blank" rel="noopener noreferrer"><MessageCircle size={17}/> Continue in WhatsApp</a><small>This opens a draft. You still need to send the message.</small></div>}<button className="mt-text-link" onClick={() => { setRequestOpen(false); setItems([]); setAcknowledged(false); }}>Keep exploring <ArrowRight size={15}/></button></div> : <div className="mt-request"><div className="mt-request-header"><p className="mt-eyebrow">YOUR MOUNTAIN PLAN</p><h2>Bring it together.</h2><p>One request. A tour, a stay, a ride — or all three.</p><ol className="mt-progress" aria-label="Request steps">{["Your plans", "Your details", "Review & request"].map((label, i) => <li key={label} className={step === i ? "current" : step > i ? "complete" : ""} aria-current={step === i ? "step" : undefined}><span>{step > i ? <Check size={13}/> : i + 1}</span>{label}</li>)}</ol></div>
        {loadError && <div className="mt-form-error" role="alert">{loadError} <button type="button" className="mt-inline-link" onClick={() => void loadCatalogue()}>Refresh dates</button></div>}
        {formError && <div className="mt-form-error" tabIndex={-1} role="alert" ref={errorRef}>{formError}</div>}
        <form onSubmit={event => { event.preventDefault(); if (step < 2) nextStep(); else void submitRequest(); }}>
          {step === 0 && <div className="mt-request-body"><div className="mt-request-subheading"><h3 tabIndex={-1} data-step-focus>Choose your dates.</h3><span>All times are local to Georgia</span></div><label className="mt-field mt-party-field">Number of guests<input type="number" required min="1" max="50" inputMode="numeric" value={form.guests} onChange={event => { setForm({ ...form, guests: event.target.value }); setFormError(""); }}/></label>{services.some(service => !items.some(item => item.serviceId === service.id)) && <details className="mt-add-services" open={selected.length === 0}><summary>{selected.length ? "Add another service" : "Choose your services"}<Plus size={16}/></summary><div className="mt-service-picker">{services.filter(service => !items.some(item => item.serviceId === service.id)).map(service => { const chosen = items.some(item => item.serviceId === service.id); const Icon = service.kind === "tour" ? Mountain : service.kind === "stay" ? House : CarFront; return <button type="button" key={service.id} aria-pressed={chosen} className={chosen ? "selected" : ""} onClick={() => addServiceAndFocus(service)}><Icon size={16}/>{service.title}{chosen ? <Check size={15}/> : <Plus size={15}/>}</button>; })}</div></details>}{!services.length && <p className="mt-helper">The catalogue is being prepared. Please try again once services are published.</p>}{selected.map(({ item, service }) => <div className="mt-trip-item" key={service.id}><div className="mt-trip-item-header"><strong id={`mt-trip-${service.id}`} tabIndex={-1}>{service.title}</strong><button type="button" className="mt-icon-button" aria-label={`Remove ${service.title}`} onClick={() => removeService(service.id)}><Trash2 size={16}/></button></div>{service.kind === "tour" && serviceDepartures(service.id).length > 0 && <label className="mt-field" style={{ marginBottom: 14 }}>Choose a tour date<select value={item.departureId || ""} onChange={event => chooseDeparture(service.id, event.target.value)}><option value="">Choose my own date</option>{serviceDepartures(service.id).map(departure => <option key={departure.id} value={departure.id} disabled={(departure.remainingSeats ?? departure.capacity - (departure.bookedSeats || 0)) < Math.max(1, Number(form.guests) || 1)}>{departureLabel(departure)}</option>)}</select></label>}{item.departureId && <div className="mt-departure-summary"><Clock3 size={17}/><span><strong>{niceDate(item.date)} at {item.time}</strong><small>{remainingLabel(departures.find(departure => departure.id === item.departureId))}</small></span></div>}<div className="mt-field-grid">{!item.departureId && <label className="mt-field">{service.kind === "stay" ? "Arrival" : item.departureId ? "Scheduled date" : "Preferred date"}<input type="date" required readOnly={!!item.departureId} min={minDate} value={item.date} onChange={event => updateItem(service.id, "date", event.target.value)}/></label>}{service.kind === "stay" && <label className="mt-field">Checkout<input type="date" required min={item.date || minDate} value={item.endDate || ""} onChange={event => updateItem(service.id, "endDate", event.target.value)}/></label>}{service.kind === "taxi" && <><label className="mt-field">Pickup time<input type="time" required value={item.time || ""} onChange={event => updateItem(service.id, "time", event.target.value)}/></label><label className="mt-field">Pickup place<input required placeholder="Address, hotel or meeting point" maxLength={200} value={item.pickup || ""} onChange={event => updateItem(service.id, "pickup", event.target.value)}/></label><label className="mt-field">Destination<input required placeholder="Where are you going?" maxLength={200} value={item.destination || ""} onChange={event => updateItem(service.id, "destination", event.target.value)}/></label><label className="mt-field mt-field-full">Luggage <span>(optional)</span><input placeholder="e.g. 2 backpacks and 1 suitcase" maxLength={200} value={item.luggage || ""} onChange={event => updateItem(service.id, "luggage", event.target.value)}/></label></>}</div>{service.kind === "tour" && <p className="mt-helper">{item.departureId ? "Places shown are currently available. Your request does not reserve them; availability is checked again at confirmation." : "Request your preferred date. The team will check availability and confirm the departure time and meeting point."}</p>}</div>)}</div>}
          {step === 1 && <div className="mt-request-body"><h3 tabIndex={-1} data-step-focus>A way to reach you.</h3><p className="mt-helper">No account needed. The team uses these details to check your plans and send your quote.</p><div className="mt-plan-summary"><Users size={16}/><span>{form.guests} {Number(form.guests) === 1 ? "guest" : "guests"} · {selected.length} {selected.length === 1 ? "service" : "services"}</span><button type="button" className="mt-inline-link" onClick={() => setStep(0)}>Edit plans</button></div><div className="mt-field-grid"><label className="mt-field mt-field-full">Your name<input required autoComplete="name" minLength={2} maxLength={100} value={form.name} onChange={event => { setForm({ ...form, name: event.target.value }); setFormError(""); }}/></label><label className="mt-field mt-field-full">Phone number or email<input required autoComplete="email" maxLength={150} placeholder="Include your country code for phone numbers" value={form.contact} onChange={event => { setForm({ ...form, contact: event.target.value }); setFormError(""); }}/></label><label className="mt-field mt-field-full">Anything we should know? <span>(optional)</span><textarea rows={3} maxLength={1500} placeholder="Your interests, accessibility needs, or any special requirements" value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })}/></label></div><label className="mt-honeypot" aria-hidden="true">Leave this empty<input name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={event => setForm({ ...form, website: event.target.value })}/></label><p className="mt-helper"><ShieldCheck size={14}/> We use your details to manage this request. <button type="button" className="mt-inline-link" onClick={() => setInfo("privacy")}>Privacy information</button></p></div>}
          {step === 2 && <div className="mt-request-body"><h3 tabIndex={-1} data-step-focus>Review your request.</h3><p className="mt-helper">Review your plans. We’ll check availability and send the prices and terms before you decide.</p><div className="mt-review-list">{selected.map(({ item, service }) => <div key={service.id}><span className="mt-review-icon">{service.kind === "tour" ? <Mountain size={20}/> : service.kind === "stay" ? <House size={20}/> : <CarFront size={20}/>}</span><div><strong>{service.title}</strong><p>{niceDate(item.date)}{item.endDate ? ` → ${niceDate(item.endDate)}` : ""}{item.time ? ` at ${item.time}` : ""}</p>{service.kind === "taxi" && <p>{item.pickup} → {item.destination}{item.luggage ? ` · ${item.luggage}` : ""}</p>}</div><Price service={service}/></div>)}</div><div className="mt-review-contact"><Users size={17}/><span>{form.guests} {Number(form.guests) === 1 ? "guest" : "guests"} · {form.name}<small>{form.contact}</small></span><button type="button" className="mt-inline-link" onClick={() => setStep(1)}>Edit details</button></div>{form.notes && <p className="mt-review-notes">{form.notes}</p>}<label className="mt-acknowledge"><input type="checkbox" checked={acknowledged} onChange={event => { setAcknowledged(event.target.checked); setFormError(""); }}/><span>I understand this is a request, and my trip is awaiting confirmation. The final price and terms will be sent in a quote.</span></label><p className="mt-helper">By requesting, you allow the team to contact you about your plans. <button type="button" className="mt-inline-link" onClick={() => setInfo("policy")}>How confirmation works</button></p></div>}
          <div className="mt-request-actions">{step > 0 ? <button className="mt-button mt-button-outline" type="button" onClick={() => { setStep(step - 1); setFormError(""); }} disabled={sending}><ChevronLeft size={16}/> Back</button> : <span className="mt-request-safe"><ShieldCheck size={15}/> No payment at this step</span>}<button className="mt-button mt-button-dark" type="submit" disabled={sending || (step === 0 && selected.length === 0)}>{sending ? <><LoaderCircle size={17} className="mt-spin"/>Saving request…</> : step === 2 ? <>Send my request <ArrowRight size={16}/></> : <>Continue <ArrowRight size={16}/></>}</button></div>
        </form>
      </div>}
    </Modal>}
  </div>;
}
