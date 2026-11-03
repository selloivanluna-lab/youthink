import { useState, useCallback } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { theme } from '../theme';

/**
 * Hook para manejar foco de D-pad en elementos interactivos.
 * Retorna { focused, focusProps, focusStyle } para aplicar a Pressable/View.
 */
export function useTvFocus(extraFocusStyle?: StyleProp<ViewStyle>) {
  const [focused, setFocused] = useState(false);

  const onFocus = useCallback(() => setFocused(true), []);
  const onBlur = useCallback(() => setFocused(false), []);

  const focusStyle: StyleProp<ViewStyle> = focused
    ? [
        { borderWidth: 2, borderColor: theme.colors.gold, borderRadius: 8, backgroundColor: 'rgba(229,178,31,0.12)' },
        extraFocusStyle,
      ]
    : [{ borderWidth: 2, borderColor: 'transparent', borderRadius: 8 }, extraFocusStyle];

  return {
    focused,
    focusProps: { onFocus, onBlur, focusable: true as const },
    focusStyle,
  };
}
