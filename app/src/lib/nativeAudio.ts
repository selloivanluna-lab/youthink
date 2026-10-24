import { useMemo } from 'react';
import { Platform } from 'react-native';
import QpAudio from '../../modules/qp-audio/src/QpAudioModule';

// En Android reproducimos el audio con el reproductor nativo (NewPipe + Media3).
// Si el módulo nativo no se pudo registrar (QpAudio === null), caemos al modo
// de audio por API sin crashear la app.
export const NATIVE_AUDIO = Platform.OS === 'android' && QpAudio !== null;

const noop = () => Promise.resolve(true);

// Comandos del reproductor nativo. El estado llega por eventos (QpAudio.addListener).
export function useNativeAudio() {
  return useMemo(
    () => ({
      play: (videoId: string, title: string) =>
        QpAudio ? QpAudio.play(videoId, title) : noop(),
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
