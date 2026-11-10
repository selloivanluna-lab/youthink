import React, { useEffect, useState } from 'react';
import {
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { playerStore, PlayerState } from '../lib/playerStore';
import { theme } from '../theme';
import MarqueeText from './MarqueeText';

interface MiniPlayerGlobalProps {
  onPressExpand?: () => void;
}

export default function MiniPlayerGlobal({ onPressExpand }: MiniPlayerGlobalProps) {
  const [state, setState] = useState<PlayerState>(playerStore.getState());

  useEffect(() => {
    return playerStore.subscribe((next) => {
      setState(next);
    });
  }, []);

  const { actual, reproduciendo, playerVisible } = state;

  if (playerVisible || !actual) {
    return null;
  }

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
              bottom: 64,
              left: 10,
              right: 10,
              maxWidth: 720,
              marginHorizontal: 'auto',
              zIndex: 99999,
            } as any)
          : {
              position: 'absolute',
              bottom: 60,
              left: 8,
              right: 8,
              zIndex: 9999,
            },
      ]}
    >
      <Pressable
        focusable={true}
        style={s.touchable}
        onPress={handleExpand}
      >
        {actual.thumb ? (
          <Image
            source={{ uri: actual.thumb }}
            style={s.thumb}
          />
        ) : (
          <View style={[s.thumb, { backgroundColor: '#111' }]} />
        )}

        <View style={s.info}>
          <MarqueeText
            text={actual.title || 'Reproduciendo'}
            style={s.title}
            speed={35}
          />
          <Text style={s.artist} numberOfLines={1}>
            {actual.channel || 'YouThink Music'}
          </Text>
        </View>

        <Pressable
          focusable={true}
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
          focusable={true}
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
