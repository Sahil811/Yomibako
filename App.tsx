import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useColorScheme } from 'react-native';
import AppNavigator from './src/navigation/AppNavigator';
import JpdbSessionWebView from './src/components/system/JpdbSessionWebView';
import ErrorBoundary from './src/components/system/ErrorBoundary';

export default function App() {
  const scheme = useColorScheme();
  // The hidden jpdb.io session view spawns a second renderer + network fetch
  // on cold start. Defer it well past the library scan so tab presses and
  // volume taps never compete with it; cookie-gated jobs queue until ready.
  const [sessionReady, setSessionReady] = useState(false);
  useEffect(() => {
    // InteractionManager is deprecated — a plain idle-time delay keeps the
    // hidden session view off the critical startup path without it.
    const timer = setTimeout(() => setSessionReady(true), 6000);
    return () => clearTimeout(timer);
  }, []);
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: scheme === 'dark' ? '#000000' : '#F2F2F7' }}>
      <SafeAreaProvider>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <ErrorBoundary>
          <AppNavigator />
        </ErrorBoundary>
        {sessionReady ? (
          <ErrorBoundary label="Session" fallback={null}>
            <JpdbSessionWebView />
          </ErrorBoundary>
        ) : null}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
