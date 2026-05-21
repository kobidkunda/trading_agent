'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { CandidateDetail } from '@/components/trading/detail/CandidateDetail';

export default function CandidateDetailPage() {
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(`/api/trading/candidates/${params.id}`, { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        if (!cancelled) setDetail(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load candidate detail');
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [params.id]);

  if (error) {
    return <div className="p-6 text-red-400">{error}</div>;
  }

  if (!detail) {
    return <div className="flex min-h-screen items-center justify-center bg-gray-950"><Loader2 className="h-8 w-8 animate-spin text-emerald-400" /></div>;
  }

  return <CandidateDetail detail={detail} />;
}
