import { NextRequest, NextResponse } from 'next/server';
import { getSimState } from '@/lib/engine/live-simulation';
import { db } from '@/lib/db';

// GET /api/market/[id]/live - Get live progress for a market being processed
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const simState = getSimState();
    
    // Find this market in the live simulation progress
    const liveProgress = simState.marketProgress?.find(m => m.marketId === id);
    
    // Check if this market is currently being processed
    const isCurrentlyProcessing = simState.currentMarketTitle && 
      (liveProgress?.status === 'running' || 
       simState.currentStage !== null);
    
    // Get the active event for this market
    const activeEvents = simState.activityEvents?.filter(
      e => e.marketId === id && e.timestamp > new Date(Date.now() - 60000).toISOString()
    ) || [];
    
    // Get latest event
    const latestEvent = activeEvents[activeEvents.length - 1];
    
    // Check database for any recently completed research
    const latestResearch = await db.researchRun.findFirst({
      where: { marketId: id },
      orderBy: { startedAt: 'desc' },
      include: {
        agentOutputs: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    });
    
    const isInDatabase = !!latestResearch;
    const isCompleteInDb = latestResearch?.endedAt !== null;
    const isStale = latestResearch && 
      new Date(latestResearch.endedAt || latestResearch.startedAt).getTime() < Date.now() - 300000; // 5 min old
    
    // Determine overall status
    let status: 'idle' | 'scanning' | 'triaging' | 'researching' | 'judging' | 'risk_checking' | 'deciding' | 'completed' | 'error';
    
    if (liveProgress?.status === 'running') {
      // Map current stage to status
      const stage = liveProgress.currentStage || latestEvent?.stage;
      if (stage?.includes('SCAN')) status = 'scanning';
      else if (stage?.includes('TRIAGE')) status = 'triaging';
      else if (stage?.includes('RESEARCH') || stage?.includes('DEERFLOW') || stage?.includes('AGENT')) status = 'researching';
      else if (stage?.includes('JUDGE') || stage?.includes('DEBATE')) status = 'judging';
      else if (stage?.includes('RISK')) status = 'risk_checking';
      else if (stage?.includes('DECISION')) status = 'deciding';
      else status = 'researching';
    } else if (liveProgress?.status === 'completed' || (isInDatabase && isCompleteInDb && !isStale)) {
      status = 'completed';
    } else if (liveProgress?.status === 'failed' || liveProgress?.status === 'error') {
      status = 'error';
    } else {
      status = 'idle';
    }
    
    // Get parallel agents currently running
    const activeAgents = activeEvents
      .filter(e => e.type === 'started' || e.type === 'progress')
      .map(e => ({
        role: e.stage,
        serviceName: e.serviceName,
        provider: e.provider,
        model: e.model,
        startedAt: e.timestamp,
        message: e.message,
      }));
    
    // Get recently completed agents
    const completedAgents = activeEvents
      .filter(e => e.type === 'completed')
      .map(e => ({
        role: e.stage,
        serviceName: e.serviceName,
        completedAt: e.timestamp,
        summary: e.summary,
      }));
    
    return NextResponse.json({
      marketId: id,
      status,
      isLive: status !== 'idle' && status !== 'completed',
      isComplete: status === 'completed',
      progress: {
        currentStage: liveProgress?.currentStage || latestEvent?.stage || null,
        currentStageStartedAt: liveProgress?.currentStageStartedAt || latestEvent?.timestamp || null,
        overallStatus: liveProgress?.status || 'idle',
      },
      activeAgents,
      completedAgents,
      recentEvents: activeEvents.slice(-10).map(e => ({
        stage: e.stage,
        type: e.type,
        message: e.message,
        timestamp: e.timestamp,
        serviceName: e.serviceName,
        provider: e.provider,
        model: e.model,
        summary: e.summary,
        failureReason: e.failureReason,
      })),
      simulationStatus: simState.status,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching live market progress:', error);
    return NextResponse.json(
      { error: 'Failed to fetch live progress' },
      { status: 500 }
    );
  }
}
