'use client';
import { useEffect, useRef, useState } from 'react';
import { createLiveViewer, initialLiveViewerState } from '../lib/live-view';
import { requestVote, VoteError, type VoteOption } from '../lib/live-votes';
import type { PublicVoteReceipt } from '../../../packages/live/src/public-view';
import styles from './LiveRound.module.css';
import LiveArena from './LiveArena';

const labels: Record<VoteOption,string> = {bus:'Bus arrival',rain:'Afternoon rain','supplier-delay':'Supplier delay'};
const descriptions: Record<VoteOption,string> = {bus:'Bring a new crowd to the stall.',rain:'Change demand during a rainy spell.','supplier-delay':'Put the supply plan under pressure.'};
const names = {rules:'Rules stall',jev:'Jev',zoom:'Zoom','zoom-pro':'Zoom Pro'};
const money = new Intl.NumberFormat('en-SG',{style:'currency',currency:'SGD'});
type Pending = {requestId:string;optionId:VoteOption};
export default function LiveRound({roundId}: {roundId:string}) {
  const [state,setState] = useState(initialLiveViewerState);
  const viewer = useRef<ReturnType<typeof createLiveViewer> | null>(null);
  const [now,setNow] = useState(0);
  const received = useRef(0);
  const [session,setSession] = useState<boolean|null>(null);
  const [selected,setSelected] = useState<VoteOption|null>(null);
  const [receipt,setReceipt] = useState<PublicVoteReceipt|null>(null);
  const [pending,setPending] = useState<Pending|null>(null);
  const pendingRef = useRef<Pending|null>(null);
  const [busy,setBusy] = useState(false);
  const busyRef = useRef(false);
  const checking = useRef(false);
  const generation = useRef(0);
  const alive = useRef(true);
  const [feedback,setFeedback] = useState('');
  function remember(value: Pending|null) {
    pendingRef.current = value; setPending(value);
    try { if(value) sessionStorage.setItem(`hawker-vote:${roundId}`,JSON.stringify(value)); else sessionStorage.removeItem(`hawker-vote:${roundId}`); } catch { /* A private browser may disable storage. */ }
  }
  useEffect(() => {
    alive.current = true;
    try { const value = JSON.parse(sessionStorage.getItem(`hawker-vote:${roundId}`) ?? 'null');
      if (value && /^[0-9a-f-]{36}$/i.test(value.requestId) && Object.hasOwn(labels,value.optionId)) {pendingRef.current=value;setPending(value);setSelected(value.optionId);setFeedback('A previous vote has no confirmed outcome. Check its receipt or retry the same vote.');}
    } catch { /* Ignore invalid local drafts. */ }
    const controller = createLiveViewer({roundId,onChange: next => {received.current=Date.now();setNow(Date.now());setState(next);}});
    viewer.current=controller; controller.start();
    const visibility = () => {if(document.hidden) {controller.stop();setState(previous=>({...previous,connection:'loading'}));}else controller.start();};
    document.addEventListener('visibilitychange',visibility);
    const timer=setInterval(()=>setNow(Date.now()),1000);
    return ()=>{alive.current=false;generation.current++;controller.stop();clearInterval(timer);document.removeEventListener('visibilitychange',visibility);};
  },[roundId]);
  const view=state.view;
  const snapshot=view?.snapshot;
  const window=view?.vote_window;
  const connected=state.connection==='connected';
  const remaining=window ? Math.max(0,window.remaining_ms-(window.paused ? 0 : now-received.current)) : 0;
  const eligible=connected && snapshot?.status==='running' && snapshot.control_state==='active' && window?.status==='open' && !window.paused && remaining>0;
  useEffect(()=>{
    if(!connected || !window || checking.current || busyRef.current) return;
    checking.current=true; const epoch=generation.current;
    void requestVote('status',roundId).then(data=>{
      if(!alive.current || epoch!==generation.current || !('receipt' in data)) return;
      setSession(true);setReceipt(data.receipt);
      if(data.receipt && pendingRef.current?.requestId===data.receipt.request_id && pendingRef.current.optionId===data.receipt.option_id){remember(null);setFeedback('Your vote is confirmed.');}
    }).catch(error=>{if(alive.current && epoch===generation.current && error instanceof VoteError && error.status===401) setSession(false);})
      .finally(()=>{checking.current=false;});
  },[view,connected,roundId,window]);
  async function join() {
    generation.current++;busyRef.current=true;setBusy(true);setFeedback('');
    try {await requestVote('session',roundId);if(alive.current){setSession(true);setFeedback('You can now choose an event.');}}
    catch(error){if(alive.current)setFeedback(error instanceof VoteError && error.status===409 ? 'Voting is no longer open.' : 'Could not join voting. Try again when connected.');}
    finally{busyRef.current=false;if(alive.current)setBusy(false);}
  }
  async function submit() {
    if(!pendingRef.current && (!selected || !eligible))return;
    const attempt=pendingRef.current ?? {requestId:crypto.randomUUID(),optionId:selected!};
    remember(attempt);generation.current++;busyRef.current=true;setBusy(true);setFeedback('Sending your vote…');
    try {
      const data=await requestVote('submit',roundId,attempt);
      if(!alive.current || !('receipt' in data) || !data.receipt)return;
      setReceipt(data.receipt);remember(null);setFeedback('Your vote is confirmed.');
    } catch(error) {
      if(!alive.current)return;
      const status=error instanceof VoteError ? error.status : 0;
      if(status===401){setSession(false);setFeedback('Your voting session expired. This vote is unconfirmed; keep this page open to preserve its request.');}
      else if(status===409 || status===429 || status===403 || status===404){remember(null);setFeedback(status===429 ? 'Vote limit reached. Your last confirmed vote is shown below.' : status===409 ? 'Voting is closed or this change was rejected. Your last confirmed vote is shown below.' : 'This vote was rejected. Reconnect to check voting availability.');}
      else setFeedback('Vote outcome unknown. Check your connection, then retry the same vote.');
    } finally {busyRef.current=false;if(alive.current)setBusy(false);}
  }
  const connectionLabel=connected ? 'Connected' : state.connection==='loading' ? 'Connecting…' : state.connection==='unavailable' ? 'Round unavailable' : 'Connection lost';
  const statusLabel=snapshot?.control_state==='stopped' ? 'Round stopped' : snapshot?.status==='completed' ? 'Service complete' : snapshot?.control_state==='paused' ? 'Paused by operator' : 'Service in progress';
  const result=view?.vote_result;
  return <main className={styles.shell}>
    <header className={styles.header}><a className={styles.brand} href="/">HAWKER WARS</a><nav aria-label="Live navigation"><a href="/live">Another round</a><a href="/">Offline demo</a></nav></header>
    <div className={styles.title}><div><h1>Live round</h1><p className={styles.roundId}>Round {roundId}</p></div><div className={styles.connection}><span role="status">{connectionLabel}</span><button onClick={()=>viewer.current?.reconnect()}>Reconnect</button></div></div>
    {!connected && <p className={styles.notice}>{view ? 'Last confirmed results. Updates and voting are unavailable until the connection returns.' : state.connection==='loading' ? 'Waiting for the first confirmed round update…' : 'This round could not be loaded. It may be unavailable, or live services may not be configured. Reconnect or return to the offline demo.'}</p>}
    <a className={styles.voteJump} href="#vote-title"><strong>Audience voting</strong><span>{!connected ? 'Waiting for connection' : !window ? 'Check availability' : window.status==='disabled' ? 'Disabled' : window.status==='locked' ? 'View result' : window.paused ? 'Paused' : remaining>0 ? `Open · about ${Math.ceil(remaining/1000)}s left` : 'Awaiting closure'}</span></a>
    <div className={styles.columns}><section className={styles.results} aria-labelledby="service-title">
      <div className={styles.sectionHeading}><h2 id="service-title">{snapshot ? statusLabel : 'Waiting for service'}</h2><strong>{snapshot && snapshot.tick>=0 ? `Minute ${snapshot.tick} / 120` : 'Not started'}</strong></div>
      {snapshot && <LiveArena snapshot={snapshot} connected={connected} />}
      <p className={styles.muted}>Confirmed results from this round. Money is shown in SGD; utility is measured in points.</p>
      {snapshot?.snapshot.policies.length ? <div className={styles.tableScroll} tabIndex={0} role="region" aria-label="Live stall results"><table className={styles.table}><caption>Latest committed results · tick {snapshot.tick}</caption><thead><tr><th scope="col">Stall</th><th scope="col">Cash</th><th scope="col">Profit</th><th scope="col">Utility</th><th scope="col">Served</th><th scope="col">Abandoned</th></tr></thead><tbody>{snapshot.snapshot.policies.map(policy=><tr key={policy.policy_id}><th scope="row">{names[policy.policy_id]}</th><td>{money.format(policy.cash_cents/100)}</td><td>{money.format(policy.profit_cents/100)}</td><td>{policy.utility_points}</td><td>{policy.served}</td><td>{policy.abandoned}</td></tr>)}</tbody></table></div> : <p className={styles.empty}>Results appear after the first committed tick.</p>}

    </section>
    <aside className={styles.votes} aria-labelledby="vote-title"><h2 id="vote-title" tabIndex={-1}>Change the lunch rush</h2><p>Choose one event for the stall. You can change your vote while the window is open.</p>
      <p className={styles.window}>{!window ? (snapshot && snapshot.tick<30 ? 'Voting opens after minute 30 for participating rounds.' : 'No audience vote is available for this round.') : window.status==='disabled' ? 'Audience voting is disabled.' : window.status==='locked' ? 'Voting is closed.' : window.paused ? 'Voting paused by operator.' : `About ${Math.ceil(remaining/1000)} seconds left`}</p>
      {window?.status==='open' && <p className={styles.muted}>The server decides whether a vote arrives in time.</p>}
      {window && <><fieldset className={styles.choices} disabled={!eligible || busy || !!pending || !session}><legend>Choose an event</legend>{(Object.keys(labels) as VoteOption[]).map(option=><label key={option}><input type="radio" name="event" value={option} checked={selected===option} onChange={()=>setSelected(option)}/><span><strong>{labels[option]}</strong><small>{descriptions[option]}</small></span><span className={styles.count}>{window.counts[option]}</span></label>)}</fieldset>
      {!session && !pending && <button className={styles.primary} disabled={!eligible || busy} onClick={join}>Join voting</button>}
      {session && !pending && <button className={styles.primary} disabled={!eligible || !selected || busy} onClick={submit}>{receipt ? 'Change vote' : 'Submit vote'}</button>}
      {pending && session===false && <><p className={styles.muted}>Your previous vote may have been accepted. Leaving this attempt does not withdraw it. A new voting session cannot recover its receipt.</p><button disabled={busy} onClick={()=>{remember(null);setFeedback('Previous vote outcome remains unknown. You may explicitly join a new session.');}}>Leave unconfirmed vote</button></>}{pending && <button className={styles.primary} disabled={!connected || busy || !session} onClick={submit}>Retry same vote</button>}
      </>}
      <div role="status" className={styles.feedback}>{feedback}</div>
      {receipt && <p className={styles.receipt}>Vote accepted: <strong>{labels[receipt.option_id]}</strong></p>}
      {pending && <p className={styles.muted}>Unconfirmed choice: {labels[pending.optionId]}. Retrying preserves the same request; it does not cast an extra vote.</p>}
      {result && <div className={styles.outcome}><h3>Audience result</h3><p>{result.winner===null ? 'No votes were cast. No event was selected.' : <><strong>{labels[result.winner]}</strong> · {!result.applied ? `Pending application at minute ${result.effective_tick}` : result.winner==='bus' ? `Applied at minute ${result.effective_tick}` : snapshot && result.ends_at!==null && snapshot.tick>result.ends_at ? `Ended after minute ${result.ends_at}` : `Applied at minute ${result.effective_tick}; active through minute ${result.ends_at}`}</>}</p></div>}
    </aside>
      <section className={styles.history} aria-labelledby="history-title"><h2 id="history-title">Service ledger</h2><p className={styles.muted}>The latest 12 confirmed ticks. Live updates may arrive between minutes.</p>{state.history.length ? <ol className={styles.ledger}>{state.history.slice(-12).reverse().map(event=><li key={event.sequence}><strong>Minute {event.tick}</strong><span>{event.event_type==='round-closed' ? 'Service completed' : 'Results committed'}</span><span>{event.snapshot.policies.reduce((sum,policy)=>sum+policy.served,0)} served total</span></li>)}</ol> : <p className={styles.empty}>No committed history yet.</p>}</section>
    </div><footer className={styles.footer}>Spectator view · Results update automatically while this page is visible.</footer>
  </main>;
}
