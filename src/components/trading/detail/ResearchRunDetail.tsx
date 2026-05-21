'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ResearchRunDetailProps {
  detail: {
    researchRun: {
      id: string;
      status: string;
      depth: string;
      startedAt: string | null;
      completedAt: string | null;
      createdAt: string;
    };
    market: {
      id: string;
      title: string;
      venue: string;
      category: string;
      status: string;
      externalId: string;
    };
    candidate: {
      id: string;
      stage: string;
      triageStatus: string | null;
      candidateScore: number | null;
    } | null;
    sources: Array<{
      id: string;
      title: string | null;
      url: string;
      sourceType: string;
      extractedAt: string;
      qualityScore: number | null;
      recencyScore: number | null;
    }>;
    agentOutputs: Array<{
      id: string;
      role: string;
      stage: string | null;
      serviceName: string | null;
      provider: string | null;
      modelUsed: string | null;
      summary: string | null;
      output: string;
      rawOutput: string | null;
      failureReason: string | null;
      createdAt: string;
    }>;
    decisions: Array<{
      id: string;
      action: string;
      edge: number | null;
      confidence: number | null;
      createdAt: string;
    }>;
    jobs: Array<{
      id: string;
      type: string;
      status: string;
      error: string | null;
      createdAt: string;
      startedAt: string | null;
      completedAt: string | null;
      researchCheckpoints: Array<{
        id: string;
        state: string;
        lastHeartbeatAt: string;
        createdAt: string;
      }>;
    }>;
  };
}

function fmt(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

export function ResearchRunDetail({ detail }: ResearchRunDetailProps) {
  const router = useRouter();
  const [restarting, setRestarting] = useState(false);

  const restartResearch = async () => {
    if (!detail.candidate?.id) {
      toast.error('No linked candidate to restart');
      return;
    }

    setRestarting(true);
    try {
      const response = await fetch(`/api/trading/candidates/${detail.candidate.id}/force-research`, {
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      toast.success('Research restart queued');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to restart research');
    } finally {
      setRestarting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <Badge variant="outline">{detail.researchRun.depth}</Badge>
          <Badge variant="outline">{detail.researchRun.status}</Badge>
          {detail.candidate?.triageStatus && <Badge variant="outline">{detail.candidate.triageStatus}</Badge>}
        </div>

        <Card className="border-gray-800 bg-gray-900">
          <CardHeader>
            <CardTitle className="text-lg">{detail.market.title}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-4">
            <div><p className="text-xs text-gray-500">Venue</p><p>{detail.market.venue}</p></div>
            <div><p className="text-xs text-gray-500">Category</p><p>{detail.market.category}</p></div>
            <div><p className="text-xs text-gray-500">Started</p><p>{fmt(detail.researchRun.startedAt)}</p></div>
            <div><p className="text-xs text-gray-500">Completed</p><p>{fmt(detail.researchRun.completedAt)}</p></div>
            <div className="md:col-span-4 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => router.push(`/market/${detail.market.id}`)}>
                <ExternalLink className="mr-2 h-4 w-4" />
                Market Detail
              </Button>
              {detail.candidate && (
                <Button size="sm" variant="outline" onClick={() => router.push(`/candidates/${detail.candidate?.id}`)}>
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Candidate Detail
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={restartResearch} disabled={restarting || !detail.candidate}>
                {restarting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Restart Research
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="border-gray-800 bg-gray-900">
            <CardHeader><CardTitle className="text-sm">Sources</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {detail.sources.length === 0 ? <p className="text-sm text-gray-500">No sources</p> : detail.sources.map((source) => (
                <div key={source.id} className="rounded border border-gray-800 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{source.sourceType}</Badge>
                    <span className="text-xs text-gray-500">{fmt(source.extractedAt)}</span>
                  </div>
                  <p className="mt-2 text-sm font-medium">{source.title || source.url}</p>
                  <a className="mt-1 block text-xs text-cyan-400" href={source.url} target="_blank" rel="noreferrer">{source.url}</a>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-gray-800 bg-gray-900">
            <CardHeader><CardTitle className="text-sm">Jobs & Checkpoints</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {detail.jobs.length === 0 ? <p className="text-sm text-gray-500">No linked jobs</p> : detail.jobs.map((job) => (
                <div key={job.id} className="rounded border border-gray-800 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{job.type}</Badge>
                    <Badge variant="outline">{job.status}</Badge>
                    <span className="text-xs text-gray-500">{fmt(job.createdAt)}</span>
                  </div>
                  {job.error && <p className="mt-2 text-xs text-red-400">{job.error}</p>}
                  <div className="mt-2 space-y-2">
                    {job.researchCheckpoints.map((checkpoint) => (
                      <div key={checkpoint.id} className="rounded bg-gray-950 p-2 text-xs">
                        <p>State: {checkpoint.state}</p>
                        <p>Heartbeat: {fmt(checkpoint.lastHeartbeatAt)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card className="border-gray-800 bg-gray-900">
          <CardHeader><CardTitle className="text-sm">Agent Outputs</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {detail.agentOutputs.length === 0 ? <p className="text-sm text-gray-500">No agent outputs</p> : detail.agentOutputs.map((output) => (
              <div key={output.id} className="rounded border border-gray-800 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{output.role}</Badge>
                  {output.provider && <Badge variant="outline">{output.provider}</Badge>}
                  {output.modelUsed && <span className="text-xs text-gray-500">{output.modelUsed}</span>}
                </div>
                {output.failureReason && <p className="mt-2 text-xs text-red-400">{output.failureReason}</p>}
                <pre className="mt-2 whitespace-pre-wrap text-xs text-gray-300">{output.summary || output.rawOutput || output.output}</pre>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-gray-800 bg-gray-900">
          <CardHeader><CardTitle className="text-sm">Linked Decisions</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {detail.decisions.length === 0 ? <p className="text-sm text-gray-500">No linked decisions</p> : detail.decisions.map((decision) => (
              <div key={decision.id} className="flex items-center justify-between rounded border border-gray-800 px-3 py-2 text-sm">
                <span>{decision.action}</span>
                <span className="text-gray-400">Edge {decision.edge == null ? '—' : `${(decision.edge * 100).toFixed(1)}%`}</span>
                <span className="text-gray-400">Confidence {decision.confidence == null ? '—' : `${(decision.confidence * 100).toFixed(1)}%`}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
