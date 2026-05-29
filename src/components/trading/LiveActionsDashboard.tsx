'use client';

import { useEffect, useState } from 'react';

export const LIVE_ACTIONS_ENDPOINT = '/api/logs?view=live-actions&sort=desc&page=1&limit=25';
export const LIVE_ACTIONS_REFRESH_MS = 5000;

export type LiveActionEntry = {
  id: string;
  type: string;
  action: string;
  status: string;
  message: string;
};

export type LiveActionStatusFilter = 'ALL' | 'RUNNING' | 'FAILED' | 'COMPLETED';

const LIVE_ACTION_STATUS_FILTERS: LiveActionStatusFilter[] = ['ALL', 'RUNNING', 'FAILED', 'COMPLETED'];

export function mapLiveEntriesFromResponse(payload: unknown): LiveActionEntry[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const maybeEntries = (payload as { entries?: unknown }).entries;
  if (!Array.isArray(maybeEntries)) {
    return [];
  }

  return maybeEntries.map((entry, index) => {
    const e = (entry ?? {}) as Record<string, unknown>;
    const fallbackId = `${String(e.type ?? 'Unknown')}-${String(e.action ?? 'Unknown')}-${String(e.status ?? 'UNKNOWN')}-${index}`;
    return {
      id: typeof e.id === 'string' && e.id.trim() ? e.id : fallbackId,
      type: typeof e.type === 'string' && e.type.trim() ? e.type : 'Unknown',
      action: typeof e.action === 'string' && e.action.trim() ? e.action : 'Unknown',
      status: typeof e.status === 'string' && e.status.trim() ? e.status : 'UNKNOWN',
      message: typeof e.message === 'string' ? e.message : '',
    };
  });
}

export async function fetchLiveActionEntries(fetchImpl: typeof fetch = fetch): Promise<LiveActionEntry[]> {
  const response = await fetchImpl(LIVE_ACTIONS_ENDPOINT);
  if (!response.ok) return [];
  const data = await response.json();
  return mapLiveEntriesFromResponse(data);
}

export function startLiveActionsPolling(
  callback: () => void,
  intervalMs: number = LIVE_ACTIONS_REFRESH_MS,
  enabled: boolean = true,
): ReturnType<typeof setInterval> | null {
  if (!enabled) {
    return null;
  }
  return setInterval(callback, intervalMs);
}

export function filterLiveActionEntries(
  entries: LiveActionEntry[],
  statusFilter: LiveActionStatusFilter,
): LiveActionEntry[] {
  if (statusFilter === 'ALL') {
    return entries;
  }

  return entries.filter((entry) => entry.status.toUpperCase() === statusFilter);
}

export default function LiveActionsDashboard() {
  const [entries, setEntries] = useState<LiveActionEntry[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [statusFilter, setStatusFilter] = useState<LiveActionStatusFilter>('ALL');

  useEffect(() => {
    let isMounted = true;
    let inFlight = false;

    const fetchEntries = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const mapped = await fetchLiveActionEntries();
        if (!isMounted) {
          return;
        }

        setEntries(mapped);
      } catch {
        // no-op
      } finally {
        inFlight = false;
      }
    };

    fetchEntries();
    const intervalId = startLiveActionsPolling(fetchEntries, LIVE_ACTIONS_REFRESH_MS, autoRefresh);

    return () => {
      isMounted = false;
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [autoRefresh]);

  const displayedEntries = filterLiveActionEntries(entries, statusFilter);

  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold text-white">Live Actions</h2>

      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2 text-sm text-gray-200">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(event) => setAutoRefresh(event.target.checked)}
          />
          <span>Auto-refresh</span>
        </label>

        <label className="inline-flex items-center gap-2">
          <span>Status filter</span>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as LiveActionStatusFilter)}
            className="rounded border border-gray-700 bg-gray-950 px-2 py-1 text-gray-100"
          >
            {LIVE_ACTION_STATUS_FILTERS.map((filter) => (
              <option key={filter} value={filter}>
                {filter}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-900">
            <tr className="text-left text-gray-400">
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Action</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Message</th>
            </tr>
          </thead>
          <tbody>
            {displayedEntries.map((entry) => (
              <tr key={entry.id} className="border-t border-gray-800 text-gray-200">
                <td className="px-3 py-2">{entry.type}</td>
                <td className="px-3 py-2">{entry.action}</td>
                <td className="px-3 py-2">{entry.status}</td>
                <td className="px-3 py-2">{entry.message}</td>
              </tr>
            ))}
            {displayedEntries.length === 0 && (
              <tr className="border-t border-gray-800 text-gray-500">
                <td className="px-3 py-3" colSpan={4}>
                  No live actions.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
