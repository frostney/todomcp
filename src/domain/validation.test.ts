import { describe, expect, test } from "bun:test";
import type { Category, Todo } from "./model";
import { parseClockTime, parseDateString, parseMinuteOfDay, parseTodoDuration } from "./validation";

describe("parseDateString", () => {
  test("accepts a valid calendar date", () => {
    expect(parseDateString("2026-06-24")).toBe("2026-06-24");
  });

  test("rejects impossible calendar dates", () => {
    expect(() => parseDateString("2026-02-30")).toThrow("valid calendar date");
  });
});

describe("parseMinuteOfDay", () => {
  test("accepts any whole minute within a day", () => {
    expect(parseMinuteOfDay(0)).toBe(0);
    expect(parseMinuteOfDay(547)).toBe(547);
    expect(parseMinuteOfDay(1_439)).toBe(1_439);
  });

  test("rejects non-integer and out-of-range minutes", () => {
    expect(() => parseMinuteOfDay(-1)).toThrow("integer 0-1439");
    expect(() => parseMinuteOfDay(1.5)).toThrow("integer 0-1439");
    expect(() => parseMinuteOfDay(1_440)).toThrow("integer 0-1439");
  });
});

describe("parseClockTime", () => {
  test("converts strict 24-hour HH:MM input to minute of day", () => {
    expect(parseClockTime("00:00")).toBe(0);
    expect(parseClockTime("09:07")).toBe(547);
    expect(parseClockTime("23:59")).toBe(1_439);
  });

  test.each([
    "9:07",
    "09:7",
    "24:00",
    "23:60",
    "540",
    "09:07:00",
  ])("rejects malformed or out-of-range input: %s", (value) => {
    expect(() => parseClockTime(value)).toThrow("24-hour HH:MM");
  });
});

describe("parseTodoDuration", () => {
  test("accepts supported durations", () => {
    expect(parseTodoDuration("30")).toBe(30);
  });

  test("rejects unsupported durations", () => {
    expect(() => parseTodoDuration("45")).toThrow("Duration must be one of");
  });
});

describe("domain model", () => {
  test("represents dated todos and categories", () => {
    const category = {
      id: "cat-work",
      name: "Work",
      emoji: "💼",
      createdAt: "2026-06-24T10:00:00.000Z",
      updatedAt: "2026-06-24T10:00:00.000Z",
    } satisfies Category;

    const todo = {
      id: "todo-1",
      name: "Ship scaffold",
      date: "2026-06-24",
      status: "open",
      order: 0,
      categoryId: category.id,
      emoji: "🚨",
      scheduledTime: 540,
      duration: 30,
      createdAt: "2026-06-24T10:00:00.000Z",
      updatedAt: "2026-06-24T10:00:00.000Z",
    } satisfies Todo;

    expect(todo.categoryId).toBe(category.id);
  });
});
