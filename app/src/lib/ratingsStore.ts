import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState, useEffect } from 'react';
import { supabase } from './supabase';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config';

const STORAGE_KEY = 'qp_song_ratings';
const ANON_KEY = SUPABASE_ANON_KEY || 'sb_publishable_BeiQBv-HywDeWRd_ydBx_g_K1ZbCRV4';
const BASE_URL = SUPABASE_URL || 'https://prixtmnilittshdegrxq.supabase.co';

export function normalizeTrackKey(id?: string | null): string {
  if (!id) return '';
  return String(id).replace(/^crew_/, '').trim();
}

type RatingsMap = Record<string, number>;
type Listener = (ratings: RatingsMap) => void;

let currentRatings: RatingsMap = {};
const listeners = new Set<Listener>();
let isLoaded = false;
let syncTimeout: any = null;

function notify() {
  const snapshot = { ...currentRatings };
  listeners.forEach((fn) => {
    try {
      fn(snapshot);
    } catch (_) {}
  });
}

async function loadRatings() {
  if (isLoaded) return;
  isLoaded = true;

  try {
    const local = await AsyncStorage.getItem(STORAGE_KEY);
    if (local) {
      try {
        currentRatings = { ...JSON.parse(local), ...currentRatings };
        notify();
      } catch (_) {}
    }
  } catch (_) {}

  // Intento de carga remota desde Supabase
  try {
    const userRes = await supabase.auth.getUser();
    const email = userRes?.data?.user?.email?.trim();
    const clienteParam = email ? `cliente=eq.${encodeURIComponent(email)}&` : '';
    const resp = await fetch(
      `${BASE_URL}/rest/v1/events?${clienteParam}tipo=eq.youthink_song_ratings&select=id,notas&order=id.desc&limit=1`,
      {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
      }
    );
    if (resp.ok) {
      const rows = await resp.json();
      if (Array.isArray(rows) && rows.length > 0 && rows[0].notas) {
        try {
          const remoteMap = JSON.parse(rows[0].notas);
          if (typeof remoteMap === 'object' && remoteMap !== null) {
            currentRatings = { ...remoteMap, ...currentRatings };
            await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(currentRatings));
            notify();
          }
        } catch (_) {}
      }
    }
  } catch (_) {}
}

async function scheduleRemoteSync() {
  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(async () => {
    try {
      const userRes = await supabase.auth.getUser();
      const email = userRes?.data?.user?.email?.trim() || 'anon';
      const clienteParam = email !== 'anon' ? `cliente=eq.${encodeURIComponent(email)}&` : '';

      const check = await fetch(
        `${BASE_URL}/rest/v1/events?${clienteParam}tipo=eq.youthink_song_ratings&select=id&limit=1`,
        {
          headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
        }
      );
      const rows = check.ok ? await check.json() : [];
      const payload = {
        titulo: `Calificaciones de ${email}`,
        cliente: email,
        notas: JSON.stringify(currentRatings),
        fecha: new Date().toISOString().slice(0, 10),
        estado: 'finalizado',
        hora: '00:00',
        tipo: 'youthink_song_ratings',
        precio: 0,
      };

      if (Array.isArray(rows) && rows.length > 0) {
        await fetch(`${BASE_URL}/rest/v1/events?id=eq.${rows[0].id}`, {
          method: 'PATCH',
          headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ notas: JSON.stringify(currentRatings) }),
        });
      } else {
        await fetch(`${BASE_URL}/rest/v1/events`, {
          method: 'POST',
          headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
    } catch (_) {}
  }, 2000);
}

// Iniciar carga en segundo plano
loadRatings();

export const ratingsStore = {
  getState(): RatingsMap {
    return currentRatings;
  },

  getRating(trackId?: string | null): number {
    const key = normalizeTrackKey(trackId);
    if (!key) return 0;
    return currentRatings[key] || 0;
  },

  async setRating(trackId: string, stars: number): Promise<number> {
    const key = normalizeTrackKey(trackId);
    if (!key) return 0;

    const current = currentRatings[key] || 0;
    // Si presiona la misma estrella, se desmarca (0 estrellas)
    const newRating = current === stars ? 0 : Math.max(1, Math.min(5, stars));

    if (newRating === 0) {
      delete currentRatings[key];
    } else {
      currentRatings[key] = newRating;
    }

    notify();

    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(currentRatings));
    } catch (_) {}

    scheduleRemoteSync();
    return newRating;
  },

  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    fn({ ...currentRatings });
    return () => {
      listeners.delete(fn);
    };
  },
};

export function useRatings() {
  const [ratings, setRatings] = useState<RatingsMap>(ratingsStore.getState());

  useEffect(() => {
    return ratingsStore.subscribe((next) => {
      setRatings(next);
    });
  }, []);

  return {
    ratings,
    getRating: (id?: string | null) => {
      const key = normalizeTrackKey(id);
      return key ? ratings[key] || 0 : 0;
    },
    setRating: (id: string, stars: number) => ratingsStore.setRating(id, stars),
  };
}
