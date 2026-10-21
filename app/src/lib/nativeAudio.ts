import { useMemo } from 'react';
import { Platform } from 'react-native';
import QpAudio from '../../modules/qp-audio/src/QpAudioModule';

// En Android reproducimos el audio con el reproductor nativo (NewPipe + Media3):
// sin anuncios, en segundo plano y con ecualizador real.
export const NATIVE_AUDIO = Platform.OS === 'android';

// Comandos del reproductor nativo. El estado llega por eventos (QpAudio.addListener).
export function useNativeAudio() {
  return useMemo(
    () => ({
      play: (videoId: string, title: string) => QpAudio.play(videoId, title),
      toggle: () => QpAudio.togglePlay(),
      pause: () => QpAudio.pause(),
      resume: () => QpAudio.resume(),
      seek: (seconds: number) => QpAudio.seek(seconds),
      stop: () => QpAudio.stop(),
      setEq: (preset: string) => QpAudio.setEq(preset),
    }),
    [],
  );
}
