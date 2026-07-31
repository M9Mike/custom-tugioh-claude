import DuelRoom from './DuelRoom';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <DuelRoom code={code.toUpperCase()} />;
}
