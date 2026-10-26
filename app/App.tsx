import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text } from 'react-native';
import Buscar from './src/screens/Buscar';
import Radio from './src/screens/Radio';
import LibraryCrew from './src/screens/LibraryCrew';
import Placeholder from './src/screens/Placeholder';
import Sesion from './src/screens/Sesion';
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
  return (
    <SafeAreaProvider>
      <NavigationContainer theme={navTheme}>
        <StatusBar style="light" />
        <Tab.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: theme.colors.surface },
            headerTitleStyle: { color: theme.colors.text },
            tabBarStyle: { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border },
            tabBarActiveTintColor: theme.colors.gold,
            tabBarInactiveTintColor: theme.colors.textDim,
          }}
        >
          <Tab.Screen
            name="Buscar"
            component={Buscar}
            options={{ tabBarIcon: () => <Text>🔎</Text> }}
          />
          <Tab.Screen name="Radio" component={Radio} options={{ tabBarIcon: () => <Text>📻</Text> }} />
          <Tab.Screen
            name="Library Crew"
            component={LibraryCrew}
            options={{ tabBarIcon: () => <Text>👥</Text> }}
          />
          <Tab.Screen name="Descargas" component={Descargas} options={{ tabBarIcon: () => <Text>⬇️</Text> }} />
          <Tab.Screen name="Sesión" component={Sesion} options={{ tabBarIcon: () => <Text>👤</Text> }} />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
