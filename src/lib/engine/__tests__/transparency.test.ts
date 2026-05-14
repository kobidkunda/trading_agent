import { describe, expect, it } from 'vitest';

import {
  buildStageTransparencyRecord,
  withStaleOption,
} from '../research/transparency';
import { buildSynthesisDetail } from '../research/synthesis';

describe('transparency helpers', () => {
  it('marks a saved dropdown value as stale when metadata no longer includes it', () => {
    const options = withStaleOption(
      [{ id: 'paper_lite', label: 'paper_lite', stale: false }],
      'paper_proglm',
    );

    expect(options).toHaveLength(2);
    expect(options[0]).toEqual({ id: 'paper_proglm', label: 'paper_proglm', stale: true });
  });

  it('normalizes stage transparency records with timing and failure context', () => {
    const record = buildStageTransparencyRecord({
      stage: 'TRADINGAGENTS',
      serviceName: 'TradingAgents',
      provider: 'openai',
      model: 'paper_proglm',
      startedAt: '2026-04-19T04:00:00.000Z',
      endedAt: '2026-04-19T04:00:10.000Z',
      status: 'completed',
      rawOutput: 'line 1\nline 2',
      sources: [{ title: 'Example', url: 'https://example.com', snippet: 'evidence' }],
    });

    expect(record.durationMs).toBe(10000);
    expect(record.serviceName).toBe('TradingAgents');
    expect(record.sources).toHaveLength(1);
    expect(record.failureReason).toBeNull();
  });

  it('captures failure reason when stage status is failed', () => {
    const record = buildStageTransparencyRecord({
      stage: 'TRADINGAGENTS',
      serviceName: 'TradingAgents',
      provider: 'openai',
      model: 'paper_proglm',
      startedAt: '2026-04-19T04:00:00.000Z',
      endedAt: '2026-04-19T04:00:05.000Z',
      status: 'failed',
      failureReason: 'API timeout',
      rawOutput: null,
      sources: [],
    });

    expect(record.durationMs).toBe(5000);
    expect(record.status).toBe('failed');
    expect(record.failureReason).toBe('API timeout');
  });
});

