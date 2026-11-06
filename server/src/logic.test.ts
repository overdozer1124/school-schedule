import { describe, expect, test } from "bun:test";
import {
  dutyAppliesOn,
  eventSlot,
  isValidDateString,
  isValidTimeString,
  nextRotationIndex,
  samePerson,
  slotsOverlap,
} from "./logic";

describe("isValidDateString", () => {
  test("accepts real dates", () => {
    expect(isValidDateString("2026-04-01")).toBe(true);
    expect(isValidDateString("2028-02-29")).toBe(true);
  });
  test("rejects rollover and malformed dates", () => {
    expect(isValidDateString("2026-13-40")).toBe(false);
    expect(isValidDateString("2026-02-30")).toBe(false);
    expect(isValidDateString("2027-02-29")).toBe(false);
    expect(isValidDateString("2026-4-1")).toBe(false);
    expect(isValidDateString("2026/04/01")).toBe(false);
    expect(isValidDateString("")).toBe(false);
  });
});

describe("isValidTimeString", () => {
  test("HH:MM only", () => {
    expect(isValidTimeString("09:30")).toBe(true);
    expect(isValidTimeString("23:59")).toBe(true);
    expect(isValidTimeString("24:00")).toBe(false);
    expect(isValidTimeString("9:30")).toBe(false);
  });
});

describe("eventSlot", () => {
  const ev = (o: Partial<Parameters<typeof eventSlot>[0]>) => ({
    isAllDay: 0,
    slot: "all_day",
    startsAt: null,
    endsAt: null,
    ...o,
  });
  test("explicit am/pm wins", () => {
    expect(eventSlot(ev({ isAllDay: 1, slot: "am" }))).toBe("am");
    expect(eventSlot(ev({ slot: "pm", startsAt: "09:00", endsAt: "10:00" }))).toBe("pm");
  });
  test("all-day event occupies the whole day", () => {
    expect(eventSlot(ev({ isAllDay: 1 }))).toBe("all_day");
  });
  test("timed events are placed by their hours", () => {
    expect(eventSlot(ev({ startsAt: "09:00", endsAt: "11:30" }))).toBe("am");
    expect(eventSlot(ev({ startsAt: "09:00", endsAt: "12:00" }))).toBe("am");
    expect(eventSlot(ev({ startsAt: "13:00", endsAt: "16:00" }))).toBe("pm");
    expect(eventSlot(ev({ startsAt: "10:00", endsAt: "15:00" }))).toBe("all_day");
    expect(eventSlot(ev({}))).toBe("all_day");
  });
  test("a morning-only trip does not clash with an afternoon duty (DESIGN §4.7.2)", () => {
    const trip = eventSlot(ev({ startsAt: "08:30", endsAt: "11:00" }));
    expect(slotsOverlap("pm", trip)).toBe(false);
    expect(slotsOverlap("am", trip)).toBe(true);
    expect(slotsOverlap("all_day", trip)).toBe(true);
  });
});

describe("dutyAppliesOn", () => {
  test("all_year always applies", () => {
    expect(dutyAppliesOn({ applicablePeriod: "all_year", startsOn: null, endsOn: null }, "2026-08-01")).toBe(true);
  });
  test("ranged kinds apply only inside their dates", () => {
    const def = { applicablePeriod: "long_vacation_only", startsOn: "2026-07-21", endsOn: "2026-08-31" };
    expect(dutyAppliesOn(def, "2026-07-20")).toBe(false);
    expect(dutyAppliesOn(def, "2026-07-21")).toBe(true);
    expect(dutyAppliesOn(def, "2026-08-31")).toBe(true);
    expect(dutyAppliesOn(def, "2026-09-01")).toBe(false);
  });
  test("ranged kinds without dates apply nowhere (no flood of unassigned warnings)", () => {
    expect(dutyAppliesOn({ applicablePeriod: "long_vacation_only", startsOn: null, endsOn: null }, "2026-05-01")).toBe(false);
    expect(dutyAppliesOn({ applicablePeriod: "custom_range", startsOn: null, endsOn: null }, "2026-05-01")).toBe(false);
  });
});

describe("nextRotationIndex", () => {
  const members = [
    { personId: 1, freeTextName: null },
    { personId: 2, freeTextName: null },
    { personId: null, freeTextName: "非常勤 田中" },
  ];
  test("starts at 0 with no history", () => {
    expect(nextRotationIndex(members, null)).toBe(0);
  });
  test("continues after the last holder and wraps", () => {
    expect(nextRotationIndex(members, { personId: 1, freeTextName: null })).toBe(1);
    expect(nextRotationIndex(members, { personId: 2, freeTextName: null })).toBe(2);
    expect(nextRotationIndex(members, { personId: null, freeTextName: "非常勤　田中" })).toBe(0);
  });
  test("unknown last holder restarts at 0", () => {
    expect(nextRotationIndex(members, { personId: 99, freeTextName: null })).toBe(0);
  });
});

describe("samePerson", () => {
  test("ids decide when both are registered", () => {
    expect(samePerson({ personId: 1, name: "山田" }, { personId: 1, name: "別名" })).toBe(true);
    expect(samePerson({ personId: 1, name: "山田" }, { personId: 2, name: "山田" })).toBe(false);
  });
  test("free-text holders match by name, ignoring spaces", () => {
    expect(samePerson({ personId: null, name: "山田 太郎" }, { personId: 3, name: "山田太郎" })).toBe(true);
    expect(samePerson({ personId: null, name: "" }, { personId: null, name: "" })).toBe(false);
  });
});
