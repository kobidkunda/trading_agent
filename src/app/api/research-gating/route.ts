import { NextResponse } from 'next/server';
import { ResearchGate } from '@/lib/engine/research-gating';

const gate = new ResearchGate();

export async function GET() {
  return NextResponse.json(gate.getBudgetStatus());
}
