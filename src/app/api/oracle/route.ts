import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { analyzeOracleRisk } from '@/lib/engine/oracle-mismatch';

function toResolutionDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const marketId = searchParams.get('marketId');

  if (!marketId) {
    return NextResponse.json({ error: 'marketId required' }, { status: 400 });
  }

  const market = await db.market.findUnique({ where: { id: marketId }, include: { oracleCheck: true } });
  if (!market) {
    return NextResponse.json({ error: 'Market not found' }, { status: 404 });
  }

  const risk = analyzeOracleRisk(market);
  return NextResponse.json({ ...risk, review: market.oracleCheck });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { marketId, action } = body;

  if (!marketId) {
    return NextResponse.json({ error: 'marketId required' }, { status: 400 });
  }

  const market = await db.market.findUnique({ where: { id: marketId }, include: { oracleCheck: true } });
  if (!market) {
    return NextResponse.json({ error: 'Market not found' }, { status: 404 });
  }

  if (action === 'approve-review' || action === 'reject-review') {
    const status = action === 'approve-review' ? 'APPROVED' : 'REJECTED';
    const review = await db.oracleCheck.upsert({
      where: { marketId },
      update: {
        manualReviewStatus: status,
        manualReviewCompletedAt: new Date(),
        manualReviewCompletedBy: body.reviewedBy || 'system',
        manualReviewNotes: body.notes || null,
        reviewDecision: status,
      },
      create: {
        marketId,
        riskLevel: 'HIGH',
        manualReviewRequired: true,
        manualReviewStatus: status,
        manualReviewCompletedAt: new Date(),
        manualReviewCompletedBy: body.reviewedBy || 'system',
        manualReviewNotes: body.notes || null,
        reviewDecision: status,
      },
    });

    await db.auditLog.create({
      data: {
        action: status === 'APPROVED' ? 'APPROVE_ORACLE_REVIEW' : 'REJECT_ORACLE_REVIEW',
        entityType: 'OracleCheck',
        entityId: review.id,
        details: `Oracle review ${status.toLowerCase()} for market ${marketId}`,
      },
    }).catch(() => {});

    return NextResponse.json({ success: true, review });
  }

  const risk = analyzeOracleRisk(market);
  const manualReviewRequired = risk.riskLevel === 'HIGH';
  const manualReviewStatus = risk.riskLevel === 'BLOCK'
    ? 'REQUIRED'
    : manualReviewRequired
      ? (market.oracleCheck?.manualReviewStatus ?? 'REQUIRED')
      : 'NOT_REQUIRED';
  
  const oracleCheck = await db.oracleCheck.upsert({
    where: { marketId },
    update: {
      oracleSource: risk.oracleSource,
      resolutionCriteria: risk.resolutionCriteria,
      resolutionDate: toResolutionDate(risk.deadline),
      timezone: risk.timezone,
      ambiguousWording: risk.hasAmbiguousWording,
      humanDiscretion: risk.hasHumanDiscretion,
      appealProcess: risk.hasAppealProcess,
      crossVenueMismatch: risk.crossVenueMismatch > 0,
      riskLevel: risk.riskLevel,
      oracleRiskReasons: JSON.stringify(risk.issues),
      manualReviewRequired,
      manualReviewStatus,
      manualReviewRequestedAt: manualReviewRequired ? (market.oracleCheck?.manualReviewRequestedAt ?? new Date()) : null,
      manualReviewRequestedBy: manualReviewRequired ? (market.oracleCheck?.manualReviewRequestedBy ?? 'system') : null,
      manualReviewExpiresAt: manualReviewRequired ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : null,
      notes: JSON.stringify({
        issues: risk.issues,
        officialSource: risk.officialSource,
        appealProcess: risk.appealProcess,
      }),
    },
    create: {
      marketId,
      oracleSource: risk.oracleSource,
      resolutionCriteria: risk.resolutionCriteria,
      resolutionDate: toResolutionDate(risk.deadline),
      timezone: risk.timezone,
      ambiguousWording: risk.hasAmbiguousWording,
      humanDiscretion: risk.hasHumanDiscretion,
      appealProcess: risk.hasAppealProcess,
      crossVenueMismatch: risk.crossVenueMismatch > 0,
      riskLevel: risk.riskLevel,
      oracleRiskReasons: JSON.stringify(risk.issues),
      manualReviewRequired,
      manualReviewStatus,
      manualReviewRequestedAt: manualReviewRequired ? new Date() : null,
      manualReviewRequestedBy: manualReviewRequired ? 'system' : null,
      manualReviewExpiresAt: manualReviewRequired ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : null,
      notes: JSON.stringify({
        issues: risk.issues,
        officialSource: risk.officialSource,
        appealProcess: risk.appealProcess,
      }),
    },
  });

  if (manualReviewRequired) {
    await db.auditLog.create({
      data: {
        action: 'REQUEST_ORACLE_REVIEW',
        entityType: 'OracleCheck',
        entityId: oracleCheck.id,
        details: `Oracle review requested for market ${marketId}`,
      },
    }).catch(() => {});
  }

  return NextResponse.json({ ...risk, review: oracleCheck });
}
