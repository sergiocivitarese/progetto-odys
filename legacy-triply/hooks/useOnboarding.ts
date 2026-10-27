import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const ONBOARDING_STORAGE_KEY = 'triply_onboarding_v1';
export type OnboardingChoice = 'completed' | 'skipped';

function readChoice(): Promise<string | null> {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return Promise.resolve(window.localStorage.getItem(ONBOARDING_STORAGE_KEY));
  }
  return AsyncStorage.getItem(ONBOARDING_STORAGE_KEY);
}

function writeChoice(choice: OnboardingChoice): Promise<void> {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, choice);
    return Promise.resolve();
  }
  return AsyncStorage.setItem(ONBOARDING_STORAGE_KEY, choice);
}

export function useOnboarding() {
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let active = true;
    void readChoice().then((choice) => {
      if (active) {
        setVisible(choice !== 'completed' && choice !== 'skipped');
        setReady(true);
      }
    }).catch(() => {
      if (active) {
        setVisible(true);
        setReady(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const dismiss = useCallback(async (choice: OnboardingChoice) => {
    try {
      await writeChoice(choice);
      setVisible(false);
    } catch {
      // Keep the introduction visible if local persistence is unavailable.
    }
  }, []);

  const complete = useCallback(() => dismiss('completed'), [dismiss]);
  const skip = useCallback(() => dismiss('skipped'), [dismiss]);
  const reopen = useCallback(() => setVisible(true), []);

  return { ready, visible, complete, skip, reopen };
}