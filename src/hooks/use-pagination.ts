import { useState, useCallback, useRef, useEffect } from 'react';
import type { PaginatedResponse, PaginationParams } from '@/lib/types';

interface UsePaginationOptions {
  defaultPage?: number;
  defaultLimit?: number;
  defaultSortBy?: string;
  defaultSortOrder?: 'asc' | 'desc';
}

interface UsePaginationReturn<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  sortBy: string | undefined;
  sortOrder: 'asc' | 'desc';
  loading: boolean;
  error: string | null;
  setPage: (page: number) => void;
  setLimit: (limit: number) => void;
  setSort: (sortBy: string, sortOrder?: 'asc' | 'desc') => void;
  fetchData: () => Promise<void>;
  reset: () => void;
}

export function usePagination<T>(
  fetchFn: (params: PaginationParams) => Promise<PaginatedResponse<T>>,
  deps: unknown[] = [],
  options: UsePaginationOptions = {},
): UsePaginationReturn<T> {
  const [data, setData] = useState<T[]>([]);
  const [page, setPageState] = useState(options.defaultPage ?? 1);
  const [limit, setLimitState] = useState(options.defaultLimit ?? 25);
  const [sortBy, setSortByState] = useState(options.defaultSortBy);
  const [sortOrder, setSortOrderState] = useState<'asc' | 'desc'>(options.defaultSortOrder ?? 'desc');
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchId = useRef(0);

  const fetchData = useCallback(async () => {
    const currentFetchId = ++fetchId.current;
    setLoading(true);
    setError(null);
    try {
      const params: PaginationParams = { page, limit, sortBy, sortOrder };
      const result = await fetchFn(params);
      if (currentFetchId === fetchId.current) {
        setData(result.data);
        setTotal(result.total);
        setTotalPages(result.totalPages);
      }
    } catch (e) {
      if (currentFetchId === fetchId.current) {
        setError(e instanceof Error ? e.message : 'Failed to fetch data');
      }
    } finally {
      if (currentFetchId === fetchId.current) {
        setLoading(false);
      }
    }
  }, [page, limit, sortBy, sortOrder, ...deps]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const setPage = useCallback((p: number) => {
    setPageState(p);
  }, []);

  const setLimit = useCallback((l: number) => {
    setLimitState(l);
    setPageState(1);
  }, []);

  const setSort = useCallback((sb: string, so?: 'asc' | 'desc') => {
    setSortByState(sb);
    if (so) setSortOrderState(so);
    setPageState(1);
  }, []);

  const reset = useCallback(() => {
    setPageState(options.defaultPage ?? 1);
    setLimitState(options.defaultLimit ?? 25);
    setSortByState(options.defaultSortBy);
    setSortOrderState(options.defaultSortOrder ?? 'desc');
  }, [options.defaultPage, options.defaultLimit, options.defaultSortBy, options.defaultSortOrder]);

  return {
    data,
    page,
    limit,
    total,
    totalPages,
    sortBy,
    sortOrder,
    loading,
    error,
    setPage,
    setLimit,
    setSort,
    fetchData: () => fetchData(),
    reset,
  };
}
