import 'react-native-gesture-handler';
import 'react-native-reanimated';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useColorScheme } from 'react-native';
import AppNavigator from './src/navigation/AppNavigator';
import JpdbSessionWebView from './src/components/system/JpdbSessionWebView';
import ErrorBoundary from './src/components/system/ErrorBoundary';

export default function App() {
  const scheme = useColorScheme();
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: scheme === 'dark' ? '#000000' : '#F2F2F7' }}>
      <SafeAreaProvider>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <ErrorBoundary>
          <AppNavigator />
        </ErrorBoundary>
        <JpdbSessionWebView />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
