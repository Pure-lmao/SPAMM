import type { ApiPredictionContest } from './types';

const apiDomain = import.meta.env.VITE_API_DOMAIN?.trim() ?? '';

export async function fetchTodayContest(): Promise<ApiPredictionContest | null> {
   const res = await fetch(`${apiDomain}/api/predictions/today`);
   if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
   }
   const raw = await res.json();
   if (raw == null) {
      return null;
   }
   return raw as ApiPredictionContest;
}

export async function fetchContestById(id: number): Promise<ApiPredictionContest | null> {
   const q = new URLSearchParams({ id: String(id) });
   const res = await fetch(`${apiDomain}/api/predictions/contest?${q}`);
   if (res.status === 404) {
      return null;
   }
   if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
   }
   return (await res.json()) as ApiPredictionContest;
}

export async function fetchContestHistory(limit = 30): Promise<ApiPredictionContest[]> {
   const q = new URLSearchParams({ limit: String(limit) });
   const res = await fetch(`${apiDomain}/api/predictions/history?${q}`);
   if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
   }
   const raw = await res.json();
   if (!Array.isArray(raw)) {
      return [];
   }
   return raw as ApiPredictionContest[];
}
