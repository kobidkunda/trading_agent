import { notFound } from 'next/navigation';
import { TradingCommandCenterShell } from '@/components/trading-shell/TradingCommandCenterShell';
import { getTradingPageBySlug } from '@/lib/navigation/trading-pages';

export default async function TradingCommandCenterSlugPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = getTradingPageBySlug(slug);

  if (!page) {
    notFound();
  }

  return <TradingCommandCenterShell initialPage={page.id} />;
}
