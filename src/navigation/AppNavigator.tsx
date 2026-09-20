import React from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useColorScheme, Text, View, Pressable, StyleSheet, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import LibraryScreen from '../features/library/LibraryScreen';
import ReaderScreen from '../features/reader/ReaderScreen';
import SettingsScreen from '../features/library/SettingsScreen';
import BrowserScreen from '../features/browser/BrowserScreen';
import { lightColors, darkColors } from '../theme/colors';
import { Icon, type IconName } from '../components/ui/Icon';
import ErrorBoundary from '../components/system/ErrorBoundary';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const TAB_META: Record<string, { label: string; icon: IconName }> = {
  Library: { label: 'Library', icon: 'library' },
  Browser: { label: 'Browser', icon: 'browser' },
  Settings: { label: 'Settings', icon: 'settings' },
};

function TabButton({ isFocused, colors, onPress, label, icon }: any) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const tint = isFocused ? colors.primary : colors.secondaryLabel;
  return (
    <Pressable
      onPressIn={() => (scale.value = withSpring(0.9, { damping: 20, stiffness: 500 }))}
      onPressOut={() => (scale.value = withSpring(1, { damping: 20, stiffness: 400 }))}
      onPress={onPress}
      style={s.tab}
      hitSlop={6}
      accessibilityRole="tab"
      accessibilityState={{ selected: isFocused }}
      accessibilityLabel={label}
    >
      <Animated.View style={[animatedStyle, { alignItems: 'center', gap: 4, minHeight: 44, justifyContent: 'center' }]}>
        <Icon name={icon} size={24} color={tint} strokeWidth={isFocused ? 2 : 1.7} />
        <Text
          style={[
            s.label,
            {
              color: tint,
              fontWeight: isFocused ? ('600' as const) : ('500' as const),
            },
          ]}
        >
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

function TabBar({ state, descriptors, navigation }: any) {
  const scheme = useColorScheme();
  const colors = scheme === 'light' ? lightColors : darkColors;
  const insets = useSafeAreaInsets();
  const activeRoute = state.routes[state.index];

  // Browser reading mode owns the whole window. Its small floating collapse
  // control restores this bar, so no navigation path is lost.
  if (activeRoute?.name === 'Browser' && activeRoute?.params?.immersive) return null;

  return (
    <View style={[s.barContainer, { paddingBottom: Math.max(insets.bottom, Platform.OS === 'ios' ? 6 : 8) }]}>
      <View style={[s.hairline, { backgroundColor: colors.separator }]} />
      <BlurView
        intensity={Platform.OS === 'ios' ? 40 : 60}
        tint={scheme === 'dark' ? 'dark' : 'light'}
        style={[StyleSheet.absoluteFill as any, { backgroundColor: colors.blurTint }]}
      />
      <View style={s.barContent}>
        {state.routes.map((route: any, index: number) => {
          const isFocused = state.index === index;
          const meta = TAB_META[route.name] ?? { label: route.name, icon: 'book' as IconName };
          const onPress = () => {
            const e = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!isFocused && !e.defaultPrevented) {
              Haptics.selectionAsync();
              navigation.navigate(route.name);
            } else if (isFocused) {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }
          };
          return (
            <TabButton
              key={route.key}
              isFocused={isFocused}
              colors={colors}
              onPress={onPress}
              label={meta.label}
              icon={meta.icon}
            />
          );
        })}
      </View>
    </View>
  );
}

function TabsWrapper() {
  return (
    <View style={{ flex: 1 }}>
      <Tab.Navigator tabBar={(p) => <TabBar {...p} />} screenOptions={{ headerShown: false, tabBarHideOnKeyboard: true }}>
        <Tab.Screen name="Library" component={LibraryScreen} />
        <Tab.Screen name="Browser" component={BrowserScreen} />
        <Tab.Screen name="Settings" component={SettingsScreen} />
      </Tab.Navigator>
    </View>
  );
}

// The reader drives a WebView, injected page scripts, orientation locks and
// Reanimated gestures at once. Guarding it separately means a bad volume drops
// the user back on the shelf instead of taking down the whole app.
function GuardedReader(props: any) {
  return (
    <ErrorBoundary label="Reader" resetLabel="Back to library" onReset={() => props.navigation.goBack()}>
      <ReaderScreen {...props} />
    </ErrorBoundary>
  );
}

export default function AppNavigator() {
  const scheme = useColorScheme();
  const colors = scheme === 'light' ? lightColors : darkColors;
  const navTheme = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const theme = {
    ...navTheme,
    colors: {
      ...navTheme.colors,
      primary: colors.primary,
      background: colors.groupedBackground,
      card: colors.surface,
      text: colors.onSurface,
      border: colors.separator,
    },
  } as any;
  return (
    <NavigationContainer theme={theme}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          gestureEnabled: true,
          gestureDirection: 'horizontal',
          fullScreenGestureEnabled: true,
        }}
      >
        <Stack.Screen name="Tabs" component={TabsWrapper} />
        <Stack.Screen name="Reader" component={GuardedReader} options={{ animation: 'fade', orientation: 'default', gestureEnabled: true }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const s = StyleSheet.create({
  barContainer: {
    position: 'relative',
    paddingTop: 4,
    borderTopWidth: 0,
    overflow: 'hidden',
  },
  hairline: { position: 'absolute', top: 0, left: 0, right: 0, height: StyleSheet.hairlineWidth, opacity: 0.9 },
  barContent: {
    flexDirection: 'row',
    minHeight: 54,
    alignItems: 'center',
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 10, letterSpacing: 0.1, fontWeight: '500' as const, textAlign: 'center' as const, lineHeight: 12 },
});
