// app/src/lib/downloads.ts
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'qp_downloads_v1';

export type DownloadSource = 'youtube' | 'crew';

export interface DownloadedTrack {
  id: string;             // yt_id o crew track id
  title: string;
  artist: string;        // channel para youtube, uploader para crew
  thumb?: string;
  localPath: string;     // ruta local en FileSystem.documentDirectory
  fileSize?: number;     // bytes
  downloadedAt: string;  // ISO string
  source: DownloadSource;
  duration?: number;     // segundos
}

export async function getDownloads(): Promise<DownloadedTrack[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as DownloadedTrack[];
  } catch {
    return [];
  }
}

export async function saveDownloadMeta(track: DownloadedTrack): Promise<void> {
  const list = await getDownloads();
  const idx = list.findIndex((t) => t.id === track.id);
  if (idx >= 0) list[idx] = track;
  else list.unshift(track);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export async function deleteDownload(id: string): Promise<void> {
  if (Platform.OS !== 'web') {
    try {
      const FS = await import('expo-file-system/legacy');
      const list = await getDownloads();
      const track = list.find((t) => t.id === id);
      if (track?.localPath) {
        const info = await FS.getInfoAsync(track.localPath);
        if (info.exists) await FS.deleteAsync(track.localPath, { idempotent: true });
      }
    } catch {}
  }
  const list = await getDownloads();
  const updated = list.filter((t) => t.id !== id);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

export async function isDownloaded(id: string): Promise<string | null> {
  const list = await getDownloads();
  const track = list.find((t) => t.id === id);
  if (!track) return null;
  if (Platform.OS !== 'web') {
    try {
      const FS = await import('expo-file-system/legacy');
      const info = await FS.getInfoAsync(track.localPath);
      if (!info.exists) {
        // El archivo fue borrado externamente, limpiar metadata
        await deleteDownload(id);
        return null;
      }
    } catch {}
  }
  return track.localPath;
}

/**
 * Descarga un archivo al dispositivo usando expo-file-system/legacy.
 * onProgress: callback con progreso 0-1
 * Retorna la ruta local del archivo.
 */
export async function downloadFile(
  url: string,
  filename: string,
  meta: Omit<DownloadedTrack, 'localPath' | 'downloadedAt' | 'fileSize'>,
  onProgress?: (progress: number) => void,
): Promise<string> {
  if (Platform.OS === 'web') {
    onProgress?.(0.3);
    let blobUrl = url;
    let fileSize: number | undefined;

    if (url.startsWith('http')) {
      try {
        const resp = await fetch(url);
        if (!resp.ok) {
          let errJson: any;
          try { errJson = await resp.json(); } catch (_) {}
          throw new Error(errJson?.error || `Error HTTP ${resp.status} al descargar.`);
        }
        onProgress?.(0.7);
        const blob = await resp.blob();
        fileSize = blob.size;
        blobUrl = URL.createObjectURL(blob);
      } catch (err: any) {
        console.warn('[downloads.ts] fetch directo falló:', err);
        throw err;
      }
    }

    onProgress?.(0.9);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try { document.body.removeChild(a); } catch (_) {}
      if (blobUrl.startsWith('blob:')) {
        URL.revokeObjectURL(blobUrl);
      }
    }, 3000);

    onProgress?.(1);

    const savedPath = url.startsWith('http') ? url : `web://${filename}`;
    await saveDownloadMeta({
      ...meta,
      localPath: savedPath,
      fileSize,
      downloadedAt: new Date().toISOString(),
    });
    return savedPath;
  }

  const FS = await import('expo-file-system/legacy');
  const baseDir = FS.documentDirectory ?? '';
  const dir = baseDir + 'youthink_downloads/';
  const dirInfo = await FS.getInfoAsync(dir);
  if (!dirInfo.exists) {
    await FS.makeDirectoryAsync(dir, { intermediates: true });
  }

  const localPath = dir + filename;

  const callback = onProgress
    ? (d: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => {
        const p = d.totalBytesExpectedToWrite > 0
          ? d.totalBytesWritten / d.totalBytesExpectedToWrite
          : 0;
        onProgress(Math.min(p, 1));
      }
    : undefined;

  const downloadResumable = FS.createDownloadResumable(url, localPath, {}, callback);
  const result = await downloadResumable.downloadAsync();

  if (!result?.uri) throw new Error('Download failed — no URI returned');

  const info = await FS.getInfoAsync(result.uri);

  await saveDownloadMeta({
    ...meta,
    localPath: result.uri,
    fileSize: (info as any).size,
    downloadedAt: new Date().toISOString(),
  });

  return result.uri;
}
