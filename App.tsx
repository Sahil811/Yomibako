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
  // on cold start. Defer it until after first paint so startup stays fast;
  // cookie-gated jobs queue until the bridge is ready.
  const [sessionReady, setSessionReady] = useState(false);
  useEffect(() => {
    // InteractionManager is deprecated — a plain idle-time delay keeps the
    // hidden session view off the critical startup path without it.
    const timer = setTimeout(() => setSessionReady(true), 1500);
    return () => clearTimeout(timer);
  }, []);
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: scheme === 'dark' ? '#000000' : '#F2F2F7' }}>
      <SafeAreaProvider>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <ErrorBoundary>
          <AppNavigator />
        </ErrorBoundary>
        {sessionReady ? <JpdbSessionWebView /> : null}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
