import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { FieldInput, FieldLabel, PrimaryButton, Screen } from '@/components/ui-kit';
import { Spacing } from '@/constants/theme';
import { useTrips } from '@/context/trip-context';
import { generateTripName, todayIso } from '@/utils/format';

export default function CreateTripScreen() {
  const router = useRouter();
  const { createTrip } = useTrips();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(todayIso());
  const [nameTouched, setNameTouched] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const autoName = useMemo(() => {
    if (!from.trim() || !to.trim() || !startDate) return '';
    return generateTripName(from, to, startDate);
  }, [from, to, startDate]);

  const displayName = nameTouched ? name : autoName || name;

  const onCreate = async () => {
    if (!from.trim() || !to.trim()) {
      Alert.alert('Missing cities', 'Enter both From and To.');
      return;
    }
    if (!startDate || !endDate) {
      Alert.alert('Missing dates', 'Enter start and end dates as YYYY-MM-DD.');
      return;
    }
    if (endDate < startDate) {
      Alert.alert('Invalid dates', 'End date must be on or after start date.');
      return;
    }

    setSaving(true);
    try {
      const trip = await createTrip({
        from,
        to,
        startDate,
        endDate,
        name: (displayName || autoName).trim(),
      });
      router.replace(`/trip/${trip.id}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <FieldLabel>From</FieldLabel>
        <FieldInput
          value={from}
          onChangeText={setFrom}
          placeholder="Brisbane"
          autoCapitalize="words"
        />

        <FieldLabel>To</FieldLabel>
        <FieldInput
          value={to}
          onChangeText={setTo}
          placeholder="Melbourne"
          autoCapitalize="words"
        />

        <FieldLabel>Start Date</FieldLabel>
        <FieldInput
          value={startDate}
          onChangeText={setStartDate}
          placeholder="YYYY-MM-DD"
          autoCapitalize="none"
        />

        <FieldLabel>End Date</FieldLabel>
        <FieldInput
          value={endDate}
          onChangeText={setEndDate}
          placeholder="YYYY-MM-DD"
          autoCapitalize="none"
        />

        <FieldLabel>Trip Name</FieldLabel>
        <FieldInput
          value={displayName}
          onChangeText={(text) => {
            setNameTouched(true);
            setName(text);
          }}
          placeholder="Melbourne Business Trip"
        />

        <View style={styles.spacer} />
        <PrimaryButton
          label={saving ? 'CREATING…' : 'CREATE TRIP'}
          onPress={onCreate}
          disabled={saving}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: Spacing.four,
    paddingBottom: Spacing.six,
  },
  spacer: {
    height: Spacing.two,
  },
});
