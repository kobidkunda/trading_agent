import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import LiveActionsDashboard, {
  LIVE_ACTIONS_REFRESH_MS,
  filterLiveActionEntries,
  startLiveActionsPolling,
  type LiveActionEntry,
  type LiveActionStatusFilter,
} from '@/components/trading/LiveActionsDashboard';

describe('live actions controls', () => {
  it('renders Auto-refresh and status filter controls', () => {
    const html = renderToStaticMarkup(<LiveActionsDashboard />);

    expect(html).toContain('Auto-refresh');
    expect(html).toContain('Status filter');
    expect(html).toContain('ALL');
    expect(html).toContain('RUNNING');
    expect(html).toContain('FAILED');
    expect(html).toContain('COMPLETED');
  });

  it('skips polling interval when auto refresh is disabled', () => {
    let fired = 0;

    const intervalId = startLiveActionsPolling(
      () => {
        fired += 1;
      },
      LIVE_ACTIONS_REFRESH_MS,
      false,
    );

    expect(intervalId).toBeNull();
    expect(fired).toBe(0);
  });

  it('filters entries by selected status', () => {
    const entries: LiveActionEntry[] = [
      { id: '1', type: 'Job', action: 'scan', status: 'RUNNING', message: '' },
      { id: '2', type: 'Job', action: 'scan', status: 'FAILED', message: '' },
      { id: '3', type: 'Job', action: 'scan', status: 'COMPLETED', message: '' },
    ];

    const all = filterLiveActionEntries(entries, 'ALL');
    const running = filterLiveActionEntries(entries, 'RUNNING');
    const failed = filterLiveActionEntries(entries, 'FAILED');
    const completed = filterLiveActionEntries(entries, 'COMPLETED');

    expect(all).toHaveLength(3);
    expect(running).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(completed).toHaveLength(1);
    expect(running[0]?.status).toBe('RUNNING');
    expect(failed[0]?.status).toBe('FAILED');
    expect(completed[0]?.status).toBe('COMPLETED');
  });

  it('normalizes status filter matching to uppercase', () => {
    const entries: LiveActionEntry[] = [
      { id: '4', type: 'Job', action: 'scan', status: 'running', message: '' },
      { id: '5', type: 'Job', action: 'scan', status: 'FAILED', message: '' },
    ];

    const statusFilter: LiveActionStatusFilter = 'RUNNING';
    const filtered = filterLiveActionEntries(entries, statusFilter);

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.status).toBe('running');
  });
});