describe('research transparency packet building', () => {
  it('builds synthesis detail with sources and references for transparency', () => {
    const synthesisResult = {
      summary: 'Market shows bullish signals with 65% consensus probability',
      keyFindings: ['Strong earnings growth', 'Positive analyst sentiment'],
      agreements: ['All sources agree on upward trend'],
      disagreements: ['Differ on magnitude of growth'],
      consensusProbability: 0.65,
      sourceComparison: [
        { source: 'News Analyst', sentiment: 'bullish', confidence: 0.75 },
        { source: 'Technical Analyst', sentiment: 'bullish', confidence: 0.68 },
      ],
      finalAssessment: 'Bullish outlook with moderate confidence',
      confidence: 0.72,
    };

    const sources = [
      {
        source: 'News Analyst',
        findings: ['Earnings beat expectations', 'New product launch announced'],
        contradictions: [],
        confidence: 0.75,
        raw: 'Raw news analysis output here',
      },
      {
        source: 'Technical Analyst',
        findings: ['Breakout above resistance', 'Volume surge detected'],
        contradictions: ['Short-term overbought signals'],
        confidence: 0.68,
        raw: 'Raw technical analysis output here',
      },
    ];

    const references = [
      { title: 'Q1 Earnings Report', url: 'https://example.com/earnings', domain: 'example.com', snippet: 'Earnings grew 25%', provider: 'company', reasonIncluded: null },
      { title: 'Market Analysis', url: 'https://news.com/analysis', domain: 'news.com', snippet: 'Bullish trend continues', provider: 'news', reasonIncluded: null },
    ];

    const detail = buildSynthesisDetail(synthesisResult, sources, {
      modelUsed: 'paper_proglm',
      provider: 'openai',
      serviceName: 'synthesis',
      startedAt: '2026-04-19T04:00:00.000Z',
      endedAt: '2026-04-19T04:00:15.000Z',
      references,
    });

    // Verify base result properties are preserved
    expect(detail.summary).toBe(synthesisResult.summary);
    expect(detail.consensusProbability).toBe(0.65);
    expect(detail.confidence).toBe(0.72);

    // Verify extended properties
    expect(detail.modelUsed).toBe('paper_proglm');
    expect(detail.provider).toBe('openai');
    expect(detail.serviceName).toBe('synthesis');
    expect(detail.durationMs).toBe(15000);

    // Verify sources are included
    expect(detail.sources).toHaveLength(2);
    expect(detail.sources[0].name).toBe('News Analyst');
    expect(detail.sources[0].findings).toHaveLength(2);
    expect(detail.sources[1].contradictions).toHaveLength(1);

    // Verify references are included
    expect(detail.references).toHaveLength(2);
    expect(detail.references[0].title).toBe('Q1 Earnings Report');
    expect(detail.references[0].domain).toBe('example.com');

    // Verify timing
    expect(detail.startedAt).toBe('2026-04-19T04:00:00.000Z');
    expect(detail.endedAt).toBe('2026-04-19T04:00:15.000Z');
  });

  it('builds transparency stages from agent outputs with rich metadata', () => {
    const agentOutputs = [
      {
        id: 'output-1',
        role: 'DEERFLOW',
        stage: 'DEERFLOW',
        serviceName: 'deerflow',
        provider: 'deerflow',
        modelUsed: 'claude-sonnet-4',
        output: '{"summary": "Deep research results"}',
        rawOutput: '{"summary": "Deep research results", "findings": []}',
        summary: 'Deep research results',
        referencesJson: '[{"title": "Source 1", "url": "https://example.com/1"}]',
        failureReason: null,
        startedAt: new Date('2026-04-19T04:00:00.000Z'),
        endedAt: new Date('2026-04-19T04:00:30.000Z'),
        createdAt: new Date('2026-04-19T04:00:30.000Z'),
      },
      {
        id: 'output-2',
        role: 'NEWS_ANALYST',
        stage: 'TRADINGAGENTS',
        serviceName: 'tradingagents',
        provider: 'tradingagents',
        modelUsed: 'paper_lite',
        output: '{"error": "API timeout"}',
        rawOutput: null,
        summary: null,
        referencesJson: null,
        failureReason: 'API timeout',
        startedAt: new Date('2026-04-19T04:00:30.000Z'),
        endedAt: new Date('2026-04-19T04:00:35.000Z'),
        createdAt: new Date('2026-04-19T04:00:35.000Z'),
      },
    ];

    const stages = agentOutputs.map((output) => {
      const references = output.referencesJson
        ? JSON.parse(output.referencesJson)
        : [];

      return buildStageTransparencyRecord({
        stage: output.stage ?? output.role,
        serviceName: output.serviceName ?? output.role,
        provider: output.provider,
        model: output.modelUsed,
        startedAt: output.startedAt?.toISOString() ?? null,
        endedAt: output.endedAt?.toISOString() ?? null,
        status: output.failureReason ? 'failed' : 'completed',
        failureReason: output.failureReason,
        summary: output.summary,
        rawOutput: output.rawOutput ?? output.output,
        references: references.map((ref: { title?: string; url?: string; snippet?: string; provider?: string }) => ({
          title: ref.title ?? ref.url ?? 'Untitled',
          url: ref.url ?? '',
          snippet: ref.snippet ?? null,
          provider: ref.provider ?? null,
        })),
      });
    });

    // Verify first stage (completed)
    expect(stages).toHaveLength(2);
    expect(stages[0].stage).toBe('DEERFLOW');
    expect(stages[0].status).toBe('completed');
    expect(stages[0].serviceName).toBe('deerflow');
    expect(stages[0].provider).toBe('deerflow');
    expect(stages[0].model).toBe('claude-sonnet-4');
    expect(stages[0].durationMs).toBe(30000);
    expect(stages[0].references).toHaveLength(1);
    expect(stages[0].failureReason).toBeNull();

    // Verify second stage (failed)
    expect(stages[1].stage).toBe('TRADINGAGENTS');
    expect(stages[1].status).toBe('failed');
    expect(stages[1].serviceName).toBe('tradingagents');
    expect(stages[1].failureReason).toBe('API timeout');
    expect(stages[1].durationMs).toBe(5000);
  });
});
