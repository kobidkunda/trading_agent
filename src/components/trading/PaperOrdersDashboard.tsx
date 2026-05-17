'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  ScrollText,
  Filter,
  Search,
  ChevronUp,
  ChevronDown,
  XCircle,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type LifecycleStatus = 'PLANNED' | 'SUBMITTED' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'FAILED' | 'EXPIRED';

interface OrderRecord {
  id: string;
  marketId: string;
  venueOrderId: string | null;
  side: string;
  price: number;
  size: number;
  filledSize: number;
  remainingSize: number;
  avgFillPrice: number | null;
  lifecycleStatus: LifecycleStatus;
  spreadCost: number | null;
  slippageCost: number | null;
  estimatedFillCost: number | null;
  failureReason: string | null;
  pnl: number | null;
  submittedAt: string | null;
  filledAt: string | null;
  createdAt: string;
  market: {
    id: string;
    title: string;
    venue: string;
    category: string;
  } | null;
}

type SortField = 'price' | 'size' | 'lifecycleStatus' | 'pnl' | 'createdAt';
type SortDir = 'asc' | 'desc';

function lifecycleBadge(status: LifecycleStatus) {
  const styles: Record<string, string> = {
    PLANNED: 'border-gray-500/30 bg-gray-500/10 text-gray-400',
    SUBMITTED: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400',
    PARTIALLY_FILLED: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
    FILLED: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    CANCELLED: 'border-red-500/30 bg-red-500/10 text-red-400',
    FAILED: 'border-red-600/30 bg-red-600/10 text-red-500',
    EXPIRED: 'border-gray-600/30 bg-gray-600/10 text-gray-500',
  };
  return (
    <Badge variant="outline" className={cn('text-[10px]', styles[status] ?? styles.PLANNED)}>
      {status.replace('_', ' ')}
    </Badge>
  );
}

function sideBadge(side: string) {
  const isYes = side === 'YES';
  return (
    <Badge className={cn(
      'border-transparent text-[10px] text-white',
      isYes ? 'bg-emerald-600/70' : 'bg-red-600/70'
    )}>
      {side}
    </Badge>
  );
}

function pnlColor(val: number | null): string {
  if (val === null) return 'text-gray-500';
  if (val > 0) return 'text-emerald-400';
  if (val < 0) return 'text-red-400';
  return 'text-gray-400';
}

function formatCurrency(val: number): string {
  return val >= 1000 ? `$${(val / 1000).toFixed(1)}k` : `$${val.toFixed(2)}`;
}

function formatPnl(val: number | null): string {
  if (val === null) return '—';
  const sign = val >= 0 ? '+' : '';
  return `${sign}${formatCurrency(val)}`;
}

