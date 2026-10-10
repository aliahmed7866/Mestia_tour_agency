'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, CarFront, Check, CheckCircle2, Clock3, Copy, LoaderCircle, MapPin, MessageCircle, Mountain, RefreshCw, ShieldCheck } from 'lucide-react';
import type { Dispatch, Settings, TravelRequest } from '../lib/types';
import '../status.css';

type GuestRequest = Pick<TravelRequest, 'reference' | 'tokenExpiresAt' | 'name' | 'guests' | 'items' | 'serviceSnapshots' | 'status' | 'quote'> & {
  payment: { paid: number };
  dispatch: Pick<Dispatch, 'status'>;
};
type GuestData = { request: GuestRequest; settings: Settings };
type Mutation = { action: 'accept'; quoteId: string; acceptTerms: boolean } | { action: 'requestChange'; message: string };
type ApiPayload = { action: 'view' } | Mutation;
type SavedAction = { action: Mutation['action']; quoteFingerprint?: string };

class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const currency = (value: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GEL' }).format(value);
const dateTime = (value: string) => Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tbilisi', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
  : 'Time to be agreed';
const dateOnly = (value: string) => Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tbilisi', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value.length === 10 ? `${value}T12:00:00+04:00` : value))
  : 'Date to be agreed';
const kindLabel = { tour: 'Tour', stay: 'Guesthouse', taxi: 'Taxi' };

async function postRequest(token: string, payload: ApiPayload, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch('/api/request', {
    method: 'POST', cache: 'no-store', signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, ...payload }),
  });
  let result: unknown;
  try { result = await response.json(); }
  catch { throw new Error('The server response could not be read.'); }
  if (!response.ok) throw new ApiError(isRecord(result) && typeof result.error === 'string' ? result.error : 'Please try again.', response.status);
  return result;
}

async function viewRequest(token: string, signal: AbortSignal): Promise<GuestData> {
  const result = await postRequest(token, { action: 'view' }, signal);
  if (!isRecord(result) || !isRecord(result.request) || !isRecord(result.settings)
    || typeof result.request.reference !== 'string' || !Array.isArray(result.request.items)
    || !Array.isArray(result.request.serviceSnapshots) || !isRecord(result.request.payment)
    || typeof result.request.payment.paid !== 'number' || !isRecord(result.request.dispatch)
    || !['enquiry', 'confirmed', 'cancelled', 'completed'].includes(String(result.request.status))) {
    throw new Error('Your trip details could not be read.');
  }
  return result as GuestData;
}

