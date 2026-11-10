import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DarkTheme, useNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Platform, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Buscar from './src/screens/Buscar';
import Radio from './src/screens/Radio';
import LibraryCrew from './src/screens/LibraryCrew';
import TapTempo from './src/screens/TapTempo';
import Placeholder from './src/screens/Placeholder';
import Sesion from './src/screens/Sesion';
// MiniPlayerGlobal: solo en nativo y solo cuando NO estamos en la tab Play
// (en web el mini player vive dentro del portal de Buscar.tsx para mantener el iframe vivo)
import MiniPlayerGlobal from './src/components/MiniPlayerGlobal';
import { theme } from './src/theme';

const Tab = createBottomTabNavigator();

function Descargas() {
  return <Placeholder title="Descargas" emoji="⬇️" nota="Biblioteca offline (expo-file-system) — Fase 5." />;
}

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: theme.colors.bg,
    card: theme.colors.surface,
    text: theme.colors.text,
    primary: theme.colors.gold,
    border: theme.colors.border,
  },
};

export default function App() {
  const [initialTab, setInitialTab] = useState<string>('Play');
  const [currentTab, setCurrentTab] = useState<string>('Play');
  const navigationRef = useNavigationContainerRef();

  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const hash = window.location.hash || '';
      if (hash.includes('yt_token=') || hash.includes('access_token=')) {
        const clean = hash.startsWith('#') ? hash.slice(1) : hash;
        const p = new URLSearchParams(clean);
        const yt_token = p.get('yt_token');
        const yt_refresh = p.get('yt_refresh');
        if (yt_token) {
          AsyncStorage.setItem('qp_yt_access_token', yt_token).catch(() => {});
          if (yt_refresh) AsyncStorage.setItem('qp_yt_refresh_token', yt_refresh).catch(() => {});
          fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${yt_token}` },
          }).then(r => r.json()).then(info => {
            if (info && (info.email || info.name)) {
              AsyncStorage.setItem('qp_user_profile', JSON.stringify(info)).catch(() => {});
              if (info.email) AsyncStorage.setItem('qp_user_email', info.email).catch(() => {});
            }
          }).catch(() => {});
        }
        setInitialTab('Sesión');
      }
    }
  }, []);

  return (
    <SafeAreaProvider>
      <NavigationContainer ref={navigationRef} theme={navTheme}>
        <StatusBar style="light" />
        <View style={{ flex: 1 }}>
          <Tab.Navigator
            key={initialTab}
            initialRouteName={initialTab}
            screenOptions={{
              headerStyle: { backgroundColor: theme.colors.surface },
              headerTitleStyle: { color: theme.colors.text },
              tabBarStyle: {
                backgroundColor: theme.colors.surface,
                borderTopColor: theme.colors.border,
              },
              tabBarActiveTintColor: theme.colors.gold,
              tabBarInactiveTintColor: theme.colors.textDim,
            }}
            screenListeners={{
              state: () => {
                // Registrar tab activo para ocultar MiniPlayerGlobal en tab Play
                const route = navigationRef.getCurrentRoute() as { name?: string } | undefined;
                if (route?.name) setCurrentTab(route.name);
              },
            }}
          >
            <Tab.Screen
              name="Play"
              component={Buscar}
              options={{ title: 'Play', tabBarLabel: 'Play', tabBarIcon: () => <Text style={{ fontSize: 18 }}>▶️</Text> }}
            />
            <Tab.Screen name="Radio" component={Radio} options={{ tabBarIcon: () => <Text>📻</Text> }} />
            <Tab.Screen
              name="Tap Tempo"
              component={TapTempo}
              options={{ title: 'Tap Tempo', tabBarLabel: 'Tempo', tabBarIcon: () => <Text>🥁</Text> }}
            />
            <Tab.Screen
              name="Library Crew"
              component={LibraryCrew}
              options={{ tabBarIcon: () => <Text>👥</Text> }}
            />
            <Tab.Screen name="Descargas" component={Descargas} options={{ tabBarIcon: () => <Text>⬇️</Text> }} />
            <Tab.Screen name="Sesión" component={Sesion} options={{ tabBarIcon: () => <Text>👤</Text> }} />
          </Tab.Navigator>

          {/* Mini-reproductor global: visible en pestañas distintas a Play (nativo) y nunca en web */}
          {Platform.OS !== 'web' && currentTab !== 'Play' && (
            <MiniPlayerGlobal
              onPressExpand={() => {
                try { navigationRef.navigate('Play' as never); } catch (_) {}
              }}
            />
          )}
        </View>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
