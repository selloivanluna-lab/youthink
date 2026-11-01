import React from 'react';
import { CastButton } from 'react-native-google-cast';

/**
 * Botón nativo de Chromecast.
 *
 * Vive en un archivo aparte para que `react-native-google-cast` solo se evalúe
 * en Android: la pantalla lo carga con `require` condicional y en web el paquete
 * nunca se ejecuta (usa `requireNativeComponent`, que no existe en react-native-web).
 */
export default function CastButtonHost(props: { style?: any; tintColor?: string }) {
  return <CastButton {...props} />;
}
