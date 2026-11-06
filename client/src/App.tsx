import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaTopScrim } from "@hatch/space-sdk/client";
import { api, type ApiRequest } from "./api";
import {
  audienceColumns,
  audienceItems,
  audienceRankOf,
  filterRangeForAudience,
} from "./audience";
import {
LAYOUTS,
WEEKDAYS,
addDays,
clampColWidth,
columnWidthKey,
parseWidths,
addMonths,
dayLabel,
eachDate,
entitlementUsable,
eventHeadline,
eventsOnDate,
governingEntitlement,
mondayOf,
monthEnd,
monthLabel,
monthStart,
parseColumns,
parseDate,
personNameOf,
sortEvents,
targetRangeLabel,
todayStr,
weekdayOf,
type Assignment,
type Bootstrap,
type ColumnDef,
type Conflict,
type DailyValue,
type EventItem,
type ItemDef,
type Person,
type RangeData,
} from "./lib";
import { EventModal, type EventDraft } from "./EventModal";
import { QuickSetup } from "./QuickSetup";
import { DutyPanel } from "./DutyPanel";
import { SettingsPanel } from "./SettingsPanel";

type SetDailyArgs = ApiRequest<typeof api, "setDailyValue">;

/** Identity of one drop-target cell, used for highlight + pointer hit-testing. */
export function dropKeyOf(
  date: string,
  category?: string | null,
  itemId?: number | null,
): string {
  return `${date}|${category ?? ""}|${itemId ?? ""}`;
}

type DragPayload =
  | { kind: "event"; eventId: number; sourceDate: string | null }
  | { kind: "daily"; itemId: number; fromDate: string };

type TableCtx = {
  bootstrap: Bootstrap;
  /** Already filtered for the view's audience (audience.ts). */
  range: RangeData;
  /** Already filtered for the view's audience (audience.ts). */
  columns: ColumnDef[];
  /**
   * Daily items this view may show on any path (calendar symbol band, day
   * detail…). Never read bootstrap.items for display — it is unfiltered.
   */
  items: ItemDef[];
  holidayMap: Map<string, string>;
  onOpenEvent: (e: EventItem) => void;
  onQuickAdd: (
    date: string,
    category: string,
    title: string,
    anchor: { top: number; bottom: number; left: number } | null,
  ) => void;
  onSetDaily: (args: SetDailyArgs) => void;
  onSetDuty: (
    defId: number,
    date: string,
    slot: string,
    personId: number | null,
    freeText: string | null,
  ) => void;
  onDayClick: (date: string) => void;
  onOpenDutyPanel: () => void;
  conflictByAssignment: Map<number, Conflict[]>;
  readOnly?: boolean;
  compact?: boolean;
  // ---- drag & drop: move entered content to another day ----
  /** Key of the cell currently under the dragged item (highlight), or null. */
  dropKey: string | null;
  draggingEventId: number | null;
  draggingDailyKey: string | null;
  onMoveEvent: (
    eventId: number,
    sourceDate: string | null,
    targetDate: string,
    targetCategory?: string | null,
  ) => void;
  onMoveDaily: (itemId: number, fromDate: string, toDate: string) => void;
  onHtmlDragStart: (payload: DragPayload, e: ReactDragEvent) => void;
  onHtmlDragEnd: () => void;
  onDragOverCell: (
    key: string,
    e: ReactDragEvent,
  ) => void;
  onDragLeaveCell: (key: string) => void;
  onDropCell: (
    target: { date: string; category?: string | null; itemId?: number | null },
    e: ReactDragEvent,
  ) => void;
  onPointerStartEvent: (
    event: EventItem,
    sourceDate: string,
    e: ReactPointerEvent,
  ) => void;
  onPointerStartDaily: (
    itemId: number,
    fromDate: string,
    label: string,
    e: ReactPointerEvent,
  ) => void;
  /** True right after a pointer drag ended, so the trailing click is ignored. */
  shouldSuppressClick: () => boolean;
  // ---- column width drag-resize (per view definition, persisted) ----
  /** Effective column widths in px, keyed by column identity. */
  colWidths: Record<string, number>;
  /**
   * Reports a column-width change. During a drag (commit=false) it only
   * previews; on release (commit=true) it persists. width=null on commit
   * removes the saved width (back to the default).
   */
  onResizeColumn?: (key: string, width: number | null, commit: boolean) => void;
};

/** Props that turn any cell element into a drop target for drag & drop. */
function dropTargetProps(
  ctx: TableCtx,
  target: { date: string; category?: string | null; itemId?: number | null },
): {
  "data-drop-date"?: string;
  "data-drop-category"?: string;
  "data-drop-item-id"?: string;
  "data-drop-key"?: string;
  onDragOver?: (e: ReactDragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: ReactDragEvent) => void;
} {
  const key = dropKeyOf(target.date, target.category, target.itemId);
  if (ctx.readOnly) return {};
  return {
    "data-drop-date": target.date,
    "data-drop-category": target.category ?? "",
    "data-drop-item-id": target.itemId != null ? String(target.itemId) : "",
    "data-drop-key": key,
    onDragOver: (e: ReactDragEvent) => ctx.onDragOverCell(key, e),
    onDragLeave: () => ctx.onDragLeaveCell(key),
    onDrop: (e: ReactDragEvent) => ctx.onDropCell(target, e),
  };
}

function dropHighlightCls(ctx: TableCtx, key: string): string {
  return ctx.dropKey === key
    ? " bg-[var(--accent)]/15 outline outline-2 -outline-offset-2 outline-[var(--accent)]"
    : "";
}

function dailyDisplay(
  ctx: TableCtx,
  item: ItemDef,
  v: DailyValue | undefined,
): string {
  if (!v) return "";
  if (v.valueOptionId != null) {
    return item.options.find((o) => o.id === v.valueOptionId)?.label ?? "";
  }
  if (v.valuePersonId != null) {
    return personNameOf(ctx.bootstrap.people, v.valuePersonId, null);
  }
  if (v.valueNumber != null) return String(v.valueNumber);
  return v.valueText ?? "";
}

function getDaily(
  ctx: TableCtx,
  date: string,
  itemId: number,
  targetId: number | null,
): DailyValue | undefined {
  return ctx.range.dailyValues.find(
    (d) =>
      d.date === date &&
      d.itemDefinitionId === itemId &&
      (d.targetId ?? null) === targetId &&
      d.slot === "all_day",
  );
}

type DailyGroup = {
  targetIds: number[];
  names: string[];
  text: string;
  rangeLabel: string;
};

/**
 * Groups a target-group item's filled values for one date by consecutive
 * targets sharing the same display value. All grades sharing one dismissal
 * time collapse to a single group ("1～6年"); consecutive partial matches
 * collapse too ("1～3年"), while differing values stay in separate groups.
 * Empty values never form a group.
 */
function groupedDaily(
  ctx: TableCtx,
  item: ItemDef,
  date: string,
  targets: { id: number; name: string }[],
): DailyGroup[] {
  const groups: DailyGroup[] = [];
  let lastIndex = -2;
  targets.forEach((t, idx) => {
    const text = dailyDisplay(ctx, item, getDaily(ctx, date, item.id, t.id));
    if (text === "") return;
    const last = groups[groups.length - 1];
    if (last && last.text === text && lastIndex === idx - 1) {
      last.targetIds.push(t.id);
      last.names.push(t.name);
      last.rangeLabel = targetRangeLabel(last.names);
    } else {
      groups.push({
        targetIds: [t.id],
        names: [t.name],
        text,
        rangeLabel: t.name,
      });
    }
    lastIndex = idx;
  });
  return groups;
}

function EventChips({
  events,
  date,
  people,
  onOpen,
  max,
  ctx,
}: {
  events: EventItem[];
  date: string;
  people: Person[];
  onOpen: (e: EventItem) => void;
  max?: number;
  /** When given and not read-only, chips become drag sources: drag a chip
   *  onto another day's cell to move the event there. A plain click still
   *  opens the detail modal. */
  ctx?: TableCtx;
}) {
  const sorted = sortEvents(events);
  const shown = max != null ? sorted.slice(0, max) : sorted;
  const draggable = ctx != null && !ctx.readOnly;
  return (
    <div className="flex flex-col gap-0.5">
      {shown.map((e) => (
        <button
          key={e.id}
          type="button"
          aria-label={`${eventHeadline(e, people)}（${dayLabel(date)}）ドラッグで別の日へ移動、クリックで詳細`}
          title={draggable ? "ドラッグで別の日へ移動できます" : undefined}
          draggable={draggable}
          className={`rounded bg-[var(--accent)]/10 px-1.5 py-0.5 text-left text-xs leading-snug hover:bg-[var(--accent)]/20 ${
            draggable ? "cursor-grab touch-none active:cursor-grabbing" : ""
          } ${ctx?.draggingEventId === e.id ? "opacity-40" : ""}`}
          onDragStart={
            draggable
              ? (ev) =>
                  ctx.onHtmlDragStart(
                    { kind: "event", eventId: e.id, sourceDate: date },
                    ev,
                  )
              : undefined
          }
          onDragEnd={draggable ? () => ctx.onHtmlDragEnd() : undefined}
          onPointerDown={
            draggable
              ? (ev) => ctx.onPointerStartEvent(e, date, ev)
              : undefined
          }
          onClick={(ev) => {
            ev.stopPropagation();
            if (ctx?.shouldSuppressClick()) return;
            onOpen(e);
          }}
        >
          {draggable && (
            <span aria-hidden="true" className="mr-0.5 text-[var(--dim)]">⠿</span>
          )}
          {e.startsAt && (
            <span className="mr-1 tabular-nums text-[var(--dim)]">{e.startsAt}</span>
          )}
          {e.datePrecision === "range" && e.startsOn && e.startsOn < date && (
            <span className="mr-0.5 text-[var(--dim)]">▸</span>
          )}
          {eventHeadline(e, people)}
          {e.category === "休暇" && e.leaveType && (
            <span className="ml-0.5 text-[var(--dim)]">（{e.leaveType}）</span>
          )}
          {e.certainty === "tentative" && <span className="text-[var(--dim)]">（仮）</span>}
          {e.certainty === "draft" && <span className="text-[var(--dim)]">（案）</span>}
          {e.endsOn && e.startsOn && e.endsOn > e.startsOn && (
            <span className="ml-0.5 text-[var(--dim)]">
              〜{Number(e.endsOn.slice(8, 10))}日
            </span>
          )}
        </button>
      ))}
      {max != null && sorted.length > max && (
        <span className="px-1 text-xs text-[var(--dim)]">他{sorted.length - max}件</span>
      )}
    </div>
  );
}

function QuickAdd({
  label,
  onAdd,
}: {
  label: string;
  onAdd: (
    title: string,
    anchor: { top: number; bottom: number; left: number } | null,
  ) => void;
}) {
  const [text, setText] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) {
          const input = e.currentTarget.querySelector("input");
          const rect = input?.getBoundingClientRect();
          onAdd(
            text.trim(),
            rect ? { top: rect.top, bottom: rect.bottom, left: rect.left } : null,
          );
          setText("");
        }
      }}
    >
      <input
        aria-label={label}
        className="w-full min-w-16 bg-transparent px-1 py-0.5 text-xs outline-none focus:bg-[var(--surface)]"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
    </form>
  );
}

function DailyEditor({
  ctx,
  item,
  date,
  targetId,
}: {
  ctx: TableCtx;
  item: ItemDef;
  date: string;
  targetId: number | null;
}) {
  const v = getDaily(ctx, date, item.id, targetId);
  const set = (patch: Partial<SetDailyArgs>) =>
    ctx.onSetDaily({
      date,
      itemDefinitionId: item.id,
      targetId,
      slot: "all_day",
      valueText: null,
      valueNumber: null,
      valueOptionId: null,
      valuePersonId: null,
      ...patch,
    });
  if (ctx.readOnly || ctx.compact) {
    const text = dailyDisplay(ctx, item, v);
    return text ? <span className="text-xs">{text}</span> : null;
  }
  if (item.valueType === "symbol" || item.valueType === "boolean") {
    return (
      <select
        aria-label={`${item.name}（${date}）`}
        className="w-full min-w-14 rounded border border-transparent bg-transparent px-0.5 py-0.5 text-sm hover:border-[var(--border)]"
        value={v?.valueOptionId != null ? String(v.valueOptionId) : ""}
        onChange={(e) =>
          set({ valueOptionId: e.target.value === "" ? null : Number(e.target.value) })
        }
      >
        <option value="">—</option>
        {item.options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
            {o.meaning ? `（${o.meaning}）` : ""}
          </option>
        ))}
      </select>
    );
  }
  if (item.valueType === "person") {
    return (
      <select
        aria-label={`${item.name}（${date}）`}
        className="w-full min-w-16 rounded border border-transparent bg-transparent px-0.5 py-0.5 text-sm hover:border-[var(--border)]"
        value={v?.valuePersonId != null ? String(v.valuePersonId) : ""}
        onChange={(e) =>
          set({ valuePersonId: e.target.value === "" ? null : Number(e.target.value) })
        }
      >
        <option value="">—</option>
        {ctx.bootstrap.people.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
    );
  }
  return (
    <input
      aria-label={`${item.name}（${date}）`}
      className="w-full min-w-16 rounded border border-transparent bg-transparent px-0.5 py-0.5 text-sm hover:border-[var(--border)] focus:border-[var(--border)]"
      defaultValue={
        item.valueType === "number"
          ? v?.valueNumber != null
            ? String(v.valueNumber)
            : ""
          : (v?.valueText ?? "")
      }
      key={`${date}-${item.id}-${targetId ?? "x"}-${v?.id ?? 0}`}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      onBlur={(e) => {
        const raw = e.target.value.trim();
        if (item.valueType === "number") {
          set({ valueNumber: raw === "" ? null : Number(raw) });
        } else if (raw !== (v?.valueText ?? "")) {
          set({ valueText: raw === "" ? null : raw });
        }
      }}
    />
  );
}

