import DateTimePicker, {
  DateTimePickerAndroid,
} from '@react-native-community/datetimepicker';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { BrandStrip } from '@/components/brand-strip';
import { FieldInput, FieldLabel, PrimaryButton, Screen } from '@/components/ui-kit';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useTrips } from '@/context/trip-context';
import { useTheme } from '@/hooks/use-theme';
import {
  bestGuessFrom,
  bestGuessTo,
  loadPlaceMemory,
  mergeTripsIntoMemory,
  rememberTripPlaces,
  suggestPlaces,
  type PlaceMemory,
} from '@/storage/places';
import {
  formatPlaceName,
  generateTripName,
  parseDateInput,
  todayIso,
} from '@/utils/format';

const COLUMN = Math.min(560, MaxContentWidth);

function dateToIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function CreateTripScreen() {
  const router = useRouter();
  const colors = useTheme();
  const { width } = useWindowDimensions();
  const columnWidth = Math.min(COLUMN, width - Spacing.four * 2);
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const { createTrip, trips, ready } = useTrips();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [startDate, setStartDate] = useState(todayIso());
  const [iosDatePickerOpen, setIosDatePickerOpen] = useState(false);
  const webDateInputRef = useRef<HTMLInputElement>(null);
  const [nameTouched, setNameTouched] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [memory, setMemory] = useState<PlaceMemory>({
    places: [],
    lastFrom: null,
    lastTo: null,
  });
  const [fromFocused, setFromFocused] = useState(false);
  const [toFocused, setToFocused] = useState(false);

  useEffect(() => {
    if (!userId || !ready) return;
    let cancelled = false;
    (async () => {
      const stored = await loadPlaceMemory(userId);
      if (cancelled) return;
      const merged = mergeTripsIntoMemory(stored, trips);
      setMemory(merged);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, ready, trips]);

  const hideFromSuggestionsSoon = () => {
    setTimeout(() => setFromFocused(false), 150);
  };
  const hideToSuggestionsSoon = () => {
    setTimeout(() => setToFocused(false), 150);
  };

  const startDateIso = useMemo(() => parseDateInput(startDate), [startDate]);
  const selectedDate = startDateIso ? new Date(`${startDateIso}T12:00:00`) : new Date();
  const openDatePicker = () => {
    if (Platform.OS === 'web') {
      if (webDateInputRef.current?.showPicker) {
        webDateInputRef.current.showPicker();
      } else {
        webDateInputRef.current?.click();
      }
      return;
    }
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: selectedDate,
        mode: 'date',
        onChange: (_event, date) => {
          if (date) setStartDate(dateToIso(date));
        },
      });
      return;
    }
    setIosDatePickerOpen(true);
  };
  const autoName = useMemo(() => {
    if (!from.trim() || !to.trim() || !startDateIso) return '';
    return generateTripName(from, to, startDateIso);
  }, [from, to, startDateIso]);

  const displayedName = nameTouched ? name : autoName;
  const fromExample = formatPlaceName(bestGuessFrom(memory) ?? 'Brisbane');
  const toExample = formatPlaceName(bestGuessTo(memory, fromExample) ?? 'Perth');

  const fromSuggestions = useMemo(
    () => (fromFocused ? suggestPlaces(memory, from, to, 5) : []),
    [memory, from, to, fromFocused]
  );
  const toSuggestions = useMemo(
    () => (toFocused ? suggestPlaces(memory, to, from, 5) : []),
    [memory, to, from, toFocused]
  );

  const onCreate = async () => {
    if (!userId) {
      Alert.alert('Sign in required', 'Please sign in again before creating a trip.');
      router.replace('/');
      return;
    }
    if (!from.trim() || !to.trim()) {
      Alert.alert('Missing cities', 'Enter both From and To.');
      return;
    }
    if (!startDate.trim()) {
      Alert.alert('Missing date', 'Enter the trip date as YYYY-MM-DD.');
      return;
    }
    if (!startDateIso) {
      Alert.alert(
        'Invalid date',
        'Use YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY, or a date such as 6 Oct 2026.'
      );
      return;
    }

    const finalName = displayedName.trim();
    if (!finalName) {
      Alert.alert('Trip name required', 'Enter a trip name or fill From and To.');
      return;
    }

    setSaving(true);
    try {
      const trip = await createTrip({
        from,
        to,
        startDate: startDateIso,
        endDate: startDateIso,
        name: finalName,
      });
      if (userId) {
        const next = await rememberTripPlaces(userId, from, to);
        setMemory(next);
      }
      router.replace(`/trip/${trip.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not create the trip.';
      if (message.toLowerCase().includes('sign in')) {
        Alert.alert('Sign in required', 'Your session has ended. Please sign in again.');
        router.replace('/');
      } else {
        Alert.alert('Could not create trip', message);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled">
        <View style={[styles.column, { width: columnWidth }]}>
          <BrandStrip
            title="Create Trip"
            onHome={() => router.navigate('/')}
          />

          <View
            style={[
              styles.formPanel,
              {
                backgroundColor: colors.backgroundElement,
                borderColor: colors.backgroundSelected,
              },
            ]}>
            <FieldLabel>From</FieldLabel>
            <FieldInput
              value={from}
              onChangeText={(text) => setFrom(formatPlaceName(text))}
              placeholder={`eg:${fromExample}`}
              placeholderTextColor="#AEB3BD"
              autoCapitalize="words"
              onFocus={() => setFromFocused(true)}
              onBlur={hideFromSuggestionsSoon}
            />
            {fromSuggestions.length > 0 ? (
              <View style={styles.chips}>
                {fromSuggestions.map((place) => (
                  <Pressable
                    key={`from-${place}`}
                    onPress={() => {
                      setFrom(formatPlaceName(place));
                      setFromFocused(false);
                    }}
                    style={[styles.chip, { backgroundColor: colors.backgroundSelected }]}>
                    <Text style={[styles.chipText, { color: colors.text }]}>{place}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <FieldLabel>To</FieldLabel>
            <FieldInput
              value={to}
              onChangeText={(text) => setTo(formatPlaceName(text))}
              placeholder={`eg:${toExample}`}
              placeholderTextColor="#AEB3BD"
              autoCapitalize="words"
              onFocus={() => setToFocused(true)}
              onBlur={hideToSuggestionsSoon}
            />
            {toSuggestions.length > 0 ? (
              <View style={styles.chips}>
                {toSuggestions.map((place) => (
                  <Pressable
                    key={`to-${place}`}
                    onPress={() => {
                      setTo(formatPlaceName(place));
                      setToFocused(false);
                    }}
                    style={[styles.chip, { backgroundColor: colors.backgroundSelected }]}>
                    <Text style={[styles.chipText, { color: colors.text }]}>{place}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <FieldLabel>Date</FieldLabel>
            <View style={styles.dateInputWrap}>
              <FieldInput
                value={startDate}
                onChangeText={setStartDate}
                placeholder={`eg:${todayIso()}`}
                placeholderTextColor="#AEB3BD"
                autoCapitalize="none"
                style={styles.dateInput}
              />
              <Pressable
                onPress={openDatePicker}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Choose trip date"
                style={({ pressed }) => [
                  styles.calendarButton,
                  pressed && styles.calendarButtonPressed,
                ]}>
                <Text style={styles.calendarIcon}>📅</Text>
              </Pressable>
              {Platform.OS === 'web' ? (
                <input
                  ref={webDateInputRef}
                  type="date"
                  tabIndex={-1}
                  aria-hidden
                  value={startDateIso ?? todayIso()}
                  onChange={(event) => setStartDate(event.currentTarget.value)}
                  style={{
                    position: 'absolute',
                    width: 1,
                    height: 1,
                    right: 12,
                    bottom: 0,
                    opacity: 0,
                    pointerEvents: 'none',
                  }}
                />
              ) : null}
            </View>

            <FieldLabel>Trip Name</FieldLabel>
            <FieldInput
              value={displayedName}
              onChangeText={(text) => {
                setName(text);
                if (!text.trim()) {
                  setNameTouched(false);
                  return;
                }
                setNameTouched(text !== autoName);
              }}
              placeholder="Auto-fills from From / To / Date"
              autoCapitalize="none"
            />

            <View style={styles.spacer} />
            <PrimaryButton
              label={saving ? 'CREATING…' : 'CREATE TRIP'}
              onPress={() => void onCreate()}
              disabled={saving}
            />
          </View>
        </View>
      </ScrollView>
      <Modal
        transparent
        visible={Platform.OS === 'ios' && iosDatePickerOpen}
        animationType="fade"
        onRequestClose={() => setIosDatePickerOpen(false)}>
        <View style={styles.dateModalRoot}>
          <Pressable
            style={styles.dateModalBackdrop}
            onPress={() => setIosDatePickerOpen(false)}
          />
          <View style={[styles.dateModalCard, { backgroundColor: colors.background }]}>
            <Text style={[styles.dateModalTitle, { color: colors.text }]}>Select trip date</Text>
            <DateTimePicker
              value={selectedDate}
              mode="date"
              display="inline"
              onChange={(_event, date) => {
                if (date) setStartDate(dateToIso(date));
              }}
            />
            <PrimaryButton label="DONE" onPress={() => setIosDatePickerOpen(false)} />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: Spacing.four,
    paddingBottom: Spacing.six,
    alignItems: 'center',
  },
  column: {
    maxWidth: COLUMN,
  },
  formPanel: {
    borderRadius: 14,
    borderWidth: 1,
    padding: Spacing.three,
  },
  dateInputWrap: {
    position: 'relative',
  },
  dateInput: {
    paddingRight: 54,
  },
  calendarButton: {
    position: 'absolute',
    right: 8,
    top: 6,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarButtonPressed: {
    backgroundColor: '#DDE7F3',
  },
  calendarIcon: {
    fontSize: 20,
  },
  dateModalRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  dateModalBackdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  dateModalCard: {
    zIndex: 1,
    width: '100%',
    maxWidth: 420,
    borderRadius: 16,
    padding: Spacing.four,
  },
  dateModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: Spacing.three,
  },
  spacer: {
    height: Spacing.two,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginTop: -Spacing.two,
    marginBottom: Spacing.three,
  },
  chip: {
    borderRadius: 8,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.one + 2,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '500',
  },
});
