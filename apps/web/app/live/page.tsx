'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from '../../components/LiveRound.module.css';
export default function JoinRound() {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  return <main className={styles.shell}><header className={styles.header}><a className={styles.brand} href="/">HAWKER WARS</a><a href="/">Offline demo</a></header><section className={styles.join}><h1>Watch a live round</h1><p>Follow the lunch rush as results arrive. Ask the operator for a round ID or live link.</p><form onSubmit={event => {
    event.preventDefault(); let id = input.trim();
    try { if (id.includes('://')) { const url = new URL(id); const match = /^\/live\/([^/]+)\/?$/.exec(url.pathname); id = match?.[1] ?? ''; } } catch { id = ''; }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {setError('Enter a valid round ID or a live round link.'); return;}
    router.push(`/live/${id.toLowerCase()}`);
  }}><label htmlFor="round-id">Round ID or live link</label><input id="round-id" value={input} onChange={event => {setInput(event.target.value);setError('');}} required autoComplete="off" spellCheck={false} aria-invalid={!!error} aria-describedby={error ? 'round-error' : undefined}/>{error && <p id="round-error" role="alert">{error}</p>}<button className={styles.primary} type="submit">Watch round</button></form></section></main>;
}