/**
 * Editor for a whole target range at once (e.g. all grades). Writing here
 * applies the same value to every target in the range, so a shared dismissal
 * time is entered once instead of once per grade.
 */
function GroupedDailyEditor({
  ctx,
  item,
  date,
  targetIds,
  rangeLabel,
}: {
  ctx: TableCtx;
  item: ItemDef;
  date: string;
  targetIds: number[];
  rangeLabel: string;
}) {
  const firstId = targetIds[0] ?? null;
  const v = firstId != null ? getDaily(ctx, date, item.id, firstId) : undefined;
  const setAll = (patch: Partial<SetDailyArgs>) => {
    for (const targetId of targetIds) {
      ctx.onSetDaily({
        date,
        itemDefinitionId: item.id,
        targetId,
        slot: "all_day",
        valueText: null,
        valueNumber: null,
        valueOptionId: null,
        valuePersonId: null,
        ...patch,
      });
    }
  };
  const label = `${item.name}（${rangeLabel}、${date}）`;
  if (item.valueType === "symbol" || item.valueType === "boolean") {
    return (
      <select
        aria-label={label}
        className="w-full min-w-14 rounded border border-transparent bg-transparent px-0.5 py-0.5 text-sm hover:border-[var(--border)]"
        value={v?.valueOptionId != null ? String(v.valueOptionId) : ""}
        onChange={(e) =>
          setAll({ valueOptionId: e.target.value === "" ? null : Number(e.target.value) })
        }
      >
        <option value="">—</option>
        {item.options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
            {o.meaning ? `（${o.meaning}）` : ""}
          </option>
        ))}
      </select>
    );
  }
  if (item.valueType === "person") {
    return (
      <select
        aria-label={label}
        className="w-full min-w-16 rounded border border-transparent bg-transparent px-0.5 py-0.5 text-sm hover:border-[var(--border)]"
        value={v?.valuePersonId != null ? String(v.valuePersonId) : ""}
        onChange={(e) =>
          setAll({ valuePersonId: e.target.value === "" ? null : Number(e.target.value) })
        }
      >
        <option value="">—</option>
        {ctx.bootstrap.people.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
    );
  }
  return (
    <input
      aria-label={label}
      className="w-full min-w-16 rounded border border-transparent bg-transparent px-0.5 py-0.5 text-sm hover:border-[var(--border)] focus:border-[var(--border)]"
      defaultValue={
        item.valueType === "number"
          ? v?.valueNumber != null
            ? String(v.valueNumber)
            : ""
          : (v?.valueText ?? "")
      }
      key={`${date}-${item.id}-range-${targetIds.join(".")}-${v?.id ?? 0}`}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      onBlur={(e) => {
        const raw = e.target.value.trim();
        if (item.valueType === "number") {
          setAll({ valueNumber: raw === "" ? null : Number(raw) });
        } else if (raw !== (v?.valueText ?? "")) {
          setAll({ valueText: raw === "" ? null : raw });
        }
      }}
    />
  );
}

/**
 * Small grip for moving a filled daily cell (e.g. 下校時刻) to another day.
 * Shown only when the cell holds a value; dragging it moves every target
 * row of that item on that date. The editors themselves stay click-to-edit.
 */
function DailyDragHandle({
  ctx,
  item,
  date,
  hasValue,
}: {
  ctx: TableCtx;
  item: ItemDef;
  date: string;
  hasValue: boolean;
}) {
  if (!hasValue || ctx.readOnly || ctx.compact) return null;
  const key = `${item.id}:${date}`;
  return (
    <button
      type="button"
      draggable
      aria-label={`${item.name}（${dayLabel(date)}）をドラッグで別の日へ移動`}
      title="ドラッグで別の日へ移動できます"
      className={`shrink-0 cursor-grab touch-none rounded px-0.5 text-xs text-[var(--dim)] hover:bg-[var(--bg)] active:cursor-grabbing ${
        ctx.draggingDailyKey === key ? "opacity-40" : ""
      }`}
      onDragStart={(e) =>
        ctx.onHtmlDragStart({ kind: "daily", itemId: item.id, fromDate: date }, e)
      }
      onDragEnd={() => ctx.onHtmlDragEnd()}
      onPointerDown={(e) => ctx.onPointerStartDaily(item.id, date, item.name, e)}
      onClick={(e) => e.stopPropagation()}
    >
      ⠿
    </button>
  );
}

function DailyCell({ ctx, item, date }: { ctx: TableCtx; item: ItemDef; date: string }) {
  const [expanded, setExpanded] = useState(false);
  const group =
    item.targetGroupId != null
      ? ctx.bootstrap.targetGroups.find((g) => g.id === item.targetGroupId)
      : null;
  if (!group || group.targets.length === 0) {
    const hasValue =
      dailyDisplay(ctx, item, getDaily(ctx, date, item.id, null)) !== "";
    return (
      <div className="flex items-start gap-0.5">
        <DailyDragHandle ctx={ctx} item={item} date={date} hasValue={hasValue} />
        <div className="min-w-0 flex-1">
          <DailyEditor ctx={ctx} item={item} date={date} targetId={null} />
        </div>
      </div>
    );
  }
  const targets = group.targets;

  // Read-only / print: collapse consecutive targets that share a value.
  // All grades the same -> one line "1～6年 14:30～14:40"; differing values
  // stay one group per distinct run, so nothing is hidden.
  if (ctx.readOnly || ctx.compact) {
    const groups = groupedDaily(ctx, item, date, targets);
    if (groups.length === 0) return null;
    return (
      <div className="flex flex-col gap-0.5">
        {groups.map((g) => (
          <span key={g.targetIds.join(".")} className="text-xs whitespace-nowrap">
            {g.rangeLabel} {g.text}
          </span>
        ))}
      </div>
    );
  }

  const texts = targets.map((t) =>
    dailyDisplay(ctx, item, getDaily(ctx, date, item.id, t.id)),
  );
  const allSame = texts.every((t) => t === (texts[0] ?? ""));
  const rangeLabel = targetRangeLabel(targets.map((t) => t.name));

  // Editable, and every target holds the same value (including all empty):
  // one range editor for the whole group, e.g. "1～6年 [14:30〜14:40]".
  // "学年別" expands to per-grade editors when one grade needs to differ.
  if (allSame && !expanded) {
    return (
      <div className="flex items-center gap-1">
        <DailyDragHandle
          ctx={ctx}
          item={item}
          date={date}
          hasValue={(texts[0] ?? "") !== ""}
        />
        <span className="shrink-0 text-xs whitespace-nowrap text-[var(--dim)]">
          {rangeLabel}
        </span>
        <GroupedDailyEditor
          ctx={ctx}
          item={item}
          date={date}
          targetIds={targets.map((t) => t.id)}
          rangeLabel={rangeLabel}
        />
        {targets.length > 1 && (
          <button
            type="button"
            aria-label={`${item.name}（${date}）を学年別に編集`}
            className="shrink-0 rounded border border-[var(--border)] px-1 py-0.5 text-[10px] text-[var(--dim)]"
            onClick={() => setExpanded(true)}
          >
            学年別
          </button>
        )}
      </div>
    );
  }

  // Values differ (or the teacher expanded the cell): one editor per target,
  // so every grade's own time stays visible and editable.
  return (
    <div className="flex flex-col gap-0.5">
      <DailyDragHandle
        ctx={ctx}
        item={item}
        date={date}
        hasValue={texts.some((t) => t !== "")}
      />
      {targets.map((t) => (
        <div key={t.id} className="flex items-center gap-1">
          <span className="shrink-0 text-xs text-[var(--dim)]">{t.name}</span>
          <DailyEditor ctx={ctx} item={item} date={date} targetId={t.id} />
        </div>
      ))}
      {allSame && expanded && targets.length > 1 && (
        <button
          type="button"
          aria-label={`${item.name}（${date}）をまとめて表示`}
          className="self-start rounded border border-[var(--border)] px-1 py-0.5 text-[10px] text-[var(--dim)]"
          onClick={() => setExpanded(false)}
        >
          まとめる
        </button>
      )}
    </div>
  );
}

function DutySelect({
  ctx,
  defId,
  date,
  slot,
  assignment,
}: {
  ctx: TableCtx;
  defId: number;
  date: string;
  slot: string;
  assignment: Assignment | undefined;
}) {
  const people = ctx.bootstrap.people;
  const conflicts = assignment
    ? (ctx.conflictByAssignment.get(assignment.id) ?? [])
    : [];
  if (ctx.readOnly || ctx.compact) {
    if (!assignment) return null;
    return (
      <span className="text-xs">
        {personNameOf(people, assignment.personId, assignment.freeTextName)}
      </span>
    );
  }
  const value =
    assignment?.personId != null
      ? `p:${assignment.personId}`
      : assignment?.freeTextName
        ? `f:${assignment.freeTextName}`
        : "";
  return (
    <span className="flex items-center gap-0.5">
      <select
        aria-label={`当番（${date} ${slot}）`}
        className="min-w-16 rounded border border-transparent bg-transparent px-0.5 py-0.5 text-sm hover:border-[var(--border)]"
        value={value}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") ctx.onSetDuty(defId, date, slot, null, null);
          else if (raw.startsWith("p:"))
            ctx.onSetDuty(defId, date, slot, Number(raw.slice(2)), null);
          else ctx.onSetDuty(defId, date, slot, null, raw.slice(2));
        }}
      >
        <option value="">未割当</option>
        {people.map((p) => (
          <option key={p.id} value={`p:${p.id}`}>{p.name}</option>
        ))}
        {assignment?.freeTextName && (
          <option value={`f:${assignment.freeTextName}`}>{assignment.freeTextName}</option>
        )}
      </select>
      {(assignment?.origin === "swap" || assignment?.origin === "substitute") && (
        <span className="shrink-0 rounded bg-[var(--bg)] px-1 text-[10px] text-[var(--dim)]">
          交代
        </span>
      )}
      {conflicts.length > 0 && (
        <button
          type="button"
          aria-label="当番の競合を表示"
          title={conflicts.map((c) => c.eventTitle).join("、")}
          className="shrink-0 rounded bg-[#b45309] px-1 text-[10px] font-bold text-white"
          onClick={ctx.onOpenDutyPanel}
        >
          ⚠競合
        </button>
      )}
    </span>
  );
}

function DutyCell({
  ctx,
  defId,
  date,
}: {
  ctx: TableCtx;
  defId: number;
  date: string;
}) {
  const def = ctx.bootstrap.duties.find((d) => d.id === defId);
  if (!def) return null;
  const find = (d: string, slot: string) =>
    ctx.range.dutyAssignments.find(
      (a) => a.dutyDefinitionId === defId && a.date === d && a.slot === slot,
    );
  if (def.granularity === "week") {
    if (weekdayOf(date) !== 1) return null; // shown on the Monday row
    return (
      <DutySelect ctx={ctx} defId={defId} date={date} slot="week" assignment={find(date, "week")} />
    );
  }
  if (def.granularity === "am_pm") {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="flex items-center gap-1">
          <span className="text-xs text-[var(--dim)]">前</span>
          <DutySelect ctx={ctx} defId={defId} date={date} slot="am" assignment={find(date, "am")} />
        </span>
        <span className="flex items-center gap-1">
          <span className="text-xs text-[var(--dim)]">後</span>
          <DutySelect ctx={ctx} defId={defId} date={date} slot="pm" assignment={find(date, "pm")} />
        </span>
      </div>
    );
  }
  return (
    <DutySelect
      ctx={ctx}
      defId={defId}
      date={date}
      slot="all_day"
      assignment={find(date, "all_day")}
    />
  );
}

