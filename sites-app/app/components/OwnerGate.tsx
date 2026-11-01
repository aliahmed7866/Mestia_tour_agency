'use client';
import {useEffect,useState} from 'react';
import AdminApp from './AdminApp';
type Step='loading'|'setup'|'password'|'code'|'ready';
export default function OwnerGate(){
 const [step,setStep]=useState<Step>('loading'),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[code,setCode]=useState(''),[challenge,setChallenge]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{Promise.all([fetch('/api/admin',{credentials:'same-origin',cache:'no-store'}),fetch('/api/owner-auth',{cache:'no-store'})]).then(async ([admin,config])=>{if(admin.ok){setStep('ready');return;}const c=await config.json() as {configured?:boolean};setStep(c.configured?'password':'setup');}).catch(()=>setStep('password'));},[]);
 async function submit(action:string){setBusy(true);setError('');try{
  if(action==='setup'&&password!==confirm)throw new Error('Passwords do not match.');
  const response=await fetch('/api/owner-auth',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({action,email,password,challenge,code})});
  const data=await response.json() as {error?:string;challenge?:string};
  if(!response.ok)throw new Error(data.error||'Sign-in failed.');
  if(action==='setup'){setPassword('');setConfirm('');setStep('password');}
  if(action==='start'){setChallenge(data.challenge||'');setPassword('');setStep('code');}
  if(action==='verify'){setCode('');setStep('ready');}
 }catch(e){setError(e instanceof Error?e.message:'Something went wrong.');}finally{setBusy(false);}}
 if(step==='ready')return <AdminApp/>;
 return <main style={{minHeight:'100vh',display:'grid',placeItems:'center',padding:20,background:'#f5f1e8',color:'#233b30'}}><section style={{width:'100%',maxWidth:430,background:'#fff',padding:32,borderRadius:18,boxShadow:'0 10px 32px #1e342515'}}>
 <div style={{fontSize:28,fontWeight:700,marginBottom:8}}>Svaneti Guide</div><p style={{marginBottom:24}}>Private owner workspace</p>
 {step==='loading'?<p>Checking your session…</p>:<form onSubmit={e=>{e.preventDefault();void submit(step==='setup'?'setup':step==='code'?'verify':'start');}} style={{display:'grid',gap:14}}>
 {step==='setup'&&<p>Initial password setup requires your existing Cloudflare Access owner session. This one-time step must be completed before switching access.</p>}
 {step==='password'&&<><label htmlFor="owner-email">Owner email</label><input id="owner-email" type="email" required autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} style={{padding:12,border:'1px solid #b4c0b7',borderRadius:8}}/></>}
 {step==='code'&&<><p>Enter the six-digit code emailed to the owner. It expires in five minutes.</p><label htmlFor="owner-code">Verification code</label><input id="owner-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))} style={{padding:12,border:'1px solid #b4c0b7',borderRadius:8}}/></>}
 {(step==='password'||step==='setup')&&<><label htmlFor="owner-password">{step==='setup'?'Create owner password':'Password'}</label><input id="owner-password" type="password" required minLength={step==='setup'?14:1} maxLength={128} autoComplete={step==='setup'?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)} style={{padding:12,border:'1px solid #b4c0b7',borderRadius:8}}/></>}
 {step==='setup'&&<><p style={{fontSize:13}}>Use a unique password of at least 14 characters. Never reuse your email password.</p><label htmlFor="owner-confirm">Confirm password</label><input id="owner-confirm" type="password" required minLength={14} maxLength={128} autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} style={{padding:12,border:'1px solid #b4c0b7',borderRadius:8}}/></>}
 {error&&<p role="alert" style={{color:'#a32121'}}>{error}</p>}
 <button disabled={busy} type="submit" style={{padding:14,background:'#244d39',color:'white',border:0,borderRadius:9,cursor:'pointer'}}>{busy?'Please wait…':step==='setup'?'Set owner password':step==='code'?'Verify and sign in':'Continue securely'}</button>
 {step==='code'&&<button type="button" onClick={()=>{setStep('password');setChallenge('');setCode('');}} style={{background:'none',border:0,textDecoration:'underline',cursor:'pointer'}}>Start again</button>}
 </form>}
 <p style={{fontSize:12,marginTop:24}}>Protected owner access. Never share verification codes.</p>
 </section></main>;
}
