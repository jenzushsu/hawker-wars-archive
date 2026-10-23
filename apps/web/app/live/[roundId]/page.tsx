import LiveRound from '../../../components/LiveRound';
export default async function RoundPage({params}: {params: Promise<{roundId: string}>}) {
  const {roundId} = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roundId)) return <main style={{padding:32}}><h1>Invalid round link</h1><p>Use a round ID or live link from the operator.</p><a href="/live">Find a live round</a></main>;
  return <LiveRound key={roundId.toLowerCase()} roundId={roundId.toLowerCase()} />;
}
