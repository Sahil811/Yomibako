// Catches render/lifecycle crashes so a failure in one screen does not leave
// the user staring at a blank app with no way back.
//
// The fallback is dark regardless of system theme, matching the reader chrome.
import React from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';

type Props = {
  readonly children: React.ReactNode;
  /** Shown above the message, e.g. "Reader". */
  readonly label?: string;
  /** Action label for the recovery button. */
  readonly resetLabel?: string;
  /** Called after the user asks to retry, to reset any owning state. */
  readonly onReset?: () => void;
  /** Custom fallback instead of the default card. Pass null for silent failures (hidden views). */
  readonly fallback?: React.ReactNode;
};

type State = { readonly error: Error | null };

export default class ErrorBoundary extends React.Component<Props, State> {
  readonly state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[yomibako] uncaught', this.props.label ?? 'app', error, info.componentStack);
  }

  private readonly retry = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if ('fallback' in this.props) return this.props.fallback as React.ReactNode;
    const resetLabel = this.props.resetLabel ?? 'Try again';
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>{this.props.label ? `${this.props.label} stopped` : 'Something went wrong'}</Text>
          <Text style={styles.body}>
            Your manga files and reading progress are safe. Try again, or go back and reopen.
          </Text>
          <Text style={styles.detail} selectable>
            {error.message || String(error)}
          </Text>
          <Pressable
            onPress={this.retry}
            accessibilityRole="button"
            accessibilityLabel={resetLabel}
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          >
            <Text style={styles.buttonLabel}>{resetLabel}</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  content: { flexGrow: 1, justifyContent: 'center', padding: 28, gap: 14 },
  title: { color: '#fff', fontSize: 20, fontWeight: '600' },
  body: { color: 'rgba(255,255,255,0.65)', fontSize: 15, lineHeight: 21 },
  detail: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 12,
    fontFamily: 'monospace',
    marginTop: 4,
  },
  button: {
    marginTop: 12,
    alignSelf: 'flex-start',
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: '#0A84FF',
  },
  buttonPressed: { opacity: 0.7 },
  buttonLabel: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
