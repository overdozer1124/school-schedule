import { describe, expect, test } from "bun:test";
import {
  audienceColumns,
  audienceItems,
  audienceRankOf,
  filterRangeForAudience,
  targetRangeLabel,
} from "./audience";
import type { ColumnDef, RangeData } from "./lib";

const items = [
  { id: 1, defaultVisibility: "student" }, // 給食
  { id: 2, defaultVisibility: "staff_only" }, // 清掃
  { id: 3, defaultVisibility: "guardian" }, // 下校（保護者まで）
];
const columns: ColumnDef[] = [
  { kind: "category", category: "行事", label: "行事" },
  { kind: "daily_item", itemId: 1, label: "給食" },
  { kind: "daily_item", itemId: 2, label: "清掃" },
  { kind: "daily_item", itemId: 3, label: "下校" },
  { kind: "duty", dutyId: 9, label: "日番" },
];

function range(): RangeData {
  return {
    events: [
      { id: 1, visibility: "staff_only" },
      { id: 2, visibility: "student" },
    ],
    dailyValues: [
      { id: 10, itemDefinitionId: 1 },
      { id: 11, itemDefinitionId: 2 },
      { id: 12, itemDefinitionId: 3 },
    ],
    dutyAssignments: [{ id: 20 }],
    conflicts: [{ assignmentId: 20 }],
    dutyChanges: [{ id: 30 }],
    dayRecords: [],
  } as unknown as RangeData;
}

describe("audienceRankOf", () => {
  test("unknown audiences fail closed (most open audience, not staff)", () => {
    expect(audienceRankOf("staff")).toBe(0);
    expect(audienceRankOf("student")).toBe(2);
    expect(audienceRankOf("typo")).toBe(3);
  });
});

describe("student view whitelist", () => {
  const rank = audienceRankOf("student");
  const cols = audienceColumns(columns, items, rank);
  const allowed = audienceItems(items, cols, rank);

  test("only student-visible item columns, no duty columns", () => {
    expect(cols.map((c) => c.label)).toEqual(["行事", "給食"]);
    expect(allowed.map((i) => i.id)).toEqual([1]);
  });

  test("items not listed as columns stay hidden even if visible", () => {
    const onlyEvents = audienceColumns([columns[0]!], items, rank);
    expect(audienceItems(items, onlyEvents, rank)).toEqual([]);
  });

  test("range keeps only reachable events and allowed values; duty data is dropped", () => {
    const r = filterRangeForAudience(range(), new Set(allowed.map((i) => i.id)), rank);
    expect(r.events.map((e) => e.id)).toEqual([2]);
    expect(r.dailyValues.map((d) => d.id)).toEqual([10]);
    expect(r.dutyAssignments).toEqual([]);
    expect(r.conflicts).toEqual([]);
    expect(r.dutyChanges).toEqual([]);
  });
});

describe("staff view", () => {
  test("sees everything unchanged", () => {
    const r0 = range();
    expect(filterRangeForAudience(r0, new Set(), 0)).toBe(r0);
    expect(audienceItems(items, [], 0)).toBe(items);
  });
});

describe("targetRangeLabel", () => {
  test("numeric targets collapse into a range", () => {
    expect(targetRangeLabel(["1年", "2年", "3年", "4年", "5年", "6年"])).toBe("1～6年");
    expect(targetRangeLabel(["3年"])).toBe("3年");
  });
  test("non-numeric targets are listed, not ranged (DESIGN §4.8.2)", () => {
    expect(targetRangeLabel(["小学部", "中学部", "高等部"])).toBe("小学部・中学部・高等部");
  });
});
