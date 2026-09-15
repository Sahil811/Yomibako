import 'react-native-gesture-handler';
import 'react-native-reanimated';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useColorScheme } from 'react-native';
import AppNavigator from './src/navigation/AppNavigator';
import JpdbSessionWebView from './src/components/system/JpdbSessionWebView';

const qc = new QueryClient();

export default function App() {
  const scheme = useColorScheme();
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: scheme === 'dark' ? '#000000' : '#F2F2F7' }}>
      <SafeAreaProvider>
        <QueryClientProvider client={qc}>
          <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
          <AppNavigator />
          <JpdbSessionWebView />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
