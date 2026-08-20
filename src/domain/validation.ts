import type { DateString, MinuteOfDay, TodoDuration } from "./model";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const MINUTES_PER_DAY = 1_440;
const VALID_DURATIONS: readonly TodoDuration[] = [15, 30, 60];

export function parseDateString(value: string): DateString {
  if (!DATE_PATTERN.test(value)) {
    throw new Error(`Date must be in YYYY-MM-DD format, got: ${value}`);
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Date is not a valid calendar date: ${value}`);
  }

  const roundTrip = parsed.toISOString().split("T")[0];
  if (roundTrip !== value) {
    throw new Error(`Date is not a valid calendar date: ${value}`);
  }

  return value;
}

export function parseMinuteOfDay(value: number): MinuteOfDay {
  if (!Number.isInteger(value) || value < 0 || value >= MINUTES_PER_DAY) {
    throw new Error(`Time must be an integer 0-${MINUTES_PER_DAY - 1}, got: ${value}`);
  }

  return value;
}

export function parseClockTime(value: string): MinuteOfDay {
  if (!CLOCK_TIME_PATTERN.test(value)) {
    throw new Error(`Time must be in 24-hour HH:MM format, got: ${value}`);
  }

  const hours = Number(value.slice(0, 2));
  const minutes = Number(value.slice(3, 5));
  return parseMinuteOfDay(hours * 60 + minutes);
}

export function parseTodoDuration(value: string): TodoDuration {
  const parsed = Number(value);
  if (!VALID_DURATIONS.includes(parsed as TodoDuration)) {
    throw new Error(`Duration must be one of ${VALID_DURATIONS.join(", ")}, got: ${value}`);
  }

  return parsed as TodoDuration;
}