function dateCellStyle(ctx: TableCtx, date: string): { cls: string; sub: string } {
  const dow = weekdayOf(date);
  const holiday = ctx.holidayMap.get(date);
  const rec = ctx.range.dayRecords.find((d) => d.date === date);
  let cls = "";
  if (dow === 6) cls = "text-[#2563eb]";
  if (dow === 0 || holiday) cls = "text-[#b91c1c]";
  const parts: string[] = [];
  if (holiday) parts.push(holiday);
  if (rec?.dayType && rec.dayType !== "授業日") parts.push(rec.dayType);
  if (rec?.periodPatternId != null) {
    const pat = ctx.bootstrap.periodPatterns.find((p) => p.id === rec.periodPatternId);
    if (pat) parts.push(pat.code);
  }
  if (rec?.note) parts.push(rec.note);
  return { cls, sub: parts.join(" ") };
}

/**
 * Clicking anywhere in a cell (not just on the small field at its top)
 * moves focus into the cell's first editable field, so the whole cell
 * acts as the input target. Clicks that land on a field, a button, or
 * other interactive element are left alone.
 */
function focusCellField(e: ReactMouseEvent<HTMLElement>) {
  const target = e.target as HTMLElement;
  if (target.closest("input, select, textarea, button, a, label")) return;
  const field = e.currentTarget.querySelector<HTMLElement>(
    "input, select, textarea",
  );
  field?.focus();
}

/**
 * Drag handle on the right edge of a table header cell. Dragging adjusts
 * the column width live (preview only); releasing saves it to the view
 * definition. Double-click removes the saved width (back to default).
 * Arrow keys adjust in 8px steps and save immediately.
 */
function ColResizeHandle({
  label,
  width,
  defaultWidth,
  onResize,
}: {
  label: string;
  width: number | null;
  defaultWidth: number;
  onResize: (width: number | null, commit: boolean) => void;
}) {
  const startDrag = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const th = e.currentTarget.closest("th");
    const startWidth = width ?? th?.getBoundingClientRect().width ?? defaultWidth;
    const startX = e.clientX;
    let last = clampColWidth(startWidth);
    const move = (ev: PointerEvent) => {
      last = clampColWidth(startWidth + (ev.clientX - startX));
      onResize(last, false);
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      onResize(last, true);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`${label}の列幅を調整`}
      title="ドラッグで列幅を調整（ダブルクリックで初期幅に戻す）"
      tabIndex={0}
      className="absolute inset-y-0 right-0 z-20 w-2.5 cursor-col-resize touch-none outline-none hover:bg-[var(--accent)]/40 focus-visible:bg-[var(--accent)]/40"
      onPointerDown={startDrag}
      onDoubleClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onResize(null, true);
      }}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const base = width ?? defaultWidth;
        onResize(clampColWidth(base + (e.key === "ArrowRight" ? 8 : -8)), true);
      }}
    />
  );
}

