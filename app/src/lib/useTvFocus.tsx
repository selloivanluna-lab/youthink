import React, { useState, useCallback } from 'react';
import { StyleProp, ViewStyle, Pressable, PressableProps } from 'react-native';
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
        {
          borderWidth: 3,
          borderColor: '#e5b21f',
          borderRadius: 8,
          backgroundColor: 'rgba(229,178,31,0.22)',
          shadowColor: '#e5b21f',
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.8,
          shadowRadius: 6,
          elevation: 8,
        },
        extraFocusStyle,
      ]
    : extraFocusStyle;

  return {
    focused,
    focusProps: { onFocus, onBlur, focusable: true as const },
    focusStyle,
  };
}

/**
 * Componente TvPressable de conveniencia con halo y borde amarillo automático
 */
export function TvPressable({
  style,
  children,
  onFocus,
  onBlur,
  ...props
}: PressableProps & { children?: any }) {
  const [focused, setFocused] = useState(false);

  return (
    <Pressable
      focusable={true}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      style={(state) => {
        const baseStyle = typeof style === 'function' ? style(state) : style;
        if (focused) {
          return [
            baseStyle,
            {
              borderWidth: 3,
              borderColor: '#e5b21f',
              backgroundColor: 'rgba(229,178,31,0.20)',
              elevation: 8,
            },
          ];
        }
        return baseStyle;
      }}
      {...props}
    >
      {children}
    </Pressable>
  );
}
