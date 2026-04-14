'use client';

import { useState, useCallback, useRef } from 'react';
import { format } from 'date-fns';
import { api, ApiError } from '@/lib/api-client';
import type { AvailableSlot, MachineId } from '@/lib/schemas';

interface UseSlotsReturn {
  slots: AvailableSlot[];
  loading: boolean;
  error: string;
  fetchSlots: (date: Date, machineId: MachineId, ballType: string, pitchType: string) => Promise<void>;
}

// Simple in-memory cache for slot data (stale-while-revalidate pattern)
const slotCache = new Map<string, { data: AvailableSlot[]; ts: number }>();
const CACHE_TTL = 30_000; // 30 seconds

function getCacheKey(date: Date, machineId: string, ballType: string, pitchType: string) {
  return `${format(date, 'yyyy-MM-dd')}-${machineId}-${ballType}-${pitchType}`;
}

export function useSlots(): UseSlotsReturn {
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fetchIdRef = useRef(0);

  const fetchSlots = useCallback(async (
    date: Date,
    machineId: MachineId,
    ballType: string,
    pitchType: string
  ) => {
    const id = ++fetchIdRef.current;
    const key = getCacheKey(date, machineId, ballType, pitchType);
    const cached = slotCache.get(key);

    // Show cached data immediately if fresh enough
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      setSlots(cached.data);
      setLoading(false);
      setError('');
      return;
    }

    // Show stale cache while loading (if available)
    if (cached) {
      setSlots(cached.data);
    }
    setLoading(true);
    setError('');

    try {
      const dateStr = format(date, 'yyyy-MM-dd');
      let url = `/api/slots/available?date=${dateStr}&machineId=${machineId}&ballType=${ballType}`;
      if (pitchType) url += `&pitchType=${pitchType}`;

      const data = await api.get<AvailableSlot[]>(url);
      if (id !== fetchIdRef.current) return; // stale request
      slotCache.set(key, { data, ts: Date.now() });
      setSlots(data);
    } catch (err) {
      if (id !== fetchIdRef.current) return;
      const message = err instanceof ApiError ? err.message : 'Failed to fetch slots';
      setError(message);
    } finally {
      if (id === fetchIdRef.current) setLoading(false);
    }
  }, []);

  return { slots, loading, error, fetchSlots };
}
