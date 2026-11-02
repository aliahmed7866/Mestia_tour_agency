'use client';
import {useEffect, useRef, useState} from 'react';
import {ArrowLeft, LockKeyhole, Mountain, RefreshCw} from 'lucide-react';
import AdminApp from './AdminApp';
import {ownerRequest, readOwnerStatus, type OwnerAuthStatus} from '../lib/owner-client';
import '../owner.css';

type Step = 'loading' | 'access' | 'setup' | 'password' | 'code' | 'ready' | 'unavailable' | 'error';
export default function OwnerGate() {
  const [step, setStep] = useState<Step>('loading');
  const [status, setStatus] = useState<OwnerAuthStatus | null>(null);
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState(''), [code, setCode] = useState('');
  const [challenge, setChallenge] = useState(''), [error, setError] = useState('');
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  async function check(signal?: AbortSignal) {
    setStep('loading'); setError('');
    try {
      const result = await readOwnerStatus(signal);
      if (signal?.aborted) return;
      setStatus(result);
      setStep(result.mode === 'sites' || result.authenticated ? 'ready' : result.mode === 'access' ? 'access' : result.configured ? 'password' : 'unavailable');
    } catch (cause) {
      if (signal?.aborted) return;
      setError(cause instanceof Error ? cause.message : 'Check your connection and try again.'); setStep('error');
    }
  }
  useEffect(() => {const controller = new AbortController(); void check(controller.signal); return () => controller.abort();}, []);
  useEffect(() => {if (step !== 'loading' && step !== 'ready') heading.current?.focus();}, [step]);
  async function submit(action: 'setup' | 'start' | 'verify') {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(''); setNotice('');
    try {
      if (action === 'setup' && password !== confirm) throw new Error('Passwords do not match.');
      const data = await ownerRequest(action === 'setup' ? {action, password} : action === 'start' ? {action, email, password} : {action, challenge, code});
      if (action === 'start' && status?.mode !== 'password') {
        if (typeof data.challenge !== 'string' || !/^[a-f0-9]{48}$/.test(data.challenge)) throw new Error('The sign-in code could not be requested. Please try again.');
        setChallenge(data.challenge); setPassword(''); setCode(''); setStep('code');
      } else {
        if (data.ok !== true) throw new Error('The sign-in result could not be checked. Please try again.');
        setPassword(''); setConfirm(''); setCode(''); setChallenge('');
        if (action === 'setup') {setNotice('Owner password saved. Your existing access remains active until the login rollout is completed.'); setStatus(previous => previous ? {...previous, canSetup: false} : previous);}
        setStep('ready');
      }
    } catch (cause) {setError(cause instanceof Error ? cause.message : 'Something went wrong. Please try again.');}
    finally {inFlight.current = false; setBusy(false);}
  }
  async function signOut() {
    if (status?.mode === 'access') { window.location.assign('/cdn-cgi/access/logout'); return; }
    const data = await ownerRequest({action: 'logout'});
    if (data.ok !== true) throw new Error('Sign-out could not be confirmed. Please try again.');
    setPassword(''); setConfirm(''); setCode(''); setChallenge(''); setError(''); setNotice('You have signed out.'); setStep('password');
  }
  if (step === 'ready') return <>{notice && <p className="owner-notice" role="status">{notice}</p>}<AdminApp onSignOut={status?.mode !== 'sites' ? signOut : undefined} onSetupPassword={status?.canSetup ? () => {setError(''); setNotice(''); setStep('setup');} : undefined}/></>;
  const title = step === 'setup' ? 'Set your owner password' : step === 'code' ? 'Check your email' : 'Welcome back';
  return <main className="owner-page"><section className="owner-card" aria-busy={busy || step === 'loading'}>
    <a className="owner-brand" href="/"><Mountain size={30} aria-hidden="true"/> Svaneti Guide</a>
    <p className="owner-eyebrow"><LockKeyhole size={14} aria-hidden="true"/> Private owner workspace</p>
    <h1 ref={heading} tabIndex={-1}>{title}</h1>
    {notice && <p role="status">{notice}</p>}
    {error && <p className="owner-error" role="alert">{error}</p>}
    {step === 'access' ? <><p>Password sign-in has not been activated. This deployment still requires a verified Cloudflare Access session.</p><p>If you have already saved your owner password, set <code>OWNER_LOGIN_MODE</code> to <code>password</code> in the Worker's runtime settings and deploy. If you have not set a password yet, keep the existing protection enabled and finish owner setup first.</p><button type="button" className="owner-primary" onClick={() => void check()}>Check sign-in setup</button><p>Only the authorised owner can complete setup. There is no public registration.</p></> : step === 'loading' ? <p role="status">Checking your session…</p> : step === 'error' ? <button className="owner-primary" onClick={() => void check()}><RefreshCw size={16}/> Try again</button> : step === 'unavailable' ? <p>Owner sign-in setup is incomplete. Contact the site administrator to finish the login rollout.</p> : <form onSubmit={event => {event.preventDefault(); void submit(step === 'setup' ? 'setup' : step === 'code' ? 'verify' : 'start');}}>
      {step === 'setup' && <p>Your existing owner access stays active. Choose a unique password of 14–128 characters.</p>}
      {step === 'password' && <label>Owner email<input type="email" required autoComplete="username" value={email} disabled={busy} onChange={event => setEmail(event.target.value)}/></label>}
      {step === 'code' && <><p>Enter the six-digit code sent to your owner email. It expires in five minutes.</p><label>Verification code<input className="owner-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} disabled={busy} onChange={event => setCode(event.target.value.replace(/\D/g, ''))}/></label></>}
      {(step === 'password' || step === 'setup') && <label>{step === 'setup' ? 'Create password' : 'Password'}<input type="password" required minLength={step === 'setup' ? 14 : 1} maxLength={128} autoComplete={step === 'setup' ? 'new-password' : 'current-password'} value={password} disabled={busy} onChange={event => setPassword(event.target.value)}/></label>}
      {step === 'setup' && <label>Confirm password<input type="password" required minLength={14} maxLength={128} autoComplete="new-password" value={confirm} disabled={busy} onChange={event => setConfirm(event.target.value)}/></label>}
      <button disabled={busy} type="submit" className="owner-primary">{busy ? 'Please wait…' : step === 'setup' ? 'Save owner password' : step === 'code' ? 'Verify and sign in' : 'Sign in'}</button>
      {step === 'code' && <button disabled={busy} type="button" className="owner-link" onClick={() => {setStep('password'); setChallenge(''); setCode(''); setError('');}}>Use another email or request a new code</button>}
      {step === 'setup' && <button disabled={busy} type="button" className="owner-link" onClick={() => {setPassword(''); setConfirm(''); setError(''); setStep('ready');}}>Back to workspace</button>}
    </form>}
    <footer><span>Never share passwords or verification codes.</span><a href="/"><ArrowLeft size={14}/> Back to the website</a></footer>
  </section></main>;
}
