import { ShareView } from '@/components/share-view';

export const metadata = { title: 'Shared playlist' };

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ShareView token={token} />;
}
