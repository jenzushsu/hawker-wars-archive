'use client';

import { useEffect, useState } from 'react';
import type { PublicView } from '../../../packages/live/src/public-view';
import Arena from './Arena';
import styles from './LiveRound.module.css';

const names = { rules: 'Rules stall', jev: 'Jev', zoom: 'Zoom', 'zoom-pro': 'Zoom Pro' };
export default function LiveArena({ snapshot, connected }: { snapshot: PublicView['snapshot']; connected: boolean }) {
  const [selected, setSelected] = useState('rules');
  const [reducedMotion, setReducedMotion] = useState(true);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const policies = snapshot.snapshot.policies;
  const policy = policies.find(item => item.policy_id === selected) ?? policies[0];
  const activity = policy?.activity;
  const paused = !connected || snapshot.control_state !== 'active' || snapshot.status === 'completed';
  return <section aria-label="Live stall animation" className={styles.scene}>
    <h3>At the stall</h3>
    {policies.length > 1 && <label>Watch stall <select value={policy?.policy_id} onChange={event => setSelected(event.target.value)}>{policies.map(item => <option key={item.policy_id} value={item.policy_id}>{names[item.policy_id]}</option>)}</select></label>}
    {policy && activity ? <>
      <p>{names[policy.policy_id]} · {activity.queue} queuing · {paused ? 'Animation paused' : 'Live activity'}</p>
      <div className={styles.sceneCanvas}><Arena
        key={`${snapshot.round_id}:${policy.policy_id}`}
        singleStall sceneId={`${snapshot.round_id}:${policy.policy_id}`} tick={snapshot.tick}
        paused={paused} reducedMotion={reducedMotion} customers={activity}
        queue={activity.queue} cooking={activity.cooking} ready={activity.ready} raw={activity.raw}
        action={activity.action} servedTotal={policy.served} profitCents={policy.profit_cents}
        settled={snapshot.status === 'completed'} delivered={false} effects={[]}
      /></div>
      <p className={styles.muted}>The centre stall shows {names[policy.policy_id]}. Customers represent confirmed activity; up to three people are shown in the queue.</p>
    </> : <p className={styles.muted}>Animation will appear when this round provides customer activity. Confirmed results remain available below.</p>}
  </section>;
}
