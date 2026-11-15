import React, { useEffect, useState } from 'react';
import {
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { playerStore, PlayerState } from '../lib/playerStore';
import { theme } from '../theme';
import { useRatings } from '../lib/ratingsStore';
import MarqueeText from './MarqueeText';

interface MiniPlayerGlobalProps {
  onPressExpand?: () => void;
  currentTab?: string;
}

// Altura por defecto de la barra de pestañas de React Navigation (bottom-tabs v6)
const TAB_BAR_HEIGHT = 49;

export default function MiniPlayerGlobal({ onPressExpand, currentTab }: MiniPlayerGlobalProps) {
  const [state, setState] = useState<PlayerState>(playerStore.getState());
  const insets = useSafeAreaInsets();
  const { getRating } = useRatings();

  useEffect(() => {
    return playerStore.subscribe((next) => {
      setState(next);
    });
  }, []);

  const { actual, reproduciendo, playerVisible } = state;

  if (playerVisible || !actual) {
    return null;
  }

  const currentActiveTab = state.activeTab || currentTab;

  // Si suena Library Crew y estamos dentro de la pestaña Library Crew,
  // la propia pantalla ya muestra su barra completa con seekbar y ecualizador.
  if (actual.source === 'crew' && currentActiveTab === 'Library Crew') {
    return null;
  }

  // En Web, si la fuente NO es 'crew' ni 'download', el miniplayer de YouTube lo renderiza el portal
  // persistente de Buscar.tsx para mantener el iframe montado sin duplicar la interfaz.
  // En cambio en Android nativo, MiniPlayerGlobal es el ÚNICO miniplayer y debe estar visible siempre al minimizar.
  if (Platform.OS === 'web' && actual.source !== 'crew' && actual.source !== 'download') {
    return null;
  }

  // El miniplayer debe flotar POR ENCIMA de la barra de pestañas en cualquier
  // dispositivo: la tab bar mide 49px + el inset inferior del sistema (gestos
  // Android ~24-48px o home indicator de iPhone ~34px). Sin el inset, el
  // miniplayer termina pisando los botones Play/Radio/Tempo en teléfonos
  // con navegación por gestos.
  const bottomOffset = Platform.OS === 'web'
    ? 86
    : TAB_BAR_HEIGHT + insets.bottom + 12;

  const handleExpand = () => {
    if (onPressExpand) onPressExpand();
    playerStore.abrirPlayer();
  };

  return (
    <View
      style={[
        s.container,
        Platform.OS === 'web'
          ? ({
              position: 'fixed',
              bottom: bottomOffset,
              left: 12,
              right: 12,
              maxWidth: 720,
              marginHorizontal: 'auto',
              zIndex: 99999,
            } as any)
          : {
              position: 'absolute',
              bottom: bottomOffset,
              left: 10,
              right: 10,
              zIndex: 9999,
            },
      ]}
    >
      <Pressable
        focusable={Platform.isTV}
        style={s.touchable}
        onPress={handleExpand}
      >
        {actual.thumb ? (
          <Image
            source={{ uri: actual.thumb }}
            style={s.thumb}
          />
        ) : (
          <View style={[s.thumb, { backgroundColor: '#181e26', alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={{ fontSize: 20 }}>👥</Text>
          </View>
        )}

        <View style={s.info}>
          <MarqueeText
            text={actual.title || 'Reproduciendo'}
            style={s.title}
            speed={35}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={[s.artist, { flexShrink: 1 }]} numberOfLines={1}>
              {actual.channel || 'YouThink Music'}
            </Text>
            {getRating(actual.id) > 0 ? (
              <Text style={{ color: theme.colors.gold, fontSize: 11, fontWeight: '700' }}>
                ★ {getRating(actual.id)}
              </Text>
            ) : null}
          </View>
        </View>

        <Pressable
          focusable={Platform.isTV}
          style={s.btn}
          onPress={(e) => {
            e.stopPropagation?.();
            playerStore.togglePlay();
          }}
          hitSlop={8}
        >
          <Text style={s.btnIcon}>{reproduciendo ? '⏸' : '▶'}</Text>
        </Pressable>

        <Pressable
          focusable={Platform.isTV}
          style={s.btn}
          onPress={(e) => {
            e.stopPropagation?.();
            playerStore.cerrar();
          }}
          hitSlop={8}
        >
          <Text style={s.closeIcon}>✕</Text>
        </Pressable>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(20, 24, 28, 0.96)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(229, 178, 31, 0.35)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 8,
  },
  touchable: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    gap: 10,
  },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#000',
  },
  info: {
    flex: 1,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  title: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  artist: {
    color: theme.colors.textDim,
    fontSize: 11,
    marginTop: 2,
  },
  btn: {
    padding: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnIcon: {
    color: theme.colors.gold,
    fontSize: 20,
    fontWeight: '800',
  },
  closeIcon: {
    color: theme.colors.textDim,
    fontSize: 16,
    fontWeight: '700',
  },
});
