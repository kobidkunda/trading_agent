import { NextResponse } from 'next/server';
import { fetchDeerFlowModels } from '@/lib/engine/research/deerflow-api';

export async function GET() {
  const models = await fetchDeerFlowModels();
  return NextResponse.json({ models });
}
