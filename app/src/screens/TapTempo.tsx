import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { theme } from '../theme';

interface TempoInfo {
  nombre: string;
  rango: string;
  generos: string;
  descripcion: string;
}

function clasificarTempo(bpm: number): TempoInfo {
  if (bpm <= 0) {
    return {
      nombre: 'Esperando pulsaciones…',
      rango: '0 BPM',
      generos: 'Tocá al ritmo para medir',
      descripcion: 'Hacé al menos 3 o 4 toques constantes.',
    };
  }
  if (bpm < 60) {
    return {
      nombre: 'Largo / Grave',
      rango: '< 60 BPM',
      generos: 'Baladas lentas, Ambient, Doom',
      descripcion: 'Tempo sumamente lento y solemne.',
    };
  }
  if (bpm < 76) {
    return {
      nombre: 'Adagio / Larghetto',
      rango: '60 – 76 BPM',
      generos: 'Soul lento, R&B clásico, Blues',
      descripcion: 'Tempo lento y reposado.',
    };
  }
  if (bpm < 108) {
    return {
      nombre: 'Andante',
      rango: '76 – 108 BPM',
      generos: 'Hip-Hop (~85-95), Reggaeton (~90-96), R&B, Trap',
      descripcion: 'Tempo tranquilo, al paso natural.',
    };
  }
  if (bpm < 120) {
    return {
      nombre: 'Moderato',
      rango: '108 – 120 BPM',
      generos: 'Pop, Disco, Funk, Cumbia',
      descripcion: 'Tempo moderado y bailable.',
    };
  }
  if (bpm < 156) {
    return {
      nombre: 'Allegro',
      rango: '120 – 156 BPM',
      generos: 'House (~124-128), Tech (~130), Rock, Pop animado',
      descripcion: 'Tempo rápido, alegre y lleno de energía.',
    };
  }
  if (bpm < 176) {
    return {
      nombre: 'Vivace',
      rango: '156 – 176 BPM',
      generos: 'Punk, Hard Rock, Techno acelerado',
      descripcion: 'Tempo vivo, muy rápido y constante.',
    };
  }
  return {
    nombre: 'Presto / Prestissimo',
    rango: '176+ BPM',
    generos: 'Drum & Bass (~174), Jungle, Speed Metal, Hardcore',
    descripcion: 'Velocidad máxima, frenético.',
  };
}

