import { z } from 'zod';
import { PublicVoteReceiptSchema, PublicVoteResultSchema, PublicVoteWindowSchema } from '../../../packages/live/src/public-view.ts';

export type VoteOption = 'bus' | 'rain' | 'supplier-delay';
export class VoteError extends Error {
  constructor(public status: number) { super('Voting request failed'); }
}
const statusSchema = z.object({window: PublicVoteWindowSchema, receipt: PublicVoteReceiptSchema.nullable(), result: PublicVoteResultSchema.nullable()}).strict();
const sessionSchema = z.object({window: PublicVoteWindowSchema}).strict();
const submitSchema = z.object({receipt: PublicVoteReceiptSchema}).strict();
export async function requestVote<T extends 'status' | 'session' | 'submit'>(action: T, roundId: string, submission?: {requestId: string; optionId: VoteOption}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch('/api/votes', { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      headers: {'Content-Type':'application/json'}, body: JSON.stringify({action, roundId, ...submission}) });
    if (response.status !== 200) { void response.body?.cancel(); throw new VoteError(response.status); }
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error();
    const reader = response.body?.getReader();
    if (!reader) throw new Error();
    let body = '', bytes = 0;
    const decoder = new TextDecoder('utf-8', {fatal:true});
    try { while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > 65536) throw new Error(); body += decoder.decode(chunk.value, {stream:true}); } }
    finally { void reader.cancel().catch(() => {}); }
    const data: unknown = JSON.parse(body + decoder.decode());
    if (action === 'submit') {
      const parsed = submitSchema.parse(data);
      if (parsed.receipt.round_id !== roundId || parsed.receipt.request_id !== submission?.requestId || parsed.receipt.option_id !== submission?.optionId) throw new Error();
      return parsed;
    }
    if (action === 'status') {
      const parsed = statusSchema.parse(data);
      if (parsed.window.round_id !== roundId || (parsed.receipt && parsed.receipt.round_id !== roundId) || (parsed.result && parsed.result.round_id !== roundId)) throw new Error();
      return parsed;
    }
    const parsed = sessionSchema.parse(data);
    if (parsed.window.round_id !== roundId) throw new Error();
    return parsed;
  } catch(error) { if (error instanceof VoteError) throw error; throw new VoteError(0); }
  finally { clearTimeout(timer); }
}