export default function RequestStatus() {
  const [token, setToken] = useState('');
  const [data, setData] = useState<GuestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutation, setMutation] = useState<Mutation['action'] | null>(null);
  const [error, setError] = useState('');
  const [savedAction, setSavedAction] = useState<SavedAction | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [acceptedFor, setAcceptedFor] = useState<string | null>(null);
  const [savedAcceptanceFor, setSavedAcceptanceFor] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'copying'>('idle');
  const [clock, setClock] = useState(0);
  const [loadedAt, setLoadedAt] = useState('');
  const tokenRef = useRef('');
  const loadSequence = useRef(0);
  const viewController = useRef<AbortController | null>(null);
  const actionController = useRef<AbortController | null>(null);
  const actionInFlight = useRef(false);
  const mounted = useRef(true);
  const errorRef = useRef<HTMLDivElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);

  const refreshRequest = useCallback(async (privateToken: string, clearExisting = false): Promise<boolean> => {
    const sequence = ++loadSequence.current;
    viewController.current?.abort();
    const controller = new AbortController();
    viewController.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    setLoading(true);
    setError('');
    if (clearExisting) setData(null);
    try {
      const next = await viewRequest(privateToken, controller.signal);
      if (!mounted.current || sequence !== loadSequence.current || privateToken !== tokenRef.current) return false;
      setData(next);
      setClock(Date.now());
      setLoadedAt(new Date().toISOString());
      setNeedsRefresh(false);
      return true;
    } catch (cause) {
      if (!mounted.current || sequence !== loadSequence.current || privateToken !== tokenRef.current) return false;
      setError(cause instanceof ApiError ? cause.message : 'We couldn’t load your latest trip details. Check your connection and try again.');
      return false;
    } finally {
      window.clearTimeout(timeout);
      if (mounted.current && sequence === loadSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    function openLink() {
      const privateToken = window.location.hash.slice(1).trim();
      tokenRef.current = privateToken;
      setToken(privateToken);
      setSavedAction(null);
      setAcceptedFor(null);
      setSavedAcceptanceFor(null);
      setCopyStatus('idle');
      setMessage('');
      setNeedsRefresh(false);
      if (!privateToken) {
        ++loadSequence.current;
        viewController.current?.abort();
        setData(null);
        setLoading(false);
        setError('Open the private link provided after you saved your request. If it has expired, ask the operator for a new link.');
        return;
      }
      void refreshRequest(privateToken, true);
    }
    openLink();
    window.addEventListener('hashchange', openLink);
    function closeLink() { mounted.current = false; viewController.current?.abort(); actionController.current?.abort(); window.removeEventListener('hashchange', openLink); }
    return closeLink;
  }, [refreshRequest]);

  useEffect(() => {
    const updateClock = () => setClock(Date.now());
    const interval = window.setInterval(updateClock, 1000);
    window.addEventListener('focus', updateClock);
    document.addEventListener('visibilitychange', updateClock);
    return () => { window.clearInterval(interval); window.removeEventListener('focus', updateClock); document.removeEventListener('visibilitychange', updateClock); };
  }, []);

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => { if (savedAction) noticeRef.current?.focus(); }, [savedAction]);

  const request = data?.request;
  const quote = request?.quote;
  // Consent belongs to this exact price, schedule and terms. A revised quote starts unchecked.
  const quoteFingerprint = quote ? JSON.stringify({ id: quote.id, items: quote.items, expiresAt: quote.expiresAt, depositRequired: quote.depositRequired, terms: quote.terms, policyVersion: quote.policyVersion, total: quote.total, discount: quote.discount }) : '';
  const quoteAccepted = Boolean(quote?.acceptedAt || savedAcceptanceFor === quoteFingerprint);
  const quoteLive = Boolean(quote && Date.parse(quote.expiresAt) > clock);
  const scheduleFuture = Boolean(quote && quote.items.every(item => Date.parse(item.start) > clock));
  const quoteReady = quoteLive && scheduleFuture;
  const canAccept = request?.status === 'enquiry' && Boolean(quote) && !quoteAccepted && quoteReady;
  const visibleSavedAction = savedAction?.action === 'accept' && savedAction.quoteFingerprint !== quoteFingerprint ? null : savedAction;
  const closed = request?.status === 'cancelled' || request?.status === 'completed';
  const hasTaxi = Boolean(request?.serviceSnapshots.some(service => service.kind === 'taxi'));
  const taxiNeedsAttention = request?.status === 'confirmed' && hasTaxi && request.dispatch.status !== 'accepted';
  const blocked = loading || Boolean(mutation) || needsRefresh;

  async function saveAction(payload: Mutation) {
    if (actionInFlight.current || blocked || !token) return;
    const privateToken = token;
    const fingerprint = quoteFingerprint;
    actionInFlight.current = true;
    setMutation(payload.action);
    setError('');
    setSavedAction(null);
    const controller = new AbortController();
    actionController.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    let acknowledged = false;
    try {
      const result = await postRequest(privateToken, payload, controller.signal);
      if (!isRecord(result) || result.ok !== true) throw new Error('The save result could not be checked.');
      acknowledged = true;
      if (!mounted.current || privateToken !== tokenRef.current) return;
      setSavedAction({ action: payload.action, ...(payload.action === 'accept' ? { quoteFingerprint: fingerprint } : {}) });
      if (payload.action === 'accept') { setAcceptedFor(null); setSavedAcceptanceFor(fingerprint); }
      else setMessage('');
      const refreshed = await refreshRequest(privateToken);
      if (!refreshed && mounted.current && privateToken === tokenRef.current) {
        setError(payload.action === 'accept'
          ? 'Your quote acceptance was saved, but your latest trip details could not be loaded. Refresh to see the latest status.'
          : 'Your change request was saved, but your latest trip details could not be loaded. Refresh to see the latest status.');
      }
    } catch (cause) {
      if (!mounted.current || privateToken !== tokenRef.current) return;
      if (cause instanceof ApiError) setError(cause.message);
      else if (!acknowledged) {
        setNeedsRefresh(true);
        setError('We couldn’t check whether your action was saved. Refresh your trip before trying again. If you sent a change request, check with the operator before sending it again.');
      }
    } finally {
      window.clearTimeout(timeout);
      actionInFlight.current = false;
      if (mounted.current) setMutation(null);
    }
  }

  async function copyLink() {
    setCopyStatus('copying');
    try { await navigator.clipboard.writeText(window.location.href); setCopyStatus('copied'); }
    catch { setCopyStatus('idle'); setError('The link could not be copied. Copy the full address from your browser and keep it private.'); }
  }

  let headline = 'Your private trip details.';
  let nextTitle = 'We’re checking your request.';
  let nextText = 'The operator checks your dates and sends a written quote with prices, a schedule and terms. Your request is not yet a confirmed booking.';
  if (request?.status === 'confirmed') {
    headline = 'Your booking is confirmed.';
    nextTitle = taxiNeedsAttention ? 'Your taxi needs an update.' : 'You’re ready to look forward to your trip.';
    nextText = taxiNeedsAttention
      ? 'The operator is arranging transport and must reconfirm your taxi. Your other confirmed services are retained. Contact the operator before relying on the taxi arrangement.'
      : 'Your agreed schedule is below. Contact the operator if you need arrival details or want to request a change.';
  } else if (request?.status === 'cancelled') {
    headline = 'Your request has been cancelled.';
    nextTitle = 'This request is closed.';
    nextText = 'Keep this page as a record. If a payment was made, discuss any refund with the operator according to your accepted terms.';
  } else if (request?.status === 'completed') {
    headline = 'Thank you for travelling with us.';
    nextTitle = 'Your trip is marked complete.';
    nextText = 'Your itinerary and quote remain here for your records. You can contact the operator if you have a question.';
  } else if (quote && !quoteReady) {
    headline = 'Let’s update your quote.';
    nextTitle = 'Ask the operator for a fresh quote.';
    nextText = !quoteLive
      ? 'This quote has expired and the booking is not confirmed. Review and accept the revised quote before the operator can complete confirmation.'
      : 'One of the quoted services has already started. The booking is not confirmed. Ask for an updated future schedule, then review and accept the revised quote.';
  } else if (quoteAccepted) {
    headline = 'Your quote is accepted.';
    nextTitle = 'Next: the operator’s final checks.';
    nextText = 'Your booking is not confirmed yet. The operator still needs to check availability, verify your contact and any required deposit, and complete taxi arrangements when included.';
  } else if (quote) {
    headline = 'Your quote is ready.';
    nextTitle = 'Review your schedule, price and terms.';
    nextText = 'If everything looks right, accept your written quote below. The operator then completes the remaining checks before confirming your booking.';
  } else if (request) headline = 'Your request is with the team.';

  const businessName = data?.settings.businessName || 'Mestia Travel';
  const statusLabel = request?.status === 'enquiry' ? 'Not yet confirmed' : request?.status === 'confirmed' ? 'Confirmed' : request?.status === 'cancelled' ? 'Cancelled' : 'Completed';

  return <div className="status-page">
    <a className="skip-link" href="#main" onClick={event => { event.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to your trip</a>
    <header className="status-head">
      <Link href="/" className="status-brand"><Mountain size={25} aria-hidden="true" />{businessName}</Link>
      <Link href="/" className="status-back"><ArrowLeft size={16} aria-hidden="true" /><span>Back to the site</span></Link>
    </header>
    <main className="status-main" id="main" tabIndex={-1}>
      <div className="status-intro"><p className="status-eyebrow">YOUR MESTIA PLANS</p><h1>{headline}</h1><p>Your itinerary, quote and next step. All in one place.</p></div>

      {error && <div ref={errorRef} tabIndex={-1} role="alert" className="status-error">
        <strong>Something needs attention</strong><p>{error}</p>
        {token && <button type="button" className="status-secondary status-inline-button" disabled={loading || Boolean(mutation)} onClick={() => void refreshRequest(token)}><RefreshCw size={16} aria-hidden="true" />{loading ? 'Refreshing…' : request ? 'Refresh my trip' : 'Try again'}</button>}
      </div>}
      {visibleSavedAction && <div ref={noticeRef} tabIndex={-1} role="status" className="status-notice"><CheckCircle2 size={20} aria-hidden="true" /><p>{visibleSavedAction.action === 'accept' ? 'Your quote acceptance is saved. The operator will complete the remaining checks before confirmation.' : 'Your change request is saved for the operator. Your booking keeps its current status until the operator reviews it.'}</p></div>}
      {!request && loading && <div className="status-loading" role="status"><LoaderCircle size={22} className="status-spinner" aria-hidden="true" /><p>Opening your private trip…</p></div>}

      {request && data && <>
        <section className="status-overview" aria-label="Request overview">
          <div><p className="status-eyebrow">REQUEST REFERENCE</p><h2>{request.reference}</h2><p>{request.name} · {request.guests} {request.guests === 1 ? 'guest' : 'guests'}</p></div>
          <div className="status-overview-actions"><span className={`status-pill status-pill-${request.status}`}>{request.status === 'confirmed' || request.status === 'completed' ? <CheckCircle2 size={17} aria-hidden="true" /> : <Clock3 size={17} aria-hidden="true" />}{statusLabel}</span><button type="button" className="status-refresh" disabled={loading || Boolean(mutation)} onClick={() => void refreshRequest(token)}><RefreshCw size={15} className={loading ? 'status-spinner' : ''} aria-hidden="true" />{loading ? 'Refreshing…' : 'Refresh status'}</button></div>
        </section>
        <section className={`status-next ${taxiNeedsAttention || (quote && !quoteReady && request.status === 'enquiry') ? 'status-next-attention' : ''}`} aria-labelledby="next-title">
          <div className="status-next-icon">{taxiNeedsAttention ? <CarFront size={24} aria-hidden="true" /> : request.status === 'confirmed' || request.status === 'completed' ? <CheckCircle2 size={24} aria-hidden="true" /> : <Clock3 size={24} aria-hidden="true" />}</div><div><h2 id="next-title">{nextTitle}</h2><p>{nextText}</p></div>
        </section>
        {!closed && <ol className="status-progress" aria-label="Booking progress">
          <li className="is-done"><span><Check size={15} aria-hidden="true" /></span>Request saved</li><li className={quote ? 'is-done' : ''}><span>{quote ? <Check size={15} aria-hidden="true" /> : '2'}</span>{quote && !quoteReady && request.status === 'enquiry' ? 'Quote needs update' : quoteAccepted ? 'Quote accepted' : quote ? 'Quote ready' : 'Written quote'}</li><li className={request.status === 'confirmed' ? 'is-done' : ''}><span>{request.status === 'confirmed' ? <Check size={15} aria-hidden="true" /> : '3'}</span>Booking confirmed</li>
        </ol>}

        <div className="status-columns">
          <section className="status-card" aria-labelledby="itinerary-title">
            <div className="status-card-heading"><p className="status-eyebrow">{quote ? 'YOUR WRITTEN SCHEDULE' : 'YOUR REQUEST'}</p><h2 id="itinerary-title">Your itinerary</h2></div>
            {request.items.map(item => {
              const service = request.serviceSnapshots.find(service => service.id === item.serviceId);
              const quotedItem = quote?.items.find(quotedItem => quotedItem.serviceId === item.serviceId);
              return <article className="status-trip" key={item.serviceId}>
                <p className="status-eyebrow">{service ? kindLabel[service.kind] : 'Service'}</p><h3>{quotedItem?.title || service?.title || 'Selected service'}</h3>
                {quotedItem ? <p className="status-schedule"><time dateTime={quotedItem.start}>{dateTime(quotedItem.start)}</time><ArrowRight size={14} aria-label="until" /><time dateTime={quotedItem.end}>{dateTime(quotedItem.end)}</time></p> : <p className="status-schedule"><time dateTime={item.date}>{dateOnly(item.date)}</time>{item.endDate && <><ArrowRight size={14} aria-label="until" /><time dateTime={item.endDate}>{dateOnly(item.endDate)}</time></>}{item.time && <span>{service?.kind === 'taxi' ? 'Pickup' : 'Starts'} at {item.time}</span>}</p>}
                {(item.pickup || item.destination) && <p className="status-route"><MapPin size={16} aria-hidden="true" /><span>{item.pickup} → {item.destination}</span></p>}
                {item.luggage && <p className="status-small status-luggage">Luggage: {item.luggage}</p>}
              </article>;
            })}
            <p className="status-small">All dates and times are local to Mestia (Asia/Tbilisi). {quote ? 'The written schedule above is part of your quote.' : 'These are requested dates. The operator will agree the schedule in your quote.'}</p>
            {quote && <details className="status-original"><summary>See your original requested dates</summary>{request.items.map(item => <p key={item.serviceId}><strong>{request.serviceSnapshots.find(service => service.id === item.serviceId)?.title || 'Selected service'}</strong><span>{dateOnly(item.date)}{item.endDate ? ` → ${dateOnly(item.endDate)}` : ''}{item.time ? ` · ${item.time}` : ''}</span></p>)}</details>}
            {hasTaxi && !closed && <div className={`status-dispatch ${request.dispatch.status === 'unavailable' || taxiNeedsAttention ? 'status-dispatch-attention' : ''}`}><CarFront size={20} aria-hidden="true" /><div><strong>Taxi arrangement</strong><p>{request.dispatch.status === 'accepted' ? 'A suitable driver has accepted the trip.' : request.dispatch.status === 'unavailable' ? 'No driver is available at present. The operator will discuss alternatives.' : request.dispatch.status === 'offered' ? 'A driver has been asked. Their acceptance is still needed.' : 'The operator is arranging a driver.'}{request.status === 'enquiry' ? ' Your taxi is confirmed only after the fare is accepted, the driver accepts and the operator confirms.' : ''}</p></div></div>}
          </section>

          <section className="status-card status-quote-card" aria-labelledby="quote-title">
            <div className="status-card-heading"><p className="status-eyebrow">{quote || closed ? 'PRICE & TERMS' : 'A SIMPLE NEXT STEP'}</p><h2 id="quote-title">{quote ? 'Your written quote' : closed ? 'Quote record' : 'What happens next'}</h2></div>
            {quote ? <>
              <p className={`status-quote-state ${!quoteReady && request.status === 'enquiry' ? 'is-expired' : ''}`}>{quote.acceptedAt ? `Accepted ${dateTime(quote.acceptedAt)}` : quoteAccepted ? 'Your acceptance is saved' : !quoteLive ? 'This quote has expired' : !scheduleFuture ? 'This schedule needs an update' : `Review by ${dateTime(quote.expiresAt)} · Mestia time`}{!quoteReady && request.status === 'enquiry' && <span>{!scheduleFuture && quoteLive ? 'A quoted service has already started. Ask for a future schedule.' : 'The operator needs to issue a revised quote before confirmation.'}</span>}</p>
              <dl className="status-prices">{quote.items.map(item => <div className="status-quote-row" key={item.serviceId}><dt>{item.title}</dt><dd>{currency(item.amount)}</dd></div>)}{quote.discount > 0 && <div className="status-money"><dt>Stay + tour saving</dt><dd>−{currency(quote.discount)}</dd></div>}<div className="status-money total"><dt>{quoteAccepted ? 'Agreed total' : 'Quote total'}</dt><dd>{currency(quote.total)}</dd></div><div className="status-money"><dt>Verified paid</dt><dd>{currency(request.payment.paid)}</dd></div><div className="status-money"><dt>{request.status === 'cancelled' ? 'Unpaid quote amount' : 'Remaining balance'}</dt><dd>{currency(Math.max(0, quote.total - request.payment.paid))}</dd></div></dl>
              <div className="status-deposit"><ShieldCheck size={18} aria-hidden="true" /><p>{request.status === 'cancelled' ? <>Original quote deposit: <strong>{currency(quote.depositRequired)}</strong>. Discuss any refund or cancellation amount with the operator according to your accepted terms.</> : quote.depositRequired > 0 ? <>Required deposit: <strong>{currency(quote.depositRequired)}</strong>. {request.payment.paid >= quote.depositRequired ? 'The required amount is recorded as paid.' : 'Agree payment instructions with the operator. Verified funds will appear here.'}</> : 'This quote does not require a deposit.'}</p></div>
              <details className="status-terms" open><summary>Inclusions, cancellation & terms</summary><p>{quote.terms}</p><span className="status-small">Policy: {quote.policyVersion} · Quote {quote.id.slice(0, 8)}</span></details>
              {canAccept && <form className="status-accept-form" onSubmit={event => { event.preventDefault(); void saveAction({ action: 'accept', quoteId: quote.id, acceptTerms: acceptedFor === quoteFingerprint }); }}><label className="status-check"><input type="checkbox" checked={acceptedFor === quoteFingerprint} onChange={event => setAcceptedFor(event.target.checked ? quoteFingerprint : null)} required disabled={blocked} /><span>I accept this quote, its schedule and the written terms above.</span></label><button className="status-primary" disabled={blocked || acceptedFor !== quoteFingerprint}>{mutation === 'accept' ? <LoaderCircle size={18} className="status-spinner" aria-hidden="true" /> : <CheckCircle2 size={18} aria-hidden="true" />}{mutation === 'accept' ? 'Saving acceptance…' : 'Accept this quote'}</button><p className="status-small">Acceptance is a step toward confirmation. Your booking is confirmed only when the operator completes the checks and the status says “Confirmed”.</p></form>}
              {quoteAccepted && request.status === 'enquiry' && <p className="status-accepted"><CheckCircle2 size={19} aria-hidden="true" /><span>Quote accepted. {quoteReady ? 'Waiting for the operator’s final checks and confirmation.' : 'Ask for a revised quote before confirmation.'}</span></p>}
              {!quoteReady && !quoteAccepted && request.status === 'enquiry' && <p className="status-small">Use the change request below or contact the operator to ask for a new quote.</p>}
            </> : closed ? <p className="status-small">No written quote was issued for this request.</p> : <ol className="status-steps"><li><strong>The team checks your request.</strong><span>Your dates and requirements are reviewed.</span></li><li><strong>You review a written quote.</strong><span>It includes the schedule, price and terms.</span></li><li><strong>The operator confirms your trip.</strong><span>After your acceptance, contact checks, availability and any required deposit are verified.</span></li></ol>}
          </section>
        </div>

        <div className={`status-support ${closed ? 'status-support-closed' : ''}`}>
          {!closed && <section className="status-card" aria-labelledby="change-title"><p className="status-eyebrow">WE’RE HERE TO HELP</p><h2 id="change-title">Plans changed?</h2><p className="status-support-copy">Ask for a change, cancellation or an updated quote. The operator will review your request against any agreed terms.</p><form onSubmit={event => { event.preventDefault(); void saveAction({ action: 'requestChange', message: message.trim() }); }}><label htmlFor="trip-change">What would you like to change?</label><textarea id="trip-change" rows={3} minLength={5} maxLength={1500} required value={message} onChange={event => setMessage(event.target.value)} disabled={blocked} placeholder="Tell us what you need, including any new dates." aria-describedby="change-note" /><button className="status-primary" disabled={blocked || message.trim().length < 5}>{mutation === 'requestChange' ? <LoaderCircle size={18} className="status-spinner" aria-hidden="true" /> : <MessageCircle size={18} aria-hidden="true" />}{mutation === 'requestChange' ? 'Sending request…' : 'Send change request'}</button><p className="status-small" id="change-note">Sending a request does not change or cancel the booking immediately. The operator needs to review it.</p></form></section>}
          <section className="status-card status-private" aria-labelledby="private-title"><ShieldCheck size={26} aria-hidden="true" /><h2 id="private-title">Keep your link handy.</h2><p>Save this private link to check your trip. Anyone with it can view your details and accept a quote.</p><button type="button" className="status-secondary" onClick={() => void copyLink()} disabled={copyStatus === 'copying'}>{copyStatus === 'copied' ? <Check size={17} aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />}{copyStatus === 'copied' ? 'Private link copied' : copyStatus === 'copying' ? 'Copying…' : 'Copy my private link'}</button><p className="status-copy-feedback" role="status">{copyStatus === 'copied' ? 'Keep it private when you save or share it.' : ''}</p>{data.settings.whatsapp && <><a className="status-secondary" target="_blank" rel="noreferrer" href={`https://wa.me/${data.settings.whatsapp}?text=${encodeURIComponent(`Hello, about my Mestia request ${request.reference}.`)}`}><MessageCircle size={18} aria-hidden="true" />Open WhatsApp</a><p className="status-small">This opens a draft. Tap Send in WhatsApp to send it to the operator.</p></>}<p className="status-small status-link-expiry">Link valid until {dateOnly(request.tokenExpiresAt)} unless renewed by the operator.</p></section>
        </div>
        {loadedAt && <p className="status-updated">Last checked {dateTime(loadedAt)} · Mestia time. Refresh to see updates from the operator.</p>}
      </>}
    </main>
    <footer className="status-footer">{businessName} · Booking by request</footer>
  </div>;
}