export default function TapTempo() {
  const navigation = useNavigation<any>();
  const [bpm, setBpm] = useState<number>(0);
  const [tapCount, setTapCount] = useState<number>(0);
  const [msInterval, setMsInterval] = useState<number>(0);
  const [metronomoActivo, setMetronomoActivo] = useState(false);
  const [targetBpmInput, setTargetBpmInput] = useState('');
  const [speedRatio, setSpeedRatio] = useState<number>(1);

  // Historial de tiempos de tap
  const tapTimesRef = useRef<number[]>([]);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Animación del botón de tap
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const pulseAnim = useRef(new Animated.Value(0)).current;

  // Web Audio Context para metrónomo
  const audioCtxRef = useRef<any>(null);
  const metronomeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function reproducirClick(accent = false) {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      if (!audioCtxRef.current) audioCtxRef.current = new AC();
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(accent ? 1200 : 800, ctx.currentTime);

      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.05);
    } catch (_) {}
  }

  // Manejar el tap
  function handleTap() {
    const now = Date.now();
    const history = tapTimesRef.current;

    // Reset si pasaron más de 2.5 segundos desde el último toque
    if (history.length > 0 && now - history[history.length - 1] > 2500) {
      history.length = 0;
    }

    history.push(now);
    if (history.length > 8) history.shift();

    // Animación visual
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.92, duration: 60, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1, duration: 90, useNativeDriver: true }),
    ]).start();

    pulseAnim.setValue(1);
    Animated.timing(pulseAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start();

    if (history.length >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < history.length; i++) {
        intervals.push(history[i] - history[i - 1]);
      }
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const calculatedBpm = Math.round((60000 / avgInterval) * 10) / 10;
      setBpm(calculatedBpm);
      setMsInterval(Math.round(avgInterval));
      setTapCount(history.length);

      // Calcular ratio de velocidad si hay un target ingresado
      const target = parseFloat(targetBpmInput);
      if (target > 0 && calculatedBpm > 0) {
        setSpeedRatio(Math.round((target / calculatedBpm) * 100) / 100);
      }
    } else {
      setTapCount(1);
    }

    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => {
      // Dejar el último BPM registrado pero reiniciar el conteo para el próximo intento
      tapTimesRef.current = [];
    }, 3000);
  }

  // Reiniciar
  function resetear() {
    tapTimesRef.current = [];
    setBpm(0);
    setTapCount(0);
    setMsInterval(0);
    setSpeedRatio(1);
    if (metronomoActivo) toggleMetronomo(false);
  }

  // Ajustes de tempo manuales
  function ajustarBpm(delta: number) {
    const nuevo = Math.max(20, Math.min(300, Math.round((bpm || 120) + delta)));
    setBpm(nuevo);
    setMsInterval(Math.round(60000 / nuevo));
  }

  function multiplicarTempo(factor: number) {
    if (!bpm) return;
    const nuevo = Math.max(20, Math.min(300, Math.round(bpm * factor)));
    setBpm(nuevo);
    setMsInterval(Math.round(60000 / nuevo));
  }

  // Metrónomo en tiempo real
  function toggleMetronomo(forzar?: boolean) {
    const nuevo = typeof forzar === 'boolean' ? forzar : !metronomoActivo;
    setMetronomoActivo(nuevo);
    if (!nuevo) {
      if (metronomeTimerRef.current) clearInterval(metronomeTimerRef.current);
      metronomeTimerRef.current = null;
    }
  }

  useEffect(() => {
    if (metronomoActivo && bpm > 0) {
      if (metronomeTimerRef.current) clearInterval(metronomeTimerRef.current);
      const interval = (60 / bpm) * 1000;
      let count = 0;
      metronomeTimerRef.current = setInterval(() => {
        reproducirClick(count % 4 === 0);
        pulseAnim.setValue(1);
        Animated.timing(pulseAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
        count++;
      }, interval);
    } else {
      if (metronomeTimerRef.current) {
        clearInterval(metronomeTimerRef.current);
        metronomeTimerRef.current = null;
      }
    }
    return () => {
      if (metronomeTimerRef.current) clearInterval(metronomeTimerRef.current);
    };
  }, [metronomoActivo, bpm]);

  // Actualizar cálculo de velocidad cuando cambia el target
  function handleTargetChange(val: string) {
    setTargetBpmInput(val);
    const target = parseFloat(val);
    if (target > 0 && bpm > 0) {
      setSpeedRatio(Math.round((target / bpm) * 100) / 100);
    } else {
      setSpeedRatio(1);
    }
  }

  // Aplicar velocidad calculada al reproductor
  async function aplicarVelocidadAlReproductor(speed: number) {
    const sVal = Math.max(0.25, Math.min(2.0, Math.round(speed * 100) / 100));
    try {
      await AsyncStorage.setItem('qp_playback_speed', sVal.toString());
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const iframe = ((globalThis as any).document?.getElementById('yt-player-iframe') || (globalThis as any).document?.querySelector('iframe')) as HTMLIFrameElement | null;
        if (iframe?.contentWindow) {
          iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'setPlaybackRate', args: [sVal] }), '*');
        }
      }
      Alert.alert(
        'Velocidad actualizada',
        `Se configuró la velocidad en ${sVal}x en el reproductor.`,
        [{ text: 'Ir a Reproducción', onPress: () => navigation.navigate('Buscar', { autoSetSpeed: sVal }) }, { text: 'Quedarme aquí' }]
      );
    } catch (_) {}
  }

  const info = clasificarTempo(bpm);

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      {/* Título y subtítulo */}
      <View style={s.header}>
        <Text style={s.title}>🥁 Tap Tempo & Sincronizador</Text>
        <Text style={s.sub}>
          Medí el tempo (BPM) de cualquier pista y calculá el ajuste exacto de velocidad.
        </Text>
      </View>

      {/* Pantalla Display de BPM */}
      <View style={s.displayCard}>
        <Animated.View
          style={[
            s.pulseIndicator,
            {
              opacity: pulseAnim,
              transform: [{ scale: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.4] }) }],
            },
          ]}
        />
        <Text style={s.bpmNumber}>{bpm > 0 ? (bpm % 1 === 0 ? bpm.toFixed(0) : bpm.toFixed(1)) : '--'}</Text>
        <Text style={s.bpmUnit}>BPM (BEATS POR MINUTO)</Text>

        <View style={s.statsRow}>
          <Text style={s.statText}>
            ⏱️ {msInterval > 0 ? `${msInterval} ms` : '— ms'}
          </Text>
          <Text style={s.statText}>
            👆 {tapCount > 0 ? `${tapCount} toques` : '0 toques'}
          </Text>
        </View>
      </View>

      {/* Botón Gigante de TAP */}
      <Animated.View style={{ transform: [{ scale: scaleAnim }], width: '100%', alignItems: 'center' }}>
        <Pressable style={s.tapButton} onPress={handleTap}>
          <Text style={s.tapButtonIcon}>🥁</Text>
          <Text style={s.tapButtonText}>TAP TEMPO</Text>
          <Text style={s.tapButtonSub}>Tocá al ritmo aquí</Text>
        </Pressable>
      </Animated.View>

      {/* Acciones de tempo: Reset, +1, -1, x2, /2 */}
      <View style={s.controlsRow}>
        <Pressable style={s.smallBtn} onPress={() => ajustarBpm(-1)}>
          <Text style={s.smallBtnText}>-1</Text>
        </Pressable>
        <Pressable style={s.smallBtn} onPress={() => ajustarBpm(-5)}>
          <Text style={s.smallBtnText}>-5</Text>
        </Pressable>
        <Pressable style={[s.smallBtn, s.resetBtn]} onPress={resetear}>
          <Text style={s.resetBtnText}>🔄 Reset</Text>
        </Pressable>
        <Pressable style={s.smallBtn} onPress={() => ajustarBpm(+5)}>
          <Text style={s.smallBtnText}>+5</Text>
        </Pressable>
        <Pressable style={s.smallBtn} onPress={() => ajustarBpm(+1)}>
          <Text style={s.smallBtnText}>+1</Text>
        </Pressable>
      </View>

      <View style={s.doubleHalfRow}>
        <Pressable style={s.halfBtn} onPress={() => multiplicarTempo(0.5)}>
          <Text style={s.halfBtnText}>½ Tempo (Half)</Text>
        </Pressable>
        <Pressable style={s.halfBtn} onPress={() => multiplicarTempo(2)}>
          <Text style={s.halfBtnText}>2× Tempo (Double)</Text>
        </Pressable>
        <Pressable
          style={[s.halfBtn, metronomoActivo && s.metroActiveBtn]}
          onPress={() => toggleMetronomo()}
        >
          <Text style={[s.halfBtnText, metronomoActivo && { color: '#000', fontWeight: '800' }]}>
            {metronomoActivo ? '🔊 Clic Activo' : '🔇 Metrónomo'}
          </Text>
        </Pressable>
      </View>

      {/* Ficha de Clasificación Musical y Géneros */}
      <View style={s.card}>
        <View style={s.cardHead}>
          <Text style={s.cardTitle}>🎼 Clasificación de Tempo</Text>
          <Text style={s.cardBadge}>{info.rango}</Text>
        </View>
        <Text style={s.tempoName}>{info.nombre}</Text>
        <Text style={s.tempoDesc}>{info.descripcion}</Text>
        <View style={s.divider} />
        <Text style={s.genreLabel}>🎧 Géneros afines:</Text>
        <Text style={s.genreText}>{info.generos}</Text>
      </View>

      {/* Calculador de Ajuste de Velocidad (Speed Match) */}
      <View style={s.card}>
        <Text style={s.cardTitle}>⚡ Sincronizador de Velocidad para Reproducción</Text>
        <Text style={s.calcSub}>
          Ingresá a cuántos BPM querés llevar la canción para calcular el factor de aceleración/desaceleración exacto.
        </Text>

        <View style={s.calcInputRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.inputLabel}>BPM Original (Detectado)</Text>
            <View style={s.readOnlyInput}>
              <Text style={s.readOnlyText}>{bpm > 0 ? bpm.toFixed(0) : 'Pendiente'}</Text>
            </View>
          </View>
          <Text style={s.arrowText}>➔</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.inputLabel}>BPM Deseado</Text>
            <TextInput
              style={s.calcInput}
              keyboardType="numeric"
              placeholder="Ej: 128"
              placeholderTextColor={theme.colors.textDim}
              value={targetBpmInput}
              onChangeText={handleTargetChange}
            />
          </View>
        </View>

        {bpm > 0 && parseFloat(targetBpmInput) > 0 ? (
          <View style={s.resultBox}>
            <Text style={s.resultLabel}>Factor de velocidad resultante:</Text>
            <Text style={s.resultValue}>{speedRatio}x</Text>
            <Text style={s.resultDiff}>
              {speedRatio > 1
                ? `Acelera un +${Math.round((speedRatio - 1) * 100)}%`
                : speedRatio < 1
                ? `Desacelera un -${Math.round((1 - speedRatio) * 100)}%`
                : 'Mismo tempo (100%)'}
            </Text>
            <Pressable
              style={s.applyBtn}
              onPress={() => aplicarVelocidadAlReproductor(speedRatio)}
            >
              <Text style={s.applyBtnText}>⚡ Aplicar {speedRatio}x al Reproductor</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Presets rápidos de velocidad */}
        <Text style={[s.genreLabel, { marginTop: 14 }]}>Atajos de velocidad directa:</Text>
        <View style={s.presetGrid}>
          {[0.75, 0.85, 0.9, 1.0, 1.1, 1.15, 1.25, 1.5].map((rate) => (
            <Pressable
              key={rate}
              style={s.presetChip}
              onPress={() => aplicarVelocidadAlReproductor(rate)}
            >
              <Text style={s.presetChipText}>{rate}x</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg },
  content: { padding: 16, paddingBottom: 60, gap: 16 },
  header: { marginBottom: 4 },
  title: { color: theme.colors.text, fontSize: 22, fontWeight: '800' },
  sub: { color: theme.colors.textDim, fontSize: 13, marginTop: 4 },
  displayCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.colors.gold,
    paddingVertical: 28,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  pulseIndicator: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(229, 178, 31, 0.15)',
  },
  bpmNumber: {
    color: theme.colors.gold,
    fontSize: 64,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    letterSpacing: -1,
  },
  bpmUnit: {
    color: theme.colors.textDim,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    marginTop: 2,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 20,
    marginTop: 14,
    backgroundColor: theme.colors.surface2,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statText: { color: theme.colors.text, fontSize: 12, fontWeight: '600' },
  tapButton: {
    width: '100%',
    maxWidth: 340,
    height: 120,
    borderRadius: 24,
    backgroundColor: theme.colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: theme.colors.gold,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
  },
  tapButtonIcon: { fontSize: 26 },
  tapButtonText: { color: '#111', fontSize: 20, fontWeight: '900', letterSpacing: 1 },
  tapButtonSub: { color: '#333', fontSize: 11, fontWeight: '700', marginTop: 2 },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  smallBtn: {
    backgroundColor: theme.colors.surface2,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  smallBtnText: { color: theme.colors.text, fontWeight: '700', fontSize: 13 },
  resetBtn: { backgroundColor: 'rgba(229, 72, 77, 0.15)', borderColor: 'rgba(229, 72, 77, 0.3)' },
  resetBtnText: { color: theme.colors.danger, fontWeight: '700', fontSize: 13 },
  doubleHalfRow: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
  },
  halfBtn: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingVertical: 10,
    alignItems: 'center',
  },
  halfBtnText: { color: theme.colors.textDim, fontSize: 12, fontWeight: '700' },
  metroActiveBtn: { backgroundColor: theme.colors.gold, borderColor: theme.colors.gold },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { color: theme.colors.text, fontSize: 15, fontWeight: '700' },
  cardBadge: {
    backgroundColor: theme.colors.surface2,
    color: theme.colors.gold,
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  tempoName: { color: theme.colors.gold, fontSize: 20, fontWeight: '800', marginTop: 8 },
  tempoDesc: { color: theme.colors.textDim, fontSize: 13, marginTop: 4 },
  divider: { height: 1, backgroundColor: theme.colors.border, marginVertical: 12 },
  genreLabel: { color: theme.colors.text, fontSize: 12, fontWeight: '700', marginBottom: 4 },
  genreText: { color: theme.colors.textDim, fontSize: 13 },
  calcSub: { color: theme.colors.textDim, fontSize: 12, marginTop: 4, marginBottom: 12 },
  calcInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  inputLabel: { color: theme.colors.textDim, fontSize: 11, fontWeight: '600', marginBottom: 4 },
  readOnlyInput: {
    backgroundColor: theme.colors.surface2,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  readOnlyText: { color: theme.colors.gold, fontSize: 15, fontWeight: '700' },
  arrowText: { color: theme.colors.gold, fontSize: 20, fontWeight: '700', marginTop: 14 },
  calcInput: {
    backgroundColor: theme.colors.surface2,
    color: theme.colors.text,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 15,
    fontWeight: '700',
    borderWidth: 1,
    borderColor: theme.colors.gold,
  },
  resultBox: {
    marginTop: 14,
    backgroundColor: theme.colors.surface2,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.gold,
    alignItems: 'center',
  },
  resultLabel: { color: theme.colors.textDim, fontSize: 12, fontWeight: '600' },
  resultValue: { color: theme.colors.gold, fontSize: 32, fontWeight: '900', marginVertical: 4 },
  resultDiff: { color: theme.colors.text, fontSize: 12, fontWeight: '600', marginBottom: 10 },
  applyBtn: {
    backgroundColor: theme.colors.gold,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    width: '100%',
    alignItems: 'center',
  },
  applyBtnText: { color: '#111', fontSize: 14, fontWeight: '800' },
  presetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  presetChip: {
    backgroundColor: theme.colors.surface2,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  presetChipText: { color: theme.colors.gold, fontSize: 13, fontWeight: '700' },
});