export function PaperOrdersDashboard() {
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/orders');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setOrders(data.orders ?? data ?? []);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load orders');
          toast.error('Failed to load orders');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const statuses = useMemo(() => {
    const set = new Set(orders.map((o) => o.lifecycleStatus));
    return Array.from(set).sort();
  }, [orders]);

  const filtered = useMemo(() => {
    let list = orders;
    if (statusFilter !== 'ALL') {
      list = list.filter((o) => o.lifecycleStatus === statusFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (o) =>
          o.market?.title?.toLowerCase().includes(q) ||
          o.market?.venue?.toLowerCase().includes(q) ||
          o.side?.toLowerCase().includes(q)
      );
    }
    return list.sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      const aNum = av === null || av === undefined ? -Infinity : (typeof av === 'string' ? av.localeCompare(String(bv)) : Number(av));
      const bNum = bv === null || bv === undefined ? -Infinity : (typeof bv === 'string' ? String(bv).localeCompare(String(av)) : Number(bv));
      return sortDir === 'desc' ? bNum - aNum : aNum - bNum;
    });
  }, [orders, search, statusFilter, sortField, sortDir]);

  const SortIcon = sortDir === 'desc' ? ChevronDown : ChevronUp;

  const filledCount = orders.filter((o) => o.lifecycleStatus === 'FILLED').length;
  const openCount = orders.filter((o) => ['PLANNED', 'SUBMITTED', 'PARTIALLY_FILLED'].includes(o.lifecycleStatus)).length;
  const totalPnl = orders.reduce((s, o) => s + (o.pnl ?? 0), 0);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-gray-800" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-900" />
          ))}
        </div>
        <div className="h-96 animate-pulse rounded-xl bg-gray-900" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-white">Paper Orders</h2>
        <Card className="border-red-500/30 bg-gray-900">
          <CardContent className="flex flex-col items-center py-12">
            <XCircle className="mb-3 h-10 w-10 text-red-400" />
            <p className="text-sm text-red-400">{error}</p>
            <Button variant="outline" size="sm" className="mt-4 border-gray-700 text-gray-300 hover:bg-gray-800"
              onClick={() => { setError(null); setLoading(true); window.location.reload(); }}>
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Paper Orders</h2>
        <p className="mt-1 text-sm text-gray-500">
          Order lifecycle tracking: PLANNED → SUBMITTED → FILLED/CANCELLED/EXPIRED
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Total Orders</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-white">{orders.length}</p>
          </CardContent>
        </Card>
        <Card className="border-cyan-500/20 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Open / Active</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-cyan-400">{openCount}</p>
          </CardContent>
        </Card>
        <Card className="border-emerald-500/20 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Filled</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-400">{filledCount}</p>
          </CardContent>
        </Card>
        <Card className={cn('border bg-gray-900', totalPnl >= 0 ? 'border-emerald-500/20' : 'border-red-500/20')}>
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Total PnL</p>
            <p className={cn('mt-1 text-2xl font-bold tabular-nums', pnlColor(totalPnl))}>
              {formatPnl(totalPnl)}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <Input
            placeholder="Search orders..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border-gray-800 bg-gray-900 pl-10 text-sm text-white placeholder:text-gray-600"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[200px] border-gray-800 bg-gray-900 text-sm text-gray-300">
            <Filter className="mr-2 h-3.5 w-3.5 text-gray-500" />
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent className="border-gray-800 bg-gray-900 text-gray-300">
            <SelectItem value="ALL">All Statuses</SelectItem>
            {statuses.map((s) => (
              <SelectItem key={s} value={s}>{s.replace('_', ' ')}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm text-white">
            <ScrollText className="h-4 w-4 text-emerald-400" />
            Orders
            <span className="ml-1 text-xs font-normal text-gray-500">
              ({filtered.length} of {orders.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-800">
                <ScrollText className="h-6 w-6 text-gray-500" />
              </div>
              <p className="text-xs font-medium text-gray-400">No orders found</p>
              <p className="mt-1 text-[11px] text-gray-600">
                {search || statusFilter !== 'ALL'
                  ? 'Try adjusting your search or filters.'
                  : 'Orders will appear as trades are placed.'}
              </p>
            </div>
          ) : (
            <div className="max-h-[600px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-800 hover:bg-transparent">
                    <TableHead className="text-gray-500">Market</TableHead>
                    <TableHead className="text-gray-500">Side</TableHead>
                    <TableHead className="cursor-pointer text-right text-gray-500 hover:text-gray-300" onClick={() => handleSort('price')}>
                      <span className="inline-flex items-center gap-1">
                        Price {sortField === 'price' && <SortIcon className="h-3 w-3" />}
                      </span>
                    </TableHead>
                    <TableHead className="cursor-pointer text-right text-gray-500 hover:text-gray-300" onClick={() => handleSort('size')}>
                      <span className="inline-flex items-center gap-1">
                        Size {sortField === 'size' && <SortIcon className="h-3 w-3" />}
                      </span>
                    </TableHead>
                    <TableHead className="text-gray-500">Status</TableHead>
                    <TableHead className="text-right text-gray-500">Spread Cost</TableHead>
                    <TableHead className="cursor-pointer text-right text-gray-500 hover:text-gray-300" onClick={() => handleSort('pnl')}>
                      <span className="inline-flex items-center gap-1">
                        PnL {sortField === 'pnl' && <SortIcon className="h-3 w-3" />}
                      </span>
                    </TableHead>
                    <TableHead className="cursor-pointer text-right text-gray-500 hover:text-gray-300" onClick={() => handleSort('createdAt')}>
                      <span className="inline-flex items-center gap-1">
                        Created {sortField === 'createdAt' && <SortIcon className="h-3 w-3" />}
                      </span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((o) => (
                    <TableRow key={o.id} className={cn(
                      'border-gray-800 transition-colors hover:bg-gray-800/50',
                      o.lifecycleStatus === 'FAILED' && 'bg-red-500/5'
                    )}>
                      <TableCell>
                        <p className="max-w-[200px] truncate text-xs font-medium text-gray-200">
                          {o.market?.title ?? '—'}
                        </p>
                      </TableCell>
                      <TableCell>{sideBadge(o.side)}</TableCell>
                      <TableCell className="text-right">
                        <span className="text-xs tabular-nums text-gray-300">${o.price.toFixed(4)}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-xs tabular-nums text-gray-300">${o.size.toFixed(2)}</span>
                      </TableCell>
                      <TableCell>{lifecycleBadge(o.lifecycleStatus)}</TableCell>
                      <TableCell className="text-right">
                        <span className="text-xs tabular-nums text-gray-500">
                          {o.spreadCost !== null ? formatCurrency(o.spreadCost) : '—'}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={cn('text-xs font-medium tabular-nums', pnlColor(o.pnl))}>
                          {formatPnl(o.pnl)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-xs tabular-nums text-gray-500">
                          {new Date(o.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