function RowsTable({
  ctx,
  dates,
}: {
  ctx: TableCtx;
  dates: string[];
}) {
  const isClosed = (date: string) => {
    const dow = weekdayOf(date);
    const rec = ctx.range.dayRecords.find((d) => d.date === date);
    return dow === 0 || dow === 6 || ctx.holidayMap.has(date) || rec?.dayType === "休業日";
  };
  // Column widths are drag-adjustable on screen (not in the print sheet).
  // Fixed layout + colgroup makes the saved px widths exact; columns
  // without a saved width share the remaining space equally.
  const resizable = !ctx.readOnly && ctx.onResizeColumn != null;
  const dateW = ctx.colWidths["date"];
  const minTableWidth = resizable
    ? (dateW ?? 64) +
      ctx.columns.reduce((sum, c) => sum + (ctx.colWidths[columnWidthKey(c)] ?? 160), 0)
    : undefined;
  return (
    <div className="overflow-x-auto">
      <table
        className={`${resizable ? "w-full table-fixed" : "min-w-full"} border-collapse text-sm`}
        style={minTableWidth != null ? { minWidth: minTableWidth } : undefined}
      >
        {resizable && (
          <colgroup>
            <col style={{ width: dateW ?? 64 }} />
            {ctx.columns.map((c, i) => (
              <col key={i} style={{ width: ctx.colWidths[columnWidthKey(c)] }} />
            ))}
          </colgroup>
        )}
        <thead>
          <tr className="bg-[var(--bg)]">
            <th
              className={`sticky left-0 z-10 border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-left font-medium${resizable ? "" : " w-16"}`}
            >
              日
              {resizable && (
                <ColResizeHandle
                  label="日"
                  width={dateW ?? null}
                  defaultWidth={64}
                  onResize={(w, commit) => ctx.onResizeColumn?.("date", w, commit)}
                />
              )}
            </th>
            {ctx.columns.map((c, i) => {
              const wKey = columnWidthKey(c);
              return (
                <th
                  key={i}
                  className={`border border-[var(--border)] px-2 py-1 text-left font-medium${resizable ? " relative" : " min-w-40"}`}
                >
                  {c.label}
                  {resizable && (
                    <ColResizeHandle
                      label={c.label}
                      width={ctx.colWidths[wKey] ?? null}
                      defaultWidth={160}
                      onResize={(w, commit) => ctx.onResizeColumn?.(wKey, w, commit)}
                    />
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {dates.map((date) => {
            const { cls, sub } = dateCellStyle(ctx, date);
            return (
              <tr key={date} className={isClosed(date) ? "bg-[var(--bg)]/60" : ""}>
                <td className="sticky left-0 z-10 border border-[var(--border)] bg-[var(--surface)] px-2 py-1 align-top">
                  {ctx.readOnly ? (
                    <span className={`font-medium ${cls}`}>
                      {Number(date.slice(8, 10))}
                      <span className="ml-0.5 text-xs">（{WEEKDAYS[weekdayOf(date)]}）</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-label={`${dayLabel(date)}の日課を編集`}
                      className={`font-medium ${cls}`}
                      onClick={() => ctx.onDayClick(date)}
                    >
                      {Number(date.slice(8, 10))}
                      <span className="ml-0.5 text-xs">（{WEEKDAYS[weekdayOf(date)]}）</span>
                    </button>
                  )}
                  {sub && <div className="text-[10px] leading-tight text-[var(--dim)]">{sub}</div>}
                </td>
                {ctx.columns.map((c, i) => {
                  const target =
                    c.kind === "category"
                      ? { date, category: c.category ?? null }
                      : c.kind === "daily_item"
                        ? { date, itemId: c.itemId ?? null }
                        : { date };
                  const key = dropKeyOf(
                    target.date,
                    "category" in target ? target.category : null,
                    "itemId" in target ? target.itemId : null,
                  );
                  return (
                  <td
                    key={i}
                    className={`border border-[var(--border)] px-1 py-1 align-top${dropHighlightCls(ctx, key)}`}
                    onClick={ctx.readOnly ? undefined : focusCellField}
                    {...dropTargetProps(ctx, target)}
                  >
                    {c.kind === "category" && (
                      <>
                        <EventChips
                          events={eventsOnDate(ctx.range.events, date).filter(
                            (e) => e.category === c.category,
                          )}
                          date={date}
                          people={ctx.bootstrap.people}
                          onOpen={ctx.onOpenEvent}
                          ctx={ctx}
                        />
                        {!ctx.readOnly && (
                          <QuickAdd
                            label={`${dayLabel(date)}の${c.label}に追加`}
                            onAdd={(title, anchor) => ctx.onQuickAdd(date, c.category ?? "行事", title, anchor)}
                          />
                        )}
                      </>
                    )}
                    {c.kind === "daily_item" &&
                      (() => {
                        const item = ctx.bootstrap.items.find((it) => it.id === c.itemId);
                        if (!item) return <span className="text-xs text-[var(--dim)]">（項目なし）</span>;
                        return <DailyCell ctx={ctx} item={item} date={date} />;
                      })()}
                    {c.kind === "duty" && c.dutyId != null && (
                      <DutyCell ctx={ctx} defId={c.dutyId} date={date} />
                    )}
                  </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------- L3: year columns ----------------
function YearView({
  ctx,
  schoolYear,
}: {
  ctx: TableCtx;
  schoolYear: number;
}) {
  const months: { y: number; m: number }[] = [];
  for (let i = 0; i < 12; i++) {
    const m = 4 + i;
    months.push(m <= 12 ? { y: schoolYear, m } : { y: schoolYear + 1, m: m - 12 });
  }
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {months.map(({ y, m }) => {
        const first = `${y}-${String(m).padStart(2, "0")}-01`;
        const dates = eachDate(first, monthEnd(first));
        return (
          <div key={first} className="min-w-96 shrink-0">
            <h3 className="mb-1 font-serif text-base font-bold">{m}月</h3>
            <RowsTable ctx={ctx} dates={dates} />
          </div>
        );
      })}
    </div>
  );
}

// ---------------- L6: transposed (rows = targets, columns = days) ----------------
/**
 * Transposed table (DESIGN §4.8): the row axis is a target group (clubs,
 * grades…) taken from the view's daily-item columns, the column axis is
 * the days of the displayed month. Each cell holds that target's daily
 * values for the day, plus any events assigned to that target.
 */
function TransposedView({
  ctx,
  dates,
}: {
  ctx: TableCtx;
  dates: string[];
}) {
  const itemCols = ctx.columns.filter((c) => c.kind === "daily_item");
  const items = itemCols
    .map((c) => ctx.bootstrap.items.find((i) => i.id === c.itemId))
    .filter((i): i is ItemDef => i != null);
  const groupItem = items.find((i) => i.targetGroupId != null) ?? null;
  const group =
    groupItem?.targetGroupId != null
      ? ctx.bootstrap.targetGroups.find((g) => g.id === groupItem.targetGroupId)
      : null;
  if (!groupItem || !group) {
    return (
      <p className="p-3 text-sm text-[var(--dim)]">
        転置表には、対象軸（学年・部活動など）を持つ日次項目の列が必要です。ビューの列に、下校時刻や部活動のような対象別項目を入れてください。
      </p>
    );
  }
  if (group.targets.length === 0) {
    return (
      <p className="p-3 text-sm text-[var(--dim)]">
        「{group.name}」の対象がまだ登録されていません。設定画面の「対象軸」で{group.name}の対象（部活動なら各部）を追加すると、行として並びます。
      </p>
    );
  }
  const shownItems = items.filter((i) => i.targetGroupId === group.id);
  const otherItems = items.filter((i) => i.targetGroupId !== group.id);
  const hasLooseValues = ctx.range.dailyValues.some(
    (d) =>
      d.targetId == null &&
      shownItems.some((i) => i.id === d.itemDefinitionId),
  );
  const rows: { targetId: number | null; name: string }[] = [
    ...group.targets.map((t) => ({ targetId: t.id as number | null, name: t.name })),
    ...(hasLooseValues ? [{ targetId: null, name: "（対象指定なし）" }] : []),
  ];
  // Same drag-resize as the row tables: the target column has its own
  // width; all day columns share one uniform width.
  const resizable = !ctx.readOnly && ctx.onResizeColumn != null;
  const targetW = ctx.colWidths["target"];
  const dayW = ctx.colWidths["day"];
  const minTableWidth = resizable
    ? (targetW ?? 140) + dates.length * (dayW ?? 112)
    : undefined;
  return (
    <div className="overflow-x-auto">
      <table
        className={`w-full border-collapse text-sm${resizable ? " table-fixed" : ""}`}
        style={minTableWidth != null ? { minWidth: minTableWidth } : undefined}
      >
        {resizable && (
          <colgroup>
            <col style={{ width: targetW ?? 140 }} />
            {dates.map((date) => (
              <col key={date} style={{ width: dayW ?? 112 }} />
            ))}
          </colgroup>
        )}
        <thead>
          <tr className="bg-[var(--bg)]">
            <th className="sticky left-0 z-10 border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-left font-medium">
              {group.name}
              {resizable && (
                <ColResizeHandle
                  label={group.name}
                  width={targetW ?? null}
                  defaultWidth={140}
                  onResize={(w, commit) => ctx.onResizeColumn?.("target", w, commit)}
                />
              )}
            </th>
            {dates.map((date) => {
              const { cls } = dateCellStyle(ctx, date);
              return (
                <th
                  key={date}
                  className={`border border-[var(--border)] px-1 py-1 text-center font-medium ${cls}${resizable ? " relative" : ""}`}
                >
                  {Number(date.slice(8, 10))}
                  <span className="ml-0.5 text-[10px]">({WEEKDAYS[weekdayOf(date)]})</span>
                  {resizable && (
                    <ColResizeHandle
                      label="日"
                      width={dayW ?? null}
                      defaultWidth={112}
                      onResize={(w, commit) => ctx.onResizeColumn?.("day", w, commit)}
                    />
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.targetId ?? "none"}>
              <th className="sticky left-0 z-10 border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-left align-top font-medium whitespace-nowrap">
                {row.name}
              </th>
              {dates.map((date) => {
                const key = dropKeyOf(date);
                const targetEvents =
                  row.targetId != null
                    ? eventsOnDate(ctx.range.events, date).filter((e) =>
                        e.targetIds.includes(row.targetId as number),
                      )
                    : [];
                return (
                  <td
                    key={date}
                    className={`${resizable ? "" : "min-w-28 "}border border-[var(--border)] px-1 py-1 align-top${dropHighlightCls(ctx, key)}`}
                    onClick={ctx.readOnly ? undefined : focusCellField}
                    {...dropTargetProps(ctx, { date })}
                  >
                    <div className="flex flex-col gap-0.5">
                      {shownItems.map((item) => (
                        <span key={item.id} className="flex items-baseline gap-1">
                          {shownItems.length > 1 && (
                            <span className="shrink-0 text-[10px] text-[var(--dim)]">
                              {item.name}
                            </span>
                          )}
                          <DailyEditor
                            ctx={ctx}
                            item={item}
                            date={date}
                            targetId={row.targetId}
                          />
                        </span>
                      ))}
                      {targetEvents.length > 0 && (
                        <EventChips
                          events={targetEvents}
                          date={date}
                          people={ctx.bootstrap.people}
                          onOpen={ctx.onOpenEvent}
                          ctx={ctx}
                        />
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {otherItems.length > 0 && (
        <p className="px-2 py-1 text-xs text-[var(--dim)]">
          ※ {otherItems.map((i) => i.name).join("、")} は、この転置表の対象軸（{group.name}）の項目ではないため表示していません。
        </p>
      )}
    </div>
  );
}

// ---------------- L4: calendar grid ----------------
function CalendarGrid({
  ctx,
  anchor,
  onDayDetail,
}: {
  ctx: TableCtx;
  anchor: string;
  onDayDetail: (date: string) => void;
}) {
  const start = mondayOf(monthStart(anchor));
  const endD = parseDate(monthEnd(anchor));
  const end = addDays(monthEnd(anchor), (7 - endD.getDay()) % 7);
  const days = eachDate(start, end);
  const month = anchor.slice(0, 7);
  const symbolItems = ctx.items.filter(
    (i) => i.valueType === "symbol" || i.valueType === "boolean",
  );
  return (
    <div className="overflow-x-auto">
      <div className="min-w-175">
        <div className="grid grid-cols-7 border-l border-t border-[var(--border)]">
          {WEEKDAYS.map((w, i) => (
            <div
              key={w}
              className={`border-b border-r border-[var(--border)] bg-[var(--bg)] px-1 py-0.5 text-center text-xs font-medium ${i === 6 ? "text-[#2563eb]" : i === 0 ? "text-[#b91c1c]" : ""}`}
            >
              {w}
            </div>
          ))}
          {days.map((date) => {
            const inMonth = date.slice(0, 7) === month;
            const { cls } = dateCellStyle(ctx, date);
            const dayEvents = eventsOnDate(ctx.range.events, date);
            const key = dropKeyOf(date);
            return (
              <button
                key={date}
                type="button"
                aria-label={`${dayLabel(date)}の詳細`}
                className={`min-h-24 border-b border-r border-[var(--border)] p-1 text-left align-top ${inMonth ? "" : "opacity-40"}${dropHighlightCls(ctx, key)}`}
                onClick={() => {
                  if (ctx.shouldSuppressClick()) return;
                  onDayDetail(date);
                }}
                {...dropTargetProps(ctx, { date })}
              >
                <span className={`text-sm font-medium ${cls}`}>
                  {Number(date.slice(8, 10))}
                </span>
                {ctx.holidayMap.get(date) && (
                  <span className="ml-1 text-[10px] text-[#b91c1c]">
                    {ctx.holidayMap.get(date)}
                  </span>
                )}
                <EventChips events={dayEvents} date={date} people={ctx.bootstrap.people} onOpen={ctx.onOpenEvent} max={3} ctx={ctx} />
                <div className="mt-0.5 flex gap-1 text-[10px] text-[var(--dim)]">
                  {symbolItems.slice(0, 3).map((item) => {
                    const v = getDaily(ctx, date, item.id, null);
                    const text = dailyDisplay(ctx, item, v);
                    return text ? (
                      <span key={item.id}>
                        {item.name}:{text}
                      </span>
                    ) : null;
                  })}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------- L5: week timeline ----------------
function TimelineView({
  ctx,
  weekStart,
  axis,
  onSlotCreate,
}: {
  ctx: TableCtx;
  weekStart: string;
  axis: "time" | "period";
  onSlotCreate: (date: string, draft: EventDraft) => void;
}) {
  const days = eachDate(weekStart, addDays(weekStart, 6));
  const pattern = ctx.bootstrap.periodPatterns[0] ?? null;
  const HOUR_H = 48;
  const START_H = 7;
  const END_H = 19;

  const band = (date: string) => {
    const allDay = eventsOnDate(ctx.range.events, date).filter(
      (e) => e.isAllDay === 1 || !e.startsAt,
    );
    const key = dropKeyOf(date);
    return (
      <div
        className={`min-h-10 border-b border-r border-[var(--border)] p-0.5${dropHighlightCls(ctx, key)}`}
        onClick={ctx.readOnly ? undefined : focusCellField}
        {...dropTargetProps(ctx, { date })}
      >
        <EventChips events={allDay} date={date} people={ctx.bootstrap.people} onOpen={ctx.onOpenEvent} ctx={ctx} />
        {!ctx.readOnly && (
          <QuickAdd
            label={`${dayLabel(date)}の終日予定を追加`}
            onAdd={(title, anchor) => ctx.onQuickAdd(date, "行事", title, anchor)}
          />
        )}
      </div>
    );
  };

  return (
    <div className="overflow-x-auto">
      <div className="min-w-175">
        <div
          className="grid border-l border-t border-[var(--border)]"
          style={{ gridTemplateColumns: `44px repeat(7, 1fr)` }}
        >
          <div className="border-b border-r border-[var(--border)] bg-[var(--bg)] px-1 py-1 text-xs text-[var(--dim)]">
            終日
          </div>
          {days.map((date) => (
            <div key={date} className="border-b border-r border-[var(--border)] bg-[var(--bg)] px-1 py-1 text-center">
              <span className={`text-sm font-medium ${dateCellStyle(ctx, date).cls}`}>
                {dayLabel(date)}
              </span>
              {ctx.holidayMap.get(date) && (
                <span className="ml-1 text-[10px] text-[#b91c1c]">{ctx.holidayMap.get(date)}</span>
              )}
            </div>
          ))}
          <div className="border-b border-r border-[var(--border)]" />
          {days.map((date) => (
            <div key={`band-${date}`}>{band(date)}</div>
          ))}
        </div>

        {axis === "time" ? (
          <div
            className="grid border-l border-[var(--border)]"
            style={{ gridTemplateColumns: `44px repeat(7, 1fr)` }}
          >
            <div className="relative border-b border-r border-[var(--border)]" style={{ height: (END_H - START_H) * HOUR_H }}>
              {Array.from({ length: END_H - START_H }, (_, i) => (
                <div
                  key={i}
                  className="absolute right-1 text-[10px] text-[var(--dim)]"
                  style={{ top: i * HOUR_H + 2 }}
                >
                  {START_H + i}:00
                </div>
              ))}
            </div>
            {days.map((date) => {
              const timed = eventsOnDate(ctx.range.events, date).filter(
                (e) => e.isAllDay === 0 && e.startsAt,
              );
              const lanes = new Map<number, number>();
              const sorted = [...timed].sort((a, b) =>
                (a.startsAt ?? "") < (b.startsAt ?? "") ? -1 : 1,
              );
              const laneEnds: string[] = [];
              for (const e of sorted) {
                let lane = laneEnds.findIndex((end) => end <= (e.startsAt ?? ""));
                if (lane < 0) {
                  lane = laneEnds.length;
                  laneEnds.push(e.endsAt ?? e.startsAt ?? "");
                } else {
                  laneEnds[lane] = e.endsAt ?? e.startsAt ?? "";
                }
                lanes.set(e.id, lane);
              }
              const laneCount = Math.max(1, laneEnds.length);
              const key = dropKeyOf(date);
              return (
                <div
                  key={date}
                  className={`relative border-b border-r border-[var(--border)]${dropHighlightCls(ctx, key)}`}
                  style={{
                    height: (END_H - START_H) * HOUR_H,
                    backgroundImage:
                      "repeating-linear-gradient(to bottom, transparent, transparent 47px, var(--border) 47px, var(--border) 48px)",
                  }}
                  {...dropTargetProps(ctx, { date })}
                  onClick={(ev) => {
                    if (ctx.shouldSuppressClick()) return;
                    const rect = ev.currentTarget.getBoundingClientRect();
                    const y = ev.clientY - rect.top;
                    const minutes = START_H * 60 + Math.floor((y / HOUR_H) * 60 / 30) * 30;
                    const sh = Math.floor(minutes / 60);
                    const sm = minutes % 60;
                    const startsAt = `${String(sh).padStart(2, "0")}:${String(sm).padStart(2, "0")}`;
                    const endsAt = `${String(Math.min(23, sh + 1)).padStart(2, "0")}:${String(sm).padStart(2, "0")}`;
                    onSlotCreate(date, { date, startsAt, endsAt });
                  }}
                >
                  {sorted.map((e) => {
                    const [sh = 0, sm = 0] = (e.startsAt ?? "0:0").split(":").map(Number);
                    const [eh = sh, em = sm] = (e.endsAt ?? e.startsAt ?? "0:0")
                      .split(":")
                      .map(Number);
                    const top = ((sh * 60 + sm - START_H * 60) / 60) * HOUR_H;
                    const height = Math.max(
                      22,
                      ((eh * 60 + em - (sh * 60 + sm)) / 60) * HOUR_H,
                    );
                    const lane = lanes.get(e.id) ?? 0;
                    const width = 100 / laneCount;
                    return (
                      <button
                        key={e.id}
                        type="button"
                        aria-label={`${eventHeadline(e, ctx.bootstrap.people)}（${dayLabel(date)}）ドラッグで別の日へ移動、クリックで詳細`}
                        title={!ctx.readOnly ? "ドラッグで別の日へ移動できます" : undefined}
                        draggable={!ctx.readOnly}
                        className={`absolute overflow-hidden rounded bg-[var(--accent)] px-1 py-0.5 text-left text-[11px] leading-tight text-white ${
                          !ctx.readOnly ? "cursor-grab touch-none active:cursor-grabbing" : ""
                        } ${ctx.draggingEventId === e.id ? "opacity-40" : ""}`}
                        style={{
                          top,
                          height,
                          left: `${lane * width}%`,
                          width: `calc(${width}% - 2px)`,
                        }}
                        onDragStart={
                          !ctx.readOnly
                            ? (ev) =>
                                ctx.onHtmlDragStart(
                                  { kind: "event", eventId: e.id, sourceDate: date },
                                  ev,
                                )
                            : undefined
                        }
                        onDragEnd={!ctx.readOnly ? () => ctx.onHtmlDragEnd() : undefined}
                        onPointerDown={
                          !ctx.readOnly
                            ? (ev) => ctx.onPointerStartEvent(e, date, ev)
                            : undefined
                        }
                        onClick={(ev) => {
                          ev.stopPropagation();
                          if (ctx.shouldSuppressClick()) return;
                          ctx.onOpenEvent(e);
                        }}
                      >
                        {e.startsAt} {eventHeadline(e, ctx.bootstrap.people)}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ) : (
          <div
            className="grid border-l border-[var(--border)]"
            style={{ gridTemplateColumns: `44px repeat(7, 1fr)` }}
          >
            {(pattern?.periods ?? []).map((p) => (
              <Fragment key={p.id}>
                <div
                  className="flex flex-col justify-center border-b border-r border-[var(--border)] bg-[var(--bg)] px-1 py-1 text-xs"
                  style={{ minHeight: 52 }}
                >
                  <span className="font-medium">{p.label}</span>
                  {p.startsAt && (
                    <span className="text-[10px] text-[var(--dim)]">
                      {p.startsAt}〜{p.endsAt ?? ""}
                    </span>
                  )}
                </div>
                {days.map((date) => {
                  const placed = eventsOnDate(ctx.range.events, date).filter((e) => {
                    if (e.isAllDay === 1 || !e.startsAt) return false;
                    if (e.periodFrom != null)
                      return e.periodFrom === p.periodNo;
                    if (p.startsAt && p.endsAt)
                      return e.startsAt >= p.startsAt && e.startsAt < p.endsAt;
                    return false;
                  });
                  const key = dropKeyOf(date);
                  return (
                    <div
                      key={`${p.id}-${date}`}
                      className={`border-b border-r border-[var(--border)] p-0.5${dropHighlightCls(ctx, key)}`}
                      style={{ minHeight: 52 }}
                      {...dropTargetProps(ctx, { date })}
                      onClick={() => {
                        if (ctx.shouldSuppressClick()) return;
                        onSlotCreate(date, {
                          date,
                          startsAt: p.startsAt,
                          endsAt: p.endsAt,
                          periodFrom: p.periodNo >= 1 && p.periodNo <= 90 ? p.periodNo : null,
                        });
                      }}
                    >
                      <EventChips events={placed} date={date} people={ctx.bootstrap.people} onOpen={ctx.onOpenEvent} ctx={ctx} />
                    </div>
                  );
                })}
              </Fragment>
            ))}
            {(pattern?.periods ?? []).length === 0 && (
              <p className="col-span-8 p-2 text-sm text-[var(--dim)]">
                時限パターンが未登録です。設定画面で日課パターンを登録すると時限軸が使えます。
              </p>
            )}
          </div>
        )}
        <p className="mt-1 text-xs text-[var(--dim)]">
          空いている時間帯（時限）をクリックすると、その時間が初期値になった状態で予定の詳細入力が開きます。
        </p>
      </div>
    </div>
  );
}

// ---------------- day record modal ----------------
function DayRecordModal({
  bootstrap,
  date,
  record,
  onClose,
}: {
  bootstrap: Bootstrap;
  date: string;
  record: RangeData["dayRecords"][number] | undefined;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [dayType, setDayType] = useState(record?.dayType ?? "授業日");
  const [patternId, setPatternId] = useState(
    record?.periodPatternId != null ? String(record.periodPatternId) : "",
  );
  const [note, setNote] = useState(record?.note ?? "");
  const save = useMutation({
    mutationFn: async () => {
      await api.setDayRecord({
        date,
        dayType,
        periodPatternId: patternId === "" ? null : Number(patternId),
        note,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries();
      onClose();
    },
  });
  const inputCls =
    "w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" role="dialog" aria-modal="true" aria-label="日課の編集">
      <div className="w-full max-w-sm rounded-t-2xl bg-[var(--surface)] p-4 shadow-xl sm:rounded-2xl">
        <h2 className="mb-3 font-serif text-lg font-bold">{dayLabel(date)} の日課</h2>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs text-[var(--dim)]" htmlFor="dr-type">日の種別</label>
            <select id="dr-type" className={inputCls} value={dayType} onChange={(e) => setDayType(e.target.value)}>
              <option value="授業日">授業日</option>
              <option value="行事日">行事日</option>
              <option value="登校日">登校日（休業中の登校日など）</option>
              <option value="休業日">休業日</option>
              <option value="その他">その他</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-[var(--dim)]" htmlFor="dr-pattern">日課パターン</label>
            <select id="dr-pattern" className={inputCls} value={patternId} onChange={(e) => setPatternId(e.target.value)}>
              <option value="">指定なし</option>
              {bootstrap.periodPatterns.map((p) => (
                <option key={p.id} value={p.id}>{p.name}（{p.code}）</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-[var(--dim)]" htmlFor="dr-note">備考</label>
            <input id="dr-note" className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="例：短縮日課" />
          </div>
          <div className="flex gap-2">
            <button type="button" className="rounded bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-50" disabled={save.isPending} onClick={() => save.mutate()}>
              保存する
            </button>
            <button type="button" className="rounded border border-[var(--border)] px-3 py-2 text-sm" onClick={onClose}>
              閉じる
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------- day detail (from L4) ----------------
function DayDetailModal({
  ctx,
  date,
  onClose,
}: {
  ctx: TableCtx;
  date: string;
  onClose: () => void;
}) {
  const dayEvents = sortEvents(eventsOnDate(ctx.range.events, date));
  const monday = mondayOf(date);
  const duties = ctx.range.dutyAssignments.filter(
    (a) => a.date === date || (a.slot === "week" && a.date === monday),
  );
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" role="dialog" aria-modal="true" aria-label="その日の詳細">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-[var(--surface)] p-4 shadow-xl sm:rounded-2xl">
        <div className="mb-2 flex items-start justify-between">
          <h2 className="font-serif text-lg font-bold">{dayLabel(date)} の詳細</h2>
          <button type="button" aria-label="閉じる" className="rounded border border-[var(--border)] px-2 py-1 text-sm" onClick={onClose}>
            閉じる
          </button>
        </div>
        {ctx.holidayMap.get(date) && (
          <p className="mb-2 text-sm text-[#b91c1c]">{ctx.holidayMap.get(date)}</p>
        )}
        <h3 className="mb-1 text-sm font-bold">予定</h3>
        {dayEvents.length === 0 && <p className="text-sm text-[var(--dim)]">予定はありません。</p>}
        <div className="flex flex-col gap-1">
          {dayEvents.map((e) => (
            <button
              key={e.id}
              type="button"
              className="rounded bg-[var(--bg)] px-2 py-1 text-left text-sm"
              onClick={() => ctx.onOpenEvent(e)}
            >
              <span className="mr-1 rounded bg-[var(--surface)] px-1 text-xs">{e.category}</span>
              {e.startsAt && <span className="mr-1 tabular-nums">{e.startsAt}〜{e.endsAt ?? ""}</span>}
              {eventHeadline(e, ctx.bootstrap.people)}
              {e.category === "休暇" && e.leaveType && (
                <span className="ml-1 text-xs text-[var(--dim)]">分類：{e.leaveType}</span>
              )}
              {e.category !== "休暇" && e.assignees.length > 0 && (
                <span className="ml-1 text-xs text-[var(--dim)]">
                  担当：{e.assignees.map((a) => personNameOf(ctx.bootstrap.people, a.personId, a.freeTextName)).filter(Boolean).join("、")}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="mt-2 rounded border border-[var(--border)] px-2 py-1">
          <QuickAdd
            label={`${dayLabel(date)}に予定を追加`}
            onAdd={(title, anchor) => ctx.onQuickAdd(date, "行事", title, anchor)}
          />
        </div>
        <h3 className="mb-1 mt-3 text-sm font-bold">日次項目</h3>
        <ul className="text-sm">
          {ctx.items.map((item) => {
            const group =
              item.targetGroupId != null
                ? ctx.bootstrap.targetGroups.find((g) => g.id === item.targetGroupId)
                : null;
            if (group && group.targets.length > 0) {
              return groupedDaily(ctx, item, date, group.targets).map((g) => (
                <li key={`${item.id}-${g.targetIds.join(".")}`}>
                  {item.name}（{g.rangeLabel}）：{g.text}
                </li>
              ));
            }
            const text = dailyDisplay(ctx, item, getDaily(ctx, date, item.id, null));
            return text ? (
              <li key={item.id}>
                {item.name}：{text}
              </li>
            ) : null;
          })}
        </ul>
        <h3 className="mb-1 mt-3 text-sm font-bold">当番</h3>
        {duties.length === 0 && <p className="text-sm text-[var(--dim)]">当番の割当はありません。</p>}
        <ul className="text-sm">
          {duties.map((a) => (
            <li key={a.id}>
              {ctx.bootstrap.duties.find((d) => d.id === a.dutyDefinitionId)?.name}：
              {personNameOf(ctx.bootstrap.people, a.personId, a.freeTextName)}
              {(a.origin === "swap" || a.origin === "substitute") && (
                <span className="ml-1 text-xs text-[var(--dim)]">
                  （{a.origin === "substitute" ? "代行" : "交代"}）
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------------- print preview ----------------
function PrintPreview({
  bootstrap,
  view,
  range,
  rangeFrom,
  rangeTo,
  anchor,
  periodLabel,
  schoolYear,
  onClose,
}: {
  bootstrap: Bootstrap;
  view: {
    id: number | null;
    name: string;
    layout: string;
    audience: string;
    printJson: string;
    columnsJson: string;
  } | null;
  range: RangeData;
  rangeFrom: string;
  rangeTo: string;
  anchor: string;
  periodLabel: string;
  schoolYear: number;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const layout = view?.layout ?? "month_rows";
  // The period key a publication is filed under: the school year for the
  // year view, otherwise the month containing the printed range.
  const targetMonth =
    layout === "year_columns" ? `${schoolYear}年度` : rangeFrom.slice(0, 7);
  const periodPublications = bootstrap.publications.filter(
    (p) => p.targetMonth === targetMonth && (view == null || p.viewName === view.name),
  );
  const latest = periodPublications[0];
  const now = new Date();
  const [versionLabel, setVersionLabel] = useState(
    latest?.versionLabel ?? `${now.getMonth() + 1}月${now.getDate()}日修正`,
  );
  const [note, setNote] = useState("");
  const [publishedMsg, setPublishedMsg] = useState("");
  const publish = useMutation({
    mutationFn: async () => {
      await api.createPublication({
        viewDefinitionId: view?.id ?? null,
        viewName: view?.name ?? "予定表",
        targetMonth,
        versionLabel,
        note: note.trim(),
      });
    },
    onSuccess: () => {
      setPublishedMsg("この版を発行履歴に記録しました。");
      void qc.invalidateQueries();
    },
  });
  let paper = "A4";
  let orientation = "landscape";
  try {
    const pj = JSON.parse(view?.printJson ?? "{}") as { paper?: string; orientation?: string };
    paper = pj.paper ?? "A4";
    orientation = pj.orientation ?? "landscape";
  } catch { /* defaults */ }
  const printAudienceRank = audienceRankOf(view?.audience ?? "staff");
  const columns = (() => {
    const fallback = [
      { kind: "category", category: "行事", label: "行事等予定" },
    ] as ColumnDef[];
    if (!view) return fallback;
    let parsed: ColumnDef[] = [];
    try {
      const arr = JSON.parse(view.columnsJson) as ColumnDef[];
      parsed = arr.length > 0 ? arr : fallback;
    } catch {
      parsed = fallback;
    }
    // Same audience whitelist as the screen table: a guardian/student
    // print never carries staff-only items or duty names.
    return audienceColumns(parsed, bootstrap.items, printAudienceRank);
  })();
  const printItems = audienceItems(bootstrap.items, columns, printAudienceRank);
  // Re-filter defensively: the print sheet must be safe even if a caller
  // passes unfiltered range data.
  const printRange = filterRangeForAudience(
    range,
    new Set(printItems.map((i) => i.id)),
    printAudienceRank,
  );
  const holidayMap = new Map(bootstrap.holidays.map((h) => [h.date, h.name]));
  const noop = () => undefined;
  const ctx: TableCtx = {
    bootstrap,
    range: printRange,
    columns,
    items: printItems,
    holidayMap,
    onOpenEvent: noop,
    onQuickAdd: noop,
    onSetDaily: noop,
    onSetDuty: noop,
    onDayClick: noop,
    onOpenDutyPanel: noop,
    conflictByAssignment: new Map(),
    readOnly: true,
    dropKey: null,
    draggingEventId: null,
    draggingDailyKey: null,
    onMoveEvent: noop,
    onMoveDaily: noop,
    onHtmlDragStart: noop,
    onHtmlDragEnd: noop,
    onDragOverCell: noop,
    onDragLeaveCell: noop,
    onDropCell: noop,
    onPointerStartEvent: noop,
    onPointerStartDaily: noop,
    shouldSuppressClick: () => false,
    // Print output keeps its current fit-to-page widths; drag-adjusted
    // screen widths are not applied to the print sheet.
    colWidths: {},
  };
  const rowDates =
    layout === "month_rows"
      ? eachDate(monthStart(anchor), monthEnd(anchor))
      : eachDate(rangeFrom, rangeTo);
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-2 sm:p-4" role="dialog" aria-modal="true" aria-label="印刷プレビュー">
      <style>{`@page { size: ${paper} ${orientation}; margin: 10mm; }`}</style>
      <div className="no-print mb-2 flex w-full flex-wrap items-center gap-2 rounded bg-[var(--surface)] p-2">
        <span className="text-sm font-medium">印刷・PDF（{paper}・{orientation === "landscape" ? "横" : "縦"}）</span>
        <input
          aria-label="版ラベル"
          className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
          value={versionLabel}
          onChange={(e) => setVersionLabel(e.target.value)}
        />
        <input
          aria-label="発行のメモ"
          className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
          placeholder="メモ（配布先など）"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button type="button" className="rounded border border-[var(--border)] px-3 py-1.5 text-sm" disabled={publish.isPending} onClick={() => publish.mutate()}>
          この版を発行として記録
        </button>
        <button type="button" className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-white" onClick={() => window.print()}>
          印刷／PDFで保存
        </button>
        <button type="button" className="rounded border border-[var(--border)] px-3 py-1.5 text-sm" onClick={onClose}>
          閉じる
        </button>
        {publishedMsg && <span className="text-sm">{publishedMsg}</span>}
        {periodPublications.length > 0 && (
          <p className="w-full text-xs text-[var(--dim)]">
            この期間の発行履歴：
            {periodPublications
              .map(
                (p) =>
                  `${p.versionLabel}（${new Date(p.publishedAt).toLocaleDateString("ja-JP")}）${p.note ? `／${p.note}` : ""}`,
              )
              .join("、")}
          </p>
        )}
      </div>
      <div id="print-sheet" className="w-full bg-white p-4 text-black shadow">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2 border-b-2 border-black pb-1">
          <div>
            {bootstrap.settings.schoolName && (
              <p className="font-serif text-sm">{bootstrap.settings.schoolName}</p>
            )}
            <h2 className="font-serif text-xl font-bold">
              {periodLabel} 行事予定表
              {view && <span className="ml-2 text-sm font-normal">（{view.name}）</span>}
            </h2>
          </div>
          <p className="text-sm">版：{versionLabel}</p>
        </div>
        {layout === "year_columns" ? (
          <YearView ctx={ctx} schoolYear={schoolYear} />
        ) : layout === "calendar_grid" ? (
          <CalendarGrid ctx={ctx} anchor={anchor} onDayDetail={noop} />
        ) : layout === "transposed" ? (
          <TransposedView ctx={ctx} dates={eachDate(monthStart(anchor), monthEnd(anchor))} />
        ) : (
          <RowsTable ctx={ctx} dates={rowDates} />
        )}
        <p className="mt-2 text-xs">
          ※ この印刷物は画面のビュー定義からそのまま生成しています。版ラベルと発行履歴で、配布した版を追えます。
          学年別項目（下校時刻など）は、全学年で同じ値のとき「1～6年 14:30～14:40」のように範囲でまとめて表示しています。
        </p>
      </div>
    </div>
  );
}

// ---------------- main App ----------------
export function App() {
  const qc = useQueryClient();
  const bootstrapQ = useQuery({ queryKey: ["bootstrap"], queryFn: () => api.getBootstrap({}) });
  const bootstrap = bootstrapQ.data;

  const [screen, setScreen] = useState<"table" | "settings">("table");
  const [viewId, setViewId] = useState<number | null>(null);
  const [layout, setLayout] = useState<string>("month_rows");
  const [anchor, setAnchor] = useState<string>(todayStr());
  const [span, setSpan] = useState<7 | 14>(7);
  const [axis, setAxis] = useState<"time" | "period">("time");
  const [yearDelta, setYearDelta] = useState(0);
  const [editingEvent, setEditingEvent] = useState<EventItem | null>(null);
  const [quickSetup, setQuickSetup] = useState<{
    event: EventItem;
    anchor: { top: number; bottom: number; left: number } | null;
  } | null>(null);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [dutyOpen, setDutyOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [dayEditDate, setDayEditDate] = useState<string | null>(null);
  const [dayDetailDate, setDayDetailDate] = useState<string | null>(null);

  const view = useMemo(() => {
    if (!bootstrap) return null;
    return bootstrap.views.find((v) => v.id === viewId) ?? bootstrap.views[0] ?? null;
  }, [bootstrap, viewId]);

  const audienceRank = audienceRankOf(view?.audience ?? "staff");
  const columns = useMemo<ColumnDef[]>(() => {
    if (!bootstrap) return [];
    return audienceColumns(parseColumns(view), bootstrap.items, audienceRank);
  }, [bootstrap, view, audienceRank]);
  const viewItems = useMemo<ItemDef[]>(
    () => (bootstrap ? audienceItems(bootstrap.items, columns, audienceRank) : []),
    [bootstrap, columns, audienceRank],
  );

  const range = useMemo(() => {
    const schoolYear = (bootstrap?.settings.schoolYear ?? 2026) + yearDelta;
    switch (layout) {
      case "week_rows": {
        const s = mondayOf(anchor);
        return { from: s, to: addDays(s, span - 1) };
      }
      case "week_timeline": {
        const s = mondayOf(anchor);
        return { from: s, to: addDays(s, 6) };
      }
      case "year_columns":
        return { from: `${schoolYear}-04-01`, to: `${schoolYear + 1}-03-31` };
      case "calendar_grid": {
        const s = mondayOf(monthStart(anchor));
        const e = addDays(monthEnd(anchor), (7 - parseDate(monthEnd(anchor)).getDay()) % 7);
        return { from: s, to: e };
      }
      default:
        return { from: monthStart(anchor), to: monthEnd(anchor) };
    }
  }, [layout, anchor, span, bootstrap?.settings.schoolYear, yearDelta]);

  const rangeQ = useQuery({
    queryKey: ["range", range.from, range.to],
    queryFn: () => api.getRange({ from: range.from, to: range.to }),
    enabled: bootstrap != null,
  });
  const rangeData = rangeQ.data;

  // Audience filtering (DESIGN §9): a non-staff view only receives events
  // whose visibility reaches that audience, daily values of the items it
  // lists, and no duty data — every display path (table, calendar band,
  // day detail, print) renders from this, never from rangeData directly.
  // NOTE: this is display filtering only; the server still returns
  // everything to any caller (server-side authorization is pending).
  const displayRange = useMemo<RangeData | undefined>(() => {
    if (!rangeData) return undefined;
    return filterRangeForAudience(
      rangeData,
      new Set(viewItems.map((i) => i.id)),
      audienceRank,
    );
  }, [rangeData, viewItems, audienceRank]);

  // Column widths live on the view definition. During a drag only the
  // in-flight preview width is local state; on release the merged map is
  // saved through setViewColumnWidths. The commit is applied to the
  // bootstrap cache optimistically (onMutate) so the derived savedWidths
  // already hold the new width when the preview is dropped on settle —
  // otherwise the column snapped back to the old width until the
  // invalidated bootstrap refetch landed. On error the cache rolls back
  // and the preview drop restores the previous width.
  const savedWidths = useMemo(() => parseWidths(view), [view]);
  const [widthDrag, setWidthDrag] = useState<{
    viewId: number;
    key: string;
    width: number;
  } | null>(null);
  const colWidths = useMemo(() => {
    if (widthDrag && view && widthDrag.viewId === view.id) {
      return { ...savedWidths, [widthDrag.key]: widthDrag.width };
    }
    return savedWidths;
  }, [savedWidths, widthDrag, view]);
  const setWidthsMut = useMutation({
    mutationFn: (args: { viewId: number; widths: Record<string, number> }) =>
      api.setViewColumnWidths(args),
    onMutate: (args) => {
      const prev = qc.getQueryData<Bootstrap>(["bootstrap"]);
      if (prev) {
        qc.setQueryData<Bootstrap>(["bootstrap"], {
          ...prev,
          views: prev.views.map((v) =>
            v.id === args.viewId
              ? { ...v, widthsJson: JSON.stringify(args.widths) }
              : v,
          ),
        });
      }
      return { prev };
    },
    onError: (_err, _args, context) => {
      if (context?.prev) qc.setQueryData<Bootstrap>(["bootstrap"], context.prev);
    },
    onSettled: () => setWidthDrag(null),
  });
  const handleResizeColumn = (key: string, width: number | null, commit: boolean) => {
    if (!view) return;
    if (!commit) {
      if (width != null) setWidthDrag({ viewId: view.id, key, width });
      return;
    }
    const next = { ...savedWidths };
    if (width == null) delete next[key];
    else next[key] = width;
    setWidthsMut.mutate({ viewId: view.id, widths: next });
  };

  const summaryQ = useQuery({
    queryKey: ["summary", range.from, range.to],
    queryFn: () => api.getSummary({ from: range.from, to: range.to }),
    enabled: bootstrap != null,
  });

  const holidayMap = useMemo(
    () => new Map((bootstrap?.holidays ?? []).map((h) => [h.date, h.name])),
    [bootstrap],
  );
  const conflictByAssignment = useMemo(() => {
    const map = new Map<number, Conflict[]>();
    for (const c of rangeData?.conflicts ?? []) {
      if (c.assignmentId == null) continue;
      map.set(c.assignmentId, [...(map.get(c.assignmentId) ?? []), c]);
    }
    return map;
  }, [rangeData]);
  const alertCount = (rangeData?.conflicts ?? []).filter((c) => c.kind !== "unassigned").length;
  const unassignedCount = (rangeData?.conflicts ?? []).filter(
    (c) => c.kind === "unassigned",
  ).length;

  const invalidate = () => void qc.invalidateQueries();
  const setDailyMut = useMutation({
    mutationFn: (args: SetDailyArgs) => api.setDailyValue(args),
    onSuccess: invalidate,
  });
  const setDutyMut = useMutation({
    mutationFn: (args: { dutyDefinitionId: number; date: string; slot: string; personId: number | null; freeTextName: string | null }) =>
      api.setDutyAssignment(args),
    onSuccess: invalidate,
  });

  // ---- drag & drop: move entered content to another day ----
  // Two input paths share one move implementation: native HTML5 drag
  // (mouse) and a pointer-based drag (touch / pen / mouse) that follows
  // the finger with a ghost chip. A plain click keeps its old meaning
  // (open details / focus the cell); a drag only starts after the pointer
  // moves past a small threshold, and the click that follows a real drag
  // is suppressed once.
  type PointerDragState =
    | {
        kind: "event";
        eventId: number;
        sourceDate: string | null;
        label: string;
        x: number;
        y: number;
        startX: number;
        startY: number;
        active: boolean;
      }
    | {
        kind: "daily";
        itemId: number;
        fromDate: string;
        label: string;
        x: number;
        y: number;
        startX: number;
        startY: number;
        active: boolean;
      };
  const [dropKeyState, setDropKeyState] = useState<string | null>(null);
  const [draggingEventId, setDraggingEventId] = useState<number | null>(null);
  const [draggingDailyKey, setDraggingDailyKey] = useState<string | null>(null);
  const [pointerDrag, setPointerDrag] = useState<PointerDragState | null>(null);
  const [moveMsg, setMoveMsg] = useState("");
  const pointerDragRef = useRef<PointerDragState | null>(null);
  const pointerDropRef = useRef<{
    date: string;
    category: string | null;
    itemId: number | null;
  } | null>(null);
  const htmlPayloadRef = useRef<DragPayload | null>(null);
  const suppressUntilRef = useRef(0);
  const moveEventMut = useMutation({
    mutationFn: (args: {
      id: number;
      targetDate: string;
      sourceDate: string | null;
      targetCategory: string | null;
    }) => api.moveEvent(args),
    onSuccess: () => {
      setMoveMsg("予定を移動しました。");
      invalidate();
    },
    onError: (e) => setMoveMsg(`移動できませんでした：${String(e)}`),
  });
  const moveDailyMut = useMutation({
    mutationFn: (args: { itemDefinitionId: number; fromDate: string; toDate: string }) =>
      api.moveDailyValues(args),
    onSuccess: () => {
      setMoveMsg("日次項目を移動しました。");
      invalidate();
    },
    onError: (e) => setMoveMsg(`移動できませんでした：${String(e)}`),
  });
  const doMoveEvent = (
    eventId: number,
    sourceDate: string | null,
    targetDate: string,
    targetCategory?: string | null,
  ) => {
    if (sourceDate != null && sourceDate === targetDate && !targetCategory) return;
    moveEventMut.mutate({
      id: eventId,
      targetDate,
      sourceDate,
      targetCategory: targetCategory ?? null,
    });
  };
  const doMoveDaily = (itemId: number, fromDate: string, toDate: string) => {
    if (fromDate === toDate) return;
    moveDailyMut.mutate({ itemDefinitionId: itemId, fromDate, toDate });
  };
  const dragMoveRef = useRef({
    moveEvent: doMoveEvent,
    moveDaily: doMoveDaily,
  });
  useEffect(() => {
    dragMoveRef.current = { moveEvent: doMoveEvent, moveDaily: doMoveDaily };
  });
  // Pointer drag tracking: one set of window listeners for the app's life,
  // driven entirely through refs so pointermove never re-renders handlers.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const cur = pointerDragRef.current;
      if (!cur) return;
      const active =
        cur.active ||
        Math.hypot(e.clientX - cur.startX, e.clientY - cur.startY) > 8;
      const next = { ...cur, x: e.clientX, y: e.clientY, active };
      pointerDragRef.current = next;
      setPointerDrag(next);
      if (!active) return;
      if (cur.kind === "event") setDraggingEventId(cur.eventId);
      else setDraggingDailyKey(`${cur.itemId}:${cur.fromDate}`);
      const el = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest?.("[data-drop-date]") as HTMLElement | null;
      if (el?.dataset.dropDate) {
        pointerDropRef.current = {
          date: el.dataset.dropDate,
          category: el.dataset.dropCategory || null,
          itemId: el.dataset.dropItemId ? Number(el.dataset.dropItemId) : null,
        };
        setDropKeyState(el.dataset.dropKey ?? null);
      } else {
        pointerDropRef.current = null;
        setDropKeyState(null);
      }
    };
    const onUp = () => {
      const cur = pointerDragRef.current;
      if (!cur) return;
      const target = pointerDropRef.current;
      pointerDragRef.current = null;
      pointerDropRef.current = null;
      setPointerDrag(null);
      setDropKeyState(null);
      setDraggingEventId(null);
      setDraggingDailyKey(null);
      if (!cur.active) return;
      suppressUntilRef.current = Date.now() + 400;
      if (!target) return;
      if (cur.kind === "event") {
        dragMoveRef.current.moveEvent(
          cur.eventId,
          cur.sourceDate,
          target.date,
          target.category,
        );
      } else if (target.itemId === cur.itemId) {
        dragMoveRef.current.moveDaily(cur.itemId, cur.fromDate, target.date);
      }
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const shouldSuppressClick = () => Date.now() < suppressUntilRef.current;
  const onHtmlDragStart = (payload: DragPayload, e: ReactDragEvent) => {
    // The native drag takes over from here: cancel the pointer-drag
    // candidate recorded on pointerdown so the drop is applied only once.
    pointerDragRef.current = null;
    pointerDropRef.current = null;
    setPointerDrag(null);
    htmlPayloadRef.current = payload;
    try {
      e.dataTransfer.setData("text/plain", JSON.stringify(payload));
      e.dataTransfer.effectAllowed = "move";
    } catch {
      /* dataTransfer may be read-only in some test doubles */
    }
    if (payload.kind === "event") setDraggingEventId(payload.eventId);
    else setDraggingDailyKey(`${payload.itemId}:${payload.fromDate}`);
  };
  const onHtmlDragEnd = () => {
    htmlPayloadRef.current = null;
    pointerDragRef.current = null;
    pointerDropRef.current = null;
    setPointerDrag(null);
    setDraggingEventId(null);
    setDraggingDailyKey(null);
    setDropKeyState(null);
  };
  const onDragOverCell = (key: string, e: ReactDragEvent) => {
    e.preventDefault();
    try {
      e.dataTransfer.dropEffect = "move";
    } catch {
      /* ignore */
    }
    setDropKeyState((prev) => (prev === key ? prev : key));
  };
  const onDragLeaveCell = (key: string) => {
    setDropKeyState((prev) => (prev === key ? null : prev));
  };
  const onDropCell = (
    target: { date: string; category?: string | null; itemId?: number | null },
    e: ReactDragEvent,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    let payload: DragPayload | null = htmlPayloadRef.current;
    if (!payload) {
      try {
        const raw = e.dataTransfer.getData("text/plain");
        if (raw) payload = JSON.parse(raw) as DragPayload;
      } catch {
        payload = null;
      }
    }
    setDropKeyState(null);
    setDraggingEventId(null);
    setDraggingDailyKey(null);
    htmlPayloadRef.current = null;
    if (!payload) return;
    if (payload.kind === "event") {
      doMoveEvent(
        payload.eventId,
        payload.sourceDate,
        target.date,
        target.category ?? null,
      );
    } else if (target.itemId === payload.itemId) {
      doMoveDaily(payload.itemId, payload.fromDate, target.date);
    }
  };
  const onPointerStartEvent = (
    event: EventItem,
    sourceDate: string,
    e: ReactPointerEvent,
  ) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const state: PointerDragState = {
      kind: "event",
      eventId: event.id,
      sourceDate,
      label: bootstrap ? eventHeadline(event, bootstrap.people) : event.title,
      x: e.clientX,
      y: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
    };
    pointerDragRef.current = state;
    setPointerDrag(state);
  };
  const onPointerStartDaily = (
    itemId: number,
    fromDate: string,
    label: string,
    e: ReactPointerEvent,
  ) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const state: PointerDragState = {
      kind: "daily",
      itemId,
      fromDate,
      label,
      x: e.clientX,
      y: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
    };
    pointerDragRef.current = state;
    setPointerDrag(state);
  };
  type CreateArgs = ApiRequest<typeof api, "createEvent">;
  const createMut = useMutation({
    mutationFn: (args: CreateArgs & { anchor?: { top: number; bottom: number; left: number } | null }) => {
      const { anchor: _anchor, ...payload } = args;
      return api.createEvent(payload);
    },
    onSuccess: (res, args) => {
      invalidate();
      // After a title is committed from a cell, open the step-by-step quick
      // setup card next to the cell (assignees → place → time) instead of
      // jumping straight into the full detail modal.
      setQuickSetup({
        anchor: args.anchor ?? null,
        event: {
          id: res.id,
          title: args.title,
          category: args.category ?? "行事",
          datePrecision: args.datePrecision ?? "day",
          startsOn: args.startsOn ?? null,
          endsOn: args.endsOn ?? args.startsOn ?? null,
          startsAt: args.startsAt ?? null,
          endsAt: args.endsAt ?? null,
          isAllDay: args.isAllDay ?? 1,
          slot: args.slot ?? "all_day",
          periodFrom: args.periodFrom ?? null,
          periodTo: args.periodTo ?? null,
          locationId: null,
          locationText: null,
          leaveType: null,
          description: "",
          certainty: "confirmed",
          visibility: "staff_only",
          submitTo: null,
          assignees: [],
          targetIds: [],
        },
      });
    },
  });
  const quickAdd = (
    date: string,
    category: string,
    title: string,
    anchor: { top: number; bottom: number; left: number } | null,
  ) => {
    createMut.mutate({
      title,
      category,
      datePrecision: "day",
      startsOn: date,
      endsOn: date,
      startsAt: null,
      endsAt: null,
      isAllDay: 1,
      slot: "all_day",
      periodFrom: null,
      periodTo: null,
      locationId: null,
      locationText: null,
      leaveType: null,
      description: "",
      certainty: "confirmed",
      visibility: "staff_only",
      submitTo: null,
      assignees: [],
      targetIds: [],
      anchor,
    });
  };

  if (bootstrapQ.isPending || !bootstrap) {
    return (
      <div className="min-h-screen bg-[var(--bg)]">
        <SafeAreaTopScrim backgroundColor="var(--bg)" />
        <p className="px-4 py-10 text-center text-sm text-[var(--dim)]">読み込んでいます…</p>
      </div>
    );
  }
  if (bootstrapQ.error) {
    return (
      <div className="min-h-screen bg-[var(--bg)]">
        <SafeAreaTopScrim backgroundColor="var(--bg)" />
        <p className="px-4 py-10 text-center text-sm text-[#b91c1c]">
          読み込みに失敗しました：{String(bootstrapQ.error)}
        </p>
      </div>
    );
  }

  const emptyRange: RangeData = {
    events: [],
    dailyValues: [],
    dutyAssignments: [],
    dayRecords: [],
    conflicts: [],
    dutyChanges: [],
  };
  // Entitlement (Phase 3, §10.1): when this school's event_schedule
  // entitlement is recorded as suspended / not contracted, the schedule
  // becomes view-only. No recorded entitlement means usable.
  const scheduleEnt = governingEntitlement(bootstrap, "event_schedule");
  const scheduleRestricted = !entitlementUsable(scheduleEnt);
  const ctx: TableCtx = {
    bootstrap,
    range: displayRange ?? emptyRange,
    columns,
    items: viewItems,
    holidayMap,
    readOnly: scheduleRestricted,
    onOpenEvent: scheduleRestricted ? () => undefined : (e) => setEditingEvent(e),
    onQuickAdd: quickAdd,
    onSetDaily: (args) => setDailyMut.mutate(args),
    onSetDuty: (defId, date, slot, personId, freeText) =>
      setDutyMut.mutate({ dutyDefinitionId: defId, date, slot, personId, freeTextName: freeText }),
    onDayClick: (date) => setDayEditDate(date),
    onOpenDutyPanel: () => setDutyOpen(true),
    conflictByAssignment,
    dropKey: dropKeyState,
    draggingEventId,
    draggingDailyKey,
    onMoveEvent: doMoveEvent,
    onMoveDaily: doMoveDaily,
    onHtmlDragStart,
    onHtmlDragEnd,
    onDragOverCell,
    onDragLeaveCell,
    onDropCell,
    onPointerStartEvent,
    onPointerStartDaily,
    shouldSuppressClick,
    colWidths,
    onResizeColumn:
      scheduleRestricted || !view ? undefined : handleResizeColumn,
  };

  const periodLabel = (() => {
    if (layout === "month_rows" || layout === "calendar_grid" || layout === "transposed")
      return monthLabel(anchor);
    if (layout === "year_columns")
      return `${bootstrap.settings.schoolYear + yearDelta}年度（4月〜3月）`;
    const s = mondayOf(anchor);
    const e = addDays(s, layout === "week_rows" ? span - 1 : 6);
    return `${dayLabel(s)} 〜 ${dayLabel(e)}`;
  })();

  const goPrev = () => {
    if (layout === "month_rows" || layout === "calendar_grid" || layout === "transposed")
      setAnchor(addMonths(anchor, -1));
    else if (layout === "year_columns") setYearDelta(yearDelta - 1);
    else setAnchor(addDays(anchor, layout === "week_rows" ? -span : -7));
  };
  const goNext = () => {
    if (layout === "month_rows" || layout === "calendar_grid" || layout === "transposed")
      setAnchor(addMonths(anchor, 1));
    else if (layout === "year_columns") setYearDelta(yearDelta + 1);
    else setAnchor(addDays(anchor, layout === "week_rows" ? span : 7));
  };

  const undatedEvents = (displayRange?.events ?? []).filter(
    (e) =>
      e.datePrecision === "undecided" ||
      (e.datePrecision === "month" && e.startsOn != null && e.startsOn.slice(0, 7) === anchor.slice(0, 7)),
  );
  const summary = summaryQ.data;

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      {screen === "settings" ? (
        <SettingsPanel bootstrap={bootstrap} onClose={() => setScreen("table")} />
      ) : (
        <main className="w-full px-1 pb-10 sm:px-2">
          {/* controls */}
          <div className="flex flex-wrap items-center gap-2 py-3">
            <select
              aria-label="ビューを選ぶ"
              className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
              value={view?.id ?? ""}
              onChange={(e) => {
                const v = bootstrap.views.find((x) => x.id === Number(e.target.value));
                if (v) {
                  setViewId(v.id);
                  setLayout(v.layout);
                }
              }}
            >
              {bootstrap.views.length === 0 && <option value="">（ビュー未定義）</option>}
              {bootstrap.views.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
            <div className="flex flex-wrap gap-1" role="group" aria-label="表示スタイル">
              {LAYOUTS.map((l) => (
                <button
                  key={l.key}
                  type="button"
                  aria-pressed={layout === l.key}
                  className={`rounded px-2 py-1.5 text-xs sm:text-sm ${layout === l.key ? "bg-[var(--accent)] font-medium text-white" : "border border-[var(--border)] bg-[var(--surface)]"}`}
                  onClick={() => setLayout(l.key)}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 pb-2">
            <button type="button" aria-label="前の期間" className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1" onClick={goPrev}>
              ←
            </button>
            <button type="button" className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm" onClick={() => { setAnchor(todayStr()); setYearDelta(0); }}>
              今日
            </button>
            <button type="button" aria-label="次の期間" className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1" onClick={goNext}>
              →
            </button>
            <h1 className="font-serif text-lg font-bold">{periodLabel}</h1>
            {bootstrap.settings.schoolName && (
              <span className="text-sm text-[var(--dim)]">{bootstrap.settings.schoolName}</span>
            )}
            {bootstrap.settings.linkMode === "linked" && (
              <span className="rounded bg-[var(--bg)] px-2 py-0.5 text-xs text-[var(--dim)]" title="試作では実連携・SSOは行っていません">
                連携モード（試作）
              </span>
            )}
            {layout === "week_rows" && (
              <span className="flex gap-1" role="group" aria-label="週表示の日数">
                {([7, 14] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={span === s}
                    className={`rounded px-2 py-1 text-sm ${span === s ? "bg-[var(--accent)] text-white" : "border border-[var(--border)] bg-[var(--surface)]"}`}
                    onClick={() => setSpan(s)}
                  >
                    {s === 7 ? "1週間" : "2週間"}
                  </button>
                ))}
              </span>
            )}
            {layout === "week_timeline" && (
              <span className="flex gap-1" role="group" aria-label="タイムラインの軸">
                <button type="button" aria-pressed={axis === "time"} className={`rounded px-2 py-1 text-sm ${axis === "time" ? "bg-[var(--accent)] text-white" : "border border-[var(--border)] bg-[var(--surface)]"}`} onClick={() => setAxis("time")}>
                  時刻軸
                </button>
                <button type="button" aria-pressed={axis === "period"} className={`rounded px-2 py-1 text-sm ${axis === "period" ? "bg-[var(--accent)] text-white" : "border border-[var(--border)] bg-[var(--surface)]"}`} onClick={() => setAxis("period")}>
                  時限軸
                </button>
              </span>
            )}
            <span className="ml-auto flex gap-2">
              <button
                type="button"
                className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm"
                onClick={() => setDutyOpen(true)}
              >
                当番・競合
                {alertCount > 0 && (
                  <span
                    className="ml-1 rounded-full bg-[#b45309] px-1.5 text-xs font-bold text-white"
                    title="出張・休暇・研修との重なり／二重割当の件数"
                  >
                    重なり{alertCount}
                  </span>
                )}
                {unassignedCount > 0 && (
                  <span
                    className="ml-1 rounded-full bg-[var(--dim)] px-1.5 text-xs font-bold text-white"
                    title="担当者が未割当の当番の件数"
                  >
                    未割当{unassignedCount}
                  </span>
                )}
              </button>
              <button
                type="button"
                className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm disabled:opacity-40"
                disabled={layout === "week_timeline"}
                title={layout === "week_timeline" ? "タイムラインは画面表示専用です" : undefined}
                onClick={() => setPrintOpen(true)}
              >
                印刷・PDF
              </button>
              <button
                type="button"
                className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm"
                onClick={() => setScreen("settings")}
              >
                設定・マスタ
              </button>
            </span>
          </div>

          {scheduleRestricted && (
            <div className="mb-3 rounded-lg border border-[#b45309] bg-[var(--surface)] p-3" role="alert">
              <p className="text-sm font-medium">
                行事予定は現在「{scheduleEnt?.status === "none" ? "未契約" : "停止"}」のため、閲覧のみです（編集はできません）。
              </p>
              <p className="mt-0.5 text-xs text-[var(--dim)]">
                データはそのまま保持されています。編集を再開するには、「設定・マスタ」の一番下にある「利用権限（entitlement）」で、この学校の「行事予定」の状態を「有効」または「体験中」に変更してください。時間割側の状態には影響しません。
              </p>
            </div>
          )}

          {bootstrap.views.length === 0 && (
            <div className="mb-3 rounded-lg border border-[var(--accent)]/40 bg-[var(--surface)] p-3">
              <p className="font-serif text-base font-bold">はじめに：学校の形を選んでください</p>
              <p className="mt-1 text-sm text-[var(--dim)]">
                このアプリは学校ごとに表の形が違う前提で作られています。プリセットを選ぶと、項目（列）・対象・当番・ビューの初期値が入ります。あとから設定画面で自由に追加・削除・改名できます。プリセットを使わず、設定画面でゼロから定義することもできます。
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {(
                  [
                    ["elem_no_bus", "小学校（バスなし）"],
                    ["elem_bus", "小学校（バスあり）"],
                    ["junior_high", "中学校"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-white"
                    onClick={() => {
                      void api.applyPreset({ preset: key }).then(() => invalidate());
                    }}
                  >
                    {label}で始める
                  </button>
                ))}
                <button type="button" className="rounded border border-[var(--border)] px-3 py-1.5 text-sm" onClick={() => setScreen("settings")}>
                  設定画面で定義する
                </button>
              </div>
            </div>
          )}

          {rangeData && rangeData.events.length > 0 && !scheduleRestricted && (
            <p className="pb-1 text-xs text-[var(--dim)]">
              予定はドラッグ＆ドロップで別の日へ移動できます（期間の予定は丸ごとずれます）。下校時刻など日次項目はセルの「⠿」をドラッグしてください。
            </p>
          )}
          {pointerDrag?.active && (
            <p className="pb-1 text-xs font-medium text-[var(--accent)]" role="status">
              「{pointerDrag.label}」を移動中…
              {dropKeyState
                ? `${dayLabel(dropKeyState.split("|")[0] ?? "")} へ放すと移動します`
                : "移動先の日のセルへ重ねて放してください"}
            </p>
          )}
          {moveMsg && (
            <p className="pb-1 text-xs" role="status">{moveMsg}</p>
          )}

          {rangeQ.isPending && (
            <p className="py-6 text-center text-sm text-[var(--dim)]">予定を読み込んでいます…</p>
          )}
          {rangeQ.error && (
            <p className="py-6 text-center text-sm text-[#b91c1c]">
              読み込みに失敗しました：{String(rangeQ.error)}
            </p>
          )}

          {rangeData && layout === "month_rows" && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              <RowsTable ctx={ctx} dates={eachDate(range.from, range.to)} />
            </div>
          )}
          {rangeData && layout === "week_rows" && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              <RowsTable ctx={ctx} dates={eachDate(range.from, range.to)} />
            </div>
          )}
          {rangeData && layout === "year_columns" && (
            <YearView ctx={ctx} schoolYear={bootstrap.settings.schoolYear + yearDelta} />
          )}
          {rangeData && layout === "calendar_grid" && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              <CalendarGrid ctx={ctx} anchor={anchor} onDayDetail={(d) => setDayDetailDate(d)} />
            </div>
          )}
          {rangeData && layout === "week_timeline" && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              <TimelineView
                ctx={ctx}
                weekStart={mondayOf(anchor)}
                axis={axis}
                onSlotCreate={(date, d) => setDraft({ ...d, date })}
              />
            </div>
          )}
          {rangeData && layout === "transposed" && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              <TransposedView ctx={ctx} dates={eachDate(range.from, range.to)} />
            </div>
          )}

          {rangeData && summary && (
            <section
              aria-label="集計"
              className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3"
            >
              <h2 className="mb-1 font-serif text-base font-bold">
                集計（{periodLabel}）
              </h2>
              <div className="flex flex-wrap gap-2 text-sm">
                {summary.dayTypeCounts.map((d) => (
                  <span
                    key={d.dayType}
                    className="rounded bg-[var(--bg)] px-2 py-1"
                  >
                    {d.dayType}：{d.count}日
                  </span>
                ))}
              </div>
              {summary.items.length === 0 ? (
                <p className="mt-1 text-xs text-[var(--dim)]">
                  集計できる項目はまだありません。設定画面で項目に「集計する」を付けると、ここに日数が出ます。
                </p>
              ) : (
                <div className="mt-2 flex flex-col gap-1">
                  {summary.items.map((item) => (
                    <p key={item.itemId} className="text-sm">
                      {item.name}日数：{item.total}日
                      {item.byTarget.length > 1 && (
                        <span className="ml-2 text-xs text-[var(--dim)]">
                          （
                          {item.byTarget
                            .map((t) => `${t.targetName} ${t.count}日`)
                            .join("、")}
                          ）
                        </span>
                      )}
                    </p>
                  ))}
                </div>
              )}
              <p className="mt-1 text-xs text-[var(--dim)]">
                授業日数は日課の設定から数えています（設定のない日は、土日と登録済みの祝日・休業日を休業日として数えます）。項目の日数は、記号の凡例で「数える」とした選択肢の日を数えたものです。
              </p>
            </section>
          )}

          {rangeData && (layout === "month_rows" || layout === "week_rows" || layout === "calendar_grid" || layout === "transposed") && (
            <section className="mt-4" aria-label="未定の予定">
              <h2 className="mb-1 font-serif text-base font-bold">
                {anchor.slice(0, 7).replace("-", "年")}月の未定・月のみ確定の予定
              </h2>
              {undatedEvents.length === 0 ? (
                <p className="text-sm text-[var(--dim)]">
                  ありません。予定の詳細で「日付の確定度」を「月のみ確定」または「時期未定」にすると、ここに並びます。
                </p>
              ) : (
                <>
                <div className="flex flex-wrap gap-1">
                  {undatedEvents.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      draggable={!scheduleRestricted}
                      aria-label={`${eventHeadline(e, bootstrap.people)}（${e.datePrecision === "undecided" ? "時期未定" : "月のみ確定"}）${scheduleRestricted ? "" : "ドラッグで日を割り当て、クリックで詳細"}`}
                      title={scheduleRestricted ? undefined : "ドラッグで表の日に放すと、その日に割り当てられます"}
                      className={`rounded bg-[var(--surface)] px-2 py-1 text-sm ${
                        draggingEventId === e.id ? "opacity-40" : ""
                      } cursor-grab touch-none active:cursor-grabbing`}
                      onDragStart={(ev) =>
                        onHtmlDragStart(
                          { kind: "event", eventId: e.id, sourceDate: e.startsOn },
                          ev,
                        )
                      }
                      onDragEnd={() => onHtmlDragEnd()}
                      onPointerDown={(ev) =>
                        onPointerStartEvent(e, e.startsOn ?? "", ev)
                      }
                      onClick={() => {
                        if (scheduleRestricted) return;
                        if (shouldSuppressClick()) return;
                        setEditingEvent(e);
                      }}
                    >
                      <span aria-hidden="true" className="mr-0.5 text-[var(--dim)]">⠿</span>
                      <span className="mr-1 text-xs text-[var(--dim)]">
                        {e.datePrecision === "undecided" ? "時期未定" : "月のみ確定"}
                      </span>
                      {eventHeadline(e, bootstrap.people)}
                    </button>
                  ))}
                </div>
                {!scheduleRestricted && (
                  <p className="mt-1 text-xs text-[var(--dim)]">
                    未定の予定は、ドラッグして表の日のセルへ放すとその日に割り当てられます。
                  </p>
                )}
                </>
              )}
            </section>
          )}
        </main>
      )}

      {quickSetup && bootstrap && (
        <QuickSetup
          event={quickSetup.event}
          bootstrap={bootstrap}
          anchor={quickSetup.anchor}
          onClose={() => setQuickSetup(null)}
          onOpenDetails={(e) => {
            setQuickSetup(null);
            setEditingEvent(e);
          }}
        />
      )}
      {editingEvent && bootstrap && (
        <EventModal
          event={editingEvent}
          draft={null}
          bootstrap={bootstrap}
          onClose={() => setEditingEvent(null)}
        />
      )}
      {draft && bootstrap && (
        <EventModal
          event={null}
          draft={draft}
          bootstrap={bootstrap}
          onClose={() => setDraft(null)}
        />
      )}
      {dutyOpen && rangeData && (
        <DutyPanel
          bootstrap={bootstrap}
          range={rangeData}
          defaultFrom={monthStart(anchor)}
          defaultTo={monthEnd(anchor)}
          onClose={() => setDutyOpen(false)}
        />
      )}
      {dayEditDate && (
        <DayRecordModal
          bootstrap={bootstrap}
          date={dayEditDate}
          record={rangeData?.dayRecords.find((d) => d.date === dayEditDate)}
          onClose={() => setDayEditDate(null)}
        />
      )}
      {dayDetailDate && rangeData && (
        <DayDetailModal ctx={ctx} date={dayDetailDate} onClose={() => setDayDetailDate(null)} />
      )}
      {printOpen && rangeData && displayRange && (
        <PrintPreview
          bootstrap={bootstrap}
          view={
            view
              ? {
                  id: view.id,
                  name: view.name,
                  layout,
                  audience: view.audience,
                  printJson: view.printJson,
                  columnsJson: view.columnsJson,
                }
              : null
          }
          range={displayRange}
          rangeFrom={range.from}
          rangeTo={range.to}
          anchor={anchor}
          periodLabel={periodLabel}
          schoolYear={bootstrap.settings.schoolYear + yearDelta}
          onClose={() => setPrintOpen(false)}
        />
      )}
      {pointerDrag?.active && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-[80] max-w-56 truncate rounded bg-[var(--accent)] px-2 py-1 text-xs font-medium text-white shadow-xl"
          style={{
            left: pointerDrag.x + 10,
            top: pointerDrag.y + 10,
          }}
        >
          ⠿ {pointerDrag.label}
          {dropKeyState && (
            <span className="ml-1 opacity-80">
              → {dayLabel(dropKeyState.split("|")[0] ?? "")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
