import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ScrollViewProps,
} from 'react-native';

type Props = ScrollViewProps & {
  bottomOffset?: number;
};

export function KeyboardAwareScrollViewCompat({
  children,
  keyboardShouldPersistTaps = 'handled',
  bottomOffset = 0,
  style,
  ...props
}: Props) {
  const scrollView = (
    <ScrollView
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      style={Platform.OS === 'web' ? style : { flex: 1 }}
      {...props}
    >
      {children}
    </ScrollView>
  );

  if (Platform.OS === 'web') {
    return scrollView;
  }

  return (
    <KeyboardAvoidingView
      behavior="padding"
      keyboardVerticalOffset={bottomOffset}
      style={[style, { flex: 1 }]}
    >
      {scrollView}
    </KeyboardAvoidingView>
  );
}
