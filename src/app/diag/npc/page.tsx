import NpcLab from './NpcLab';

export const metadata = { title: 'NPC faces' };

/**
 * Client-only: the lab builds a WebGL context and fetches a model, neither of
 * which exists on a server.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ body?: string; calib?: string; bare?: string; models?: string; only?: string }>;
}) {
  const { body, calib, bare, models, only } = await searchParams;
  return (
    <NpcLab
      body={body === '1'}
      calib={calib === '1'}
      bare={bare === '1'}
      models={(models ?? '').split(',').map((m) => m.trim()).filter(Boolean)}
      only={only ?? ''}
    />
  );
}
