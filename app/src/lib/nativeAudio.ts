import { useMemo } from 'react';
import { Platform } from 'react-native';
import QpAudio from '../../modules/qp-audio/src/QpAudioModule';

// El reproductor nativo (NewPipe + Media3) sólo existe en Android y sólo si el
// módulo se registró de verdad. Nunca lo damos por disponible "a ciegas": si no
// está, la pantalla usa el fallback (WebView de YouTube) en lugar de quedarse
// esperando eventos que jamás van a llegar.
export const NATIVE_AUDIO = Platform.OS === 'android' && QpAudio !== null;

const noop = () => Promise.resolve(true);

// Comandos del reproductor nativo. El estado llega por eventos (QpAudio.addListener).
export function useNativeAudio() {
  return useMemo(
    () => ({
      play: (videoId: string, title: string, artist?: string, artworkUri?: string) =>
        QpAudio ? QpAudio.play(videoId, title, artist, artworkUri) : noop(),
      toggle: () => (QpAudio ? QpAudio.togglePlay() : noop()),
      pause: () => (QpAudio ? QpAudio.pause() : noop()),
      resume: () => (QpAudio ? QpAudio.resume() : noop()),
      seek: (seconds: number) => (QpAudio ? QpAudio.seek(seconds) : noop()),
      stop: () => (QpAudio ? QpAudio.stop() : noop()),
      setEq: (preset: string) => (QpAudio ? QpAudio.setEq(preset) : noop()),
    }),
    [],
  );
}
