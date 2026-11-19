import React from 'react';
import { View, Text, Pressable, StyleSheet, Platform, StyleProp, ViewStyle, TextStyle } from 'react-native';
import { theme } from '../theme';
import { ratingsStore, useRatings, normalizeTrackKey } from '../lib/ratingsStore';

interface StarRatingProps {
  trackId?: string | null;
  rating?: number;
  onRate?: (stars: number) => void;
  size?: number;
  interactive?: boolean;
  showNumber?: boolean;
  showLabel?: boolean;
  style?: StyleProp<ViewStyle>;
  starStyle?: StyleProp<TextStyle>;
  maxStars?: number;
}

export default function StarRating({
  trackId,
  rating: explicitRating,
  onRate,
  size = 22,
  interactive = true,
  showNumber = false,
  showLabel = false,
  style,
  starStyle,
  maxStars = 3,
}: StarRatingProps) {
  const { ratings, setRating } = useRatings();

  const key = normalizeTrackKey(trackId);
  const currentRating = explicitRating !== undefined
    ? explicitRating
    : (key ? ratings[key] || 0 : 0);

  const handlePress = (stars: number) => {
    if (!interactive) return;
    if (onRate) {
      onRate(stars);
    } else if (key) {
      setRating(key, stars);
    }
  };

  return (
    <View style={[styles.container, style]}>
      {showLabel ? (
        <Text style={styles.label}>Calificación:</Text>
      ) : null}
      <View style={styles.starsRow}>
        {[1, 2, 3].map((star) => {
          const isFilled = currentRating >= star;
          return (
            <Pressable
              key={star}
              focusable={Platform.isTV}
              disabled={!interactive}
              onPress={() => handlePress(star)}
              hitSlop={interactive ? 6 : 0}
              style={[styles.starBtn, { paddingHorizontal: size >= 20 ? 3 : 1 }]}
            >
              <Text
                style={[
                  styles.starText,
                  { fontSize: size },
                  isFilled ? styles.starFilled : styles.starEmpty,
                  starStyle,
                ]}
              >
                {isFilled ? '★' : '☆'}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {showNumber && currentRating > 0 ? (
        <Text style={[styles.ratingNumber, { fontSize: Math.max(11, size - 8) }]}>
          {currentRating}/3
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    color: theme.colors.textDim,
    fontSize: 12,
    fontWeight: '600',
    marginRight: 4,
  },
  starsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  starBtn: {
    paddingVertical: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  starText: {
    textAlign: 'center',
  },
  starFilled: {
    color: theme.colors.gold,
    textShadowColor: 'rgba(229, 178, 31, 0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  starEmpty: {
    color: 'rgba(255, 255, 255, 0.25)',
  },
  ratingNumber: {
    color: theme.colors.gold,
    fontWeight: '700',
    marginLeft: 4,
  },
});
