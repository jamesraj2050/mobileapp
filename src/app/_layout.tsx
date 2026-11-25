import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { AuthProvider } from '@/context/auth-context';
import { TaxWorkProvider } from '@/context/tax-work-context';
import { TripProvider } from '@/context/trip-context';
import { useTheme } from '@/hooks/use-theme';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colors = useTheme();

  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  return (
    <AuthProvider>
      <TripProvider>
        <TaxWorkProvider>
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.background },
              headerTintColor: colors.text,
              headerTitleStyle: { fontWeight: '700' },
              headerShadowVisible: false,
              contentStyle: { backgroundColor: colors.background },
            }}>
            <Stack.Screen name="index" options={{ title: 'My Trips' }} />
            <Stack.Screen name="create-trip" options={{ title: 'Create Trip', presentation: 'modal' }} />
            <Stack.Screen name="trip/[id]/index" options={{ title: 'Trip' }} />
            <Stack.Screen name="trip/[id]/add" options={{ title: 'Add Expense' }} />
            <Stack.Screen name="trip/[id]/receipt" options={{ title: 'Receipt captured' }} />
            <Stack.Screen name="trip/[id]/review" options={{ title: 'Review Trip' }} />
            <Stack.Screen name="tax-work/index" options={{ title: 'Tax / Work Receipts' }} />
            <Stack.Screen name="tax-work/capture" options={{ title: 'Capture Tax Receipt' }} />
            <Stack.Screen name="tax-work/[year]/index" options={{ title: 'Receipts' }} />
            <Stack.Screen name="tax-work/[year]/review" options={{ title: 'Review' }} />
            <Stack.Screen name="tax-work/receipt/[id]" options={{ title: 'Receipt' }} />
          </Stack>
        </TaxWorkProvider>
      </TripProvider>
    </AuthProvider>
  );
}
