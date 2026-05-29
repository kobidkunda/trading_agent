import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import LiveActionsDashboard, {
  LIVE_ACTIONS_ENDPOINT,
  LIVE_ACTIONS_REFRESH_MS,
  fetchLiveActionEntries,
  mapLiveEntriesFromResponse,
  startLiveActionsPolling,
} from '@/components/trading/LiveActionsDashboard';

describe('live actions dashboard', () => {
  it('maps valid entries and normalizes fallback fields', () => {
    const response = {
      entries: [
        {
          type: 'Job',
          action: 'RUN_SCAN',
          status: 'COMPLETED',
          message: 'scan finished',
        },
        {
          type: '',
          action: '',
          status: '',
          message: '',
        },
      ],
    };

    const mapped = mapLiveEntriesFromResponse(response);

    expect(mapped).toHaveLength(2);
    expect(mapped[0]).toEqual({
      id: 'Job-RUN_SCAN-COMPLETED-0',
      type: 'Job',
      action: 'RUN_SCAN',
      status: 'COMPLETED',
      message: 'scan finished',
    });
    expect(mapped[1]).toEqual({
      id: '---1',
      type: 'Unknown',
      action: 'Unknown',
      status: 'UNKNOWN',
      message: '',
    });
  });

  it('returns empty list for non-object payloads', () => {
    expect(mapLiveEntriesFromResponse(null)).toEqual([]);
    expect(mapLiveEntriesFromResponse({})).toEqual([]);
    expect(mapLiveEntriesFromResponse({ entries: 'bad-shape' })).toEqual([]);
  });

  it('fetch helper calls live actions endpoint and maps response rows', async () => {
    const calls: Array<string> = [];
    const mockFetch = async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(
        JSON.stringify({
          entries: [
            { type: 'Job', action: 'PAPER_EXECUTE', status: 'COMPLETED', message: 'ok' },
          ],
        }),
        { status: 200 },
      );
    };

    const mapped = await fetchLiveActionEntries(mockFetch as any);
    expect(calls[0]).toBe(LIVE_ACTIONS_ENDPOINT);
    expect(mapped).toHaveLength(1);
    expect(mapped[0].action).toBe('PAPER_EXECUTE');
  });

  it('polling helper uses 5000ms interval', () => {
    let fired = 0;
    const id = startLiveActionsPolling(() => {
      fired += 1;
    }, LIVE_ACTIONS_REFRESH_MS);

    expect(id).toBeDefined();
    if (id) {
      clearInterval(id);
    }
    expect(fired).toBe(0);
  });

  it('exposes configured endpoint and refresh interval for live actions polling', () => {
    expect(LIVE_ACTIONS_ENDPOINT).toBe('/api/logs?view=live-actions&sort=desc&page=1&limit=25');
    expect(LIVE_ACTIONS_REFRESH_MS).toBe(5000);
  });

  it('renders heading and table columns for live action stream', () => {
    const html = renderToStaticMarkup(<LiveActionsDashboard />);
    expect(html).toContain('Live Actions');
    expect(html).toContain('Type');
    expect(html).toContain('Action');
    expect(html).toContain('Status');
    expect(html).toContain('Message');
  });
});
