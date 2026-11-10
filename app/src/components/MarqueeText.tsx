import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Platform,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
} from 'react-native';

interface MarqueeTextProps {
  text: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  speed?: number; // píxeles por segundo
  delayMs?: number;
}

export default function MarqueeText({
  text,
  style,
  numberOfLines = 1,
  speed = 35,
  delayMs = 1200,
}: MarqueeTextProps) {
  const [containerWidth, setContainerWidth] = useState(0);
  const [textWidth, setTextWidth] = useState(0);
  const animatedX = useRef(new Animated.Value(0)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  const needsScroll = textWidth > containerWidth && containerWidth > 0;

  useEffect(() => {
    if (!needsScroll) {
      animatedX.setValue(0);
      if (animRef.current) animRef.current.stop();
      return;
    }

    const distance = textWidth - containerWidth + 24;
    const duration = (distance / speed) * 1000;

    const anim = Animated.loop(
      Animated.sequence([
        Animated.delay(delayMs),
        Animated.timing(animatedX, {
          toValue: -distance,
          duration,
          easing: Easing.linear,
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.delay(1000),
        Animated.timing(animatedX, {
          toValue: 0,
          duration: 600,
          easing: Easing.out(Easing.quad),
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.delay(delayMs),
      ])
    );

    animRef.current = anim;
    anim.start();

    return () => {
      anim.stop();
    };
  }, [needsScroll, textWidth, containerWidth, speed, delayMs]);

  // En Web podemos optimizar con scroll horizontal o CSS, pero la animación Animated funciona cross-platform.
  return (
    <View
      style={styles.container}
      onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
    >
      <Animated.View
        style={[
          styles.animatedWrapper,
          needsScroll ? { transform: [{ translateX: animatedX }] } : null,
        ]}
      >
        <Text
          style={[style, styles.noWrap]}
          numberOfLines={needsScroll ? 1 : numberOfLines}
          onLayout={(e) => setTextWidth(e.nativeEvent.layout.width)}
        >
          {text}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    width: '100%',
    justifyContent: 'center',
  },
  animatedWrapper: {
    flexDirection: 'row',
  },
  noWrap: {
    flexShrink: 0,
  },
});
