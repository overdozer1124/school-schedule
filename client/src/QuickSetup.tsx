import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { ClockPicker } from "./ClockPicker";
import { dayLabel, leaveTypesOf, personNameOf, type Bootstrap, type EventItem } from "./lib";

type AssigneeSel = { personId: number | null; freeTextName: string | null; role: string };

/**
 * Step-by-step quick setup shown right next to a cell right after a title is
 * committed (instead of jumping straight into the full detail modal).
 * Step 1 picks assignees from the registered people list, step 2 picks a
 * place from the registered locations — or, for 休暇 events, the leave
 * classification (年休・特休…) since leave has no place — step 3 picks the
 * time. Every step can
 * be skipped; each confirmed step is saved immediately via updateEvent.
 * The full detail modal stays available via "詳細編集を開く".
 */
export function QuickSetup({
  event,
  bootstrap,
  anchor,
  onClose,
  onOpenDetails,
}: {
  event: EventItem;
  bootstrap: Bootstrap;
  // Viewport rect of the input the title was typed into; the card is placed
  // next to it (below when there is room, above otherwise).
  anchor: { top: number; bottom: number; left: number } | null;
  onClose: () => void;
  onOpenDetails: (e: EventItem) => void;
}) {
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [assignees, setAssignees] = useState<AssigneeSel[]>(
    event.assignees.map((a) => ({
      personId: a.personId,
      freeTextName: a.freeTextName,
      role: a.role,
    })),
  );
  const [freeName, setFreeName] = useState("");
  const initLoc =
    event.locationId != null
      ? (bootstrap.locations.find((l) => l.id === event.locationId)?.name ?? "")
      : (event.locationText ?? "");
  const [locationText, setLocationText] = useState(initLoc);
  // Leave events have no place: step 2 asks for the leave classification
  // (年休・特休…) instead of a location. The person step is also worded for
  // the purpose: for leave the person is the 休暇取得者 (who takes the
  // leave), not a 担当者.
  const isLeave = event.category === "休暇";
  const personLabel = isLeave ? "休暇取得者" : "担当者";
  const defaultRole = isLeave ? "取得者" : "担当";
  const leaveTypes = leaveTypesOf(bootstrap);
  const steps = [personLabel, isLeave ? "休暇分類" : "場所", "時間"] as const;
  const [leaveType, setLeaveType] = useState(event.leaveType ?? "");
  const [allDay, setAllDay] = useState(event.isAllDay === 1 && !event.startsAt);
  const [startsAt, setStartsAt] = useState(event.startsAt ?? "");
  const [endsAt, setEndsAt] = useState(event.endsAt ?? "");
  const [slot, setSlot] = useState(event.slot ?? "all_day");
  const [periodFrom, setPeriodFrom] = useState<string>(
    event.periodFrom != null ? String(event.periodFrom) : "",
  );
  const [periodTo, setPeriodTo] = useState<string>(
    event.periodTo != null ? String(event.periodTo) : "",
  );
  const cardRef = useRef<HTMLDivElement>(null);
  const freeNameRef = useRef<HTMLInputElement>(null);
  const locationRef = useRef<HTMLInputElement>(null);
  const leaveRef = useRef<HTMLInputElement>(null);
  const timeWrapRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null);

  const pattern = bootstrap.periodPatterns[0] ?? null;
  const periodChoices = (pattern?.periods ?? []).filter(
    (p) => p.periodNo >= 1 && p.periodNo <= 90,
  );

  // Place the card next to the anchor input once it has been measured.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (!anchor) {
      setPos({ top: Math.max(8, vh / 2 - h / 2), left: Math.max(8, vw / 2 - w / 2) });
      return;
    }
    const left = Math.min(Math.max(8, anchor.left), Math.max(8, vw - w - 8));
    if (anchor.bottom + 6 + h <= vh - 8) {
      setPos({ top: anchor.bottom + 6, left });
    } else if (anchor.top - 6 - h >= 8) {
      setPos({ bottom: vh - anchor.top + 6, left });
    } else {
      setPos({ top: Math.max(8, vh - h - 8), left });
    }
  }, [anchor, step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Move keyboard focus straight into the current step's input field, so
  // typing can start (or continue, after jumping between steps) without a
  // click. Runs once the card has been positioned and on every step change.
  useEffect(() => {
    if (!pos) return;
    const t = window.setTimeout(() => {
      if (step === 0) {
        freeNameRef.current?.focus();
      } else if (step === 1) {
        if (isLeave) leaveRef.current?.focus();
        else locationRef.current?.focus();
      } else {
        const wrap = timeWrapRef.current;
        if (!wrap) return;
        if (!allDay) {
          wrap
            .querySelector<HTMLElement>('input[aria-label="開始時刻（直接入力）"]')
            ?.focus();
        } else {
          wrap.querySelector<HTMLElement>("select")?.focus();
        }
      }
    }, 60);
    return () => window.clearTimeout(t);
    // allDay is read for the step-2 target only at step entry, not on toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, pos]);

  const buildPayload = (assigneesArg: AssigneeSel[] = assignees) => {
    const locMatch = bootstrap.locations.find((l) => l.name === locationText.trim());
    // For leave, the stored title follows the taker name(s): the taker is
    // what every display shows, so derived labels (e.g. conflict notices)
    // stay consistent. Without a taker, the typed title is kept as-is.
    const takerNames = assigneesArg
      .map((a) => personNameOf(bootstrap.people, a.personId, a.freeTextName))
      .filter(Boolean);
    return {
      id: event.id,
      title: isLeave && takerNames.length > 0 ? takerNames.join("、") : event.title,
      category: event.category,
      datePrecision: event.datePrecision,
      startsOn: event.startsOn,
      endsOn: event.endsOn,
      startsAt: allDay ? null : startsAt || null,
      endsAt: allDay ? null : endsAt || null,
      isAllDay: allDay ? 1 : 0,
      slot,
      periodFrom: periodFrom === "" ? null : Number(periodFrom),
      periodTo: periodTo === "" ? null : Number(periodTo),
      locationId: isLeave ? event.locationId : locMatch ? locMatch.id : null,
      locationText: isLeave
        ? event.locationText
        : locMatch
          ? null
          : locationText.trim() || null,
      leaveType: isLeave ? leaveType.trim() || null : event.leaveType,
      description: event.description,
      certainty: event.certainty,
      visibility: event.visibility,
      submitTo: event.submitTo,
      assignees: assigneesArg.map((a) => ({
        personId: a.personId,
        freeTextName: a.freeTextName,
        role: a.role || defaultRole,
      })),
      targetIds: event.targetIds,
    };
  };

  // The event as it looks with the wizard's current (possibly unsaved) input,
  // handed to the detail modal so nothing typed here is lost.
  const currentEvent = (): EventItem => {
    const p = buildPayload();
    return {
      ...event,
      startsAt: p.startsAt,
      endsAt: p.endsAt,
      isAllDay: p.isAllDay,
      slot: p.slot,
      periodFrom: p.periodFrom,
      periodTo: p.periodTo,
      locationId: p.locationId,
      locationText: p.locationText,
      leaveType: p.leaveType,
      assignees: p.assignees.map((a, i) => ({
        id: event.assignees[i]?.id ?? -(i + 1),
        personId: a.personId,
        freeTextName: a.freeTextName,
        role: a.role,
      })),
    };
  };

  const save = useMutation({
    mutationFn: async (payload: ReturnType<typeof buildPayload>) => {
      await api.updateEvent(payload);
    },
    onSuccess: () => {
      void qc.invalidateQueries();
    },
  });

  // Confirm the current step: save immediately, then advance (or close on
  // the last step). An explicit assignee list can be passed when the caller
  // has just extended it in the same keystroke (state has not flushed yet).
  const next = (assigneesArg?: AssigneeSel[]) => {
    if (save.isPending) return;
    save.mutate(buildPayload(assigneesArg), {
      onSuccess: () => {
        if (step >= steps.length - 1) onClose();
        else setStep(step + 1);
      },
    });
  };
  // Latest-render copy of `next`, for the time step's deferred Enter handling
  // (the clock text fields commit their value in their own key handler first,
  // so the payload must be built after that state has landed).
  const nextRef = useRef<() => void>(() => {});
  useEffect(() => {
    nextRef.current = () => next();
  });

  const skip = () => {
    if (step >= steps.length - 1) onClose();
    else setStep(step + 1);
  };

  // Jump straight to a step from the step header. Input typed so far lives
  // in state and is kept; a pending free-text assignee name is added first
  // so leaving step 1 via a jump never drops it.
  const goToStep = (i: number) => {
    if (i === step) return;
    if (step === 0 && freeName.trim()) {
      setAssignees([
        ...assignees,
        { personId: null, freeTextName: freeName.trim(), role: defaultRole },
      ]);
      setFreeName("");
    }
    setStep(i);
  };

  // Add the pending free-text name as another person (Ctrl+Enter / 追加).
  const addFreeName = () => {
    if (!freeName.trim()) return;
    setAssignees([
      ...assignees,
      { personId: null, freeTextName: freeName.trim(), role: defaultRole },
    ]);
    setFreeName("");
    freeNameRef.current?.focus();
  };

  const inputCls =
    "w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";
  const labelCls = "text-xs text-[var(--dim)]";

  return (
    <>
      <div
        className="fixed inset-0 z-[55]"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        ref={cardRef}
        role="dialog"
        aria-label="予定のクイック入力"
        className="fixed z-[60] max-h-[80vh] w-[21rem] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-2xl"
        style={{
          top: pos?.top,
          bottom: pos?.bottom,
          left: pos?.left ?? 8,
          visibility: pos ? "visible" : "hidden",
        }}
      >
        <div className="mb-1 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">
              {isLeave
                ? assignees
                    .map((a) => personNameOf(bootstrap.people, a.personId, a.freeTextName))
                    .filter(Boolean)
                    .join("、") || event.title
                : event.title}
            </p>
            <p className="text-xs text-[var(--dim)]">
              {event.startsOn ? dayLabel(event.startsOn) : ""}
              {event.category ? ` ・ ${event.category}` : ""}
              {isLeave && leaveType ? `（${leaveType}）` : ""}
            </p>
          </div>
          <button
            type="button"
            aria-label="クイック入力を閉じる"
            className="shrink-0 rounded border border-[var(--border)] px-2 py-0.5 text-sm"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <ol className="mb-2 flex items-center gap-1" aria-label="入力ステップ">
          {steps.map((s, i) => (
            <li key={s} className="flex items-center gap-1">
              <button
                type="button"
                aria-label={`${i + 1}. ${s}の入力へ移動`}
                aria-current={i === step ? "step" : undefined}
                className={`rounded-full px-2 py-0.5 text-xs ${
                  i === step
                    ? "bg-[var(--accent)] font-medium text-white"
                    : i < step
                      ? "bg-[var(--accent)]/15 hover:bg-[var(--accent)]/25"
                      : "bg-[var(--bg)] text-[var(--dim)] hover:bg-[var(--border)]"
                }`}
                onClick={() => goToStep(i)}
              >
                {i + 1}. {s}
              </button>
              {i < steps.length - 1 && <span className="text-xs text-[var(--dim)]">›</span>}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <div>
            <span className={labelCls}>{personLabel}を選んでください（複数選択可）</span>
            {bootstrap.people.length === 0 ? (
              <p className="mt-1 text-xs text-[var(--dim)]">
                登録済みの人はいません。下の欄から直接入力できます。
              </p>
            ) : (
              <div className="mt-1 flex max-h-44 flex-col gap-0.5 overflow-y-auto">
                {bootstrap.people.map((p) => {
                  const selected = assignees.some((a) => a.personId === p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      aria-label={`${personLabel}：${p.name}`}
                      aria-pressed={selected}
                      className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
                        selected ? "bg-[var(--accent)]/15 font-medium" : "hover:bg-[var(--bg)]"
                      }`}
                      onClick={() =>
                        setAssignees(
                          selected
                            ? assignees.filter((a) => a.personId !== p.id)
                            : [...assignees, { personId: p.id, freeTextName: null, role: defaultRole }],
                        )
                      }
                    >
                      <span aria-hidden="true">{selected ? "☑" : "☐"}</span>
                      {p.name}
                      {p.role && <span className="text-xs text-[var(--dim)]">{p.role}</span>}
                    </button>
                  );
                })}
              </div>
            )}
            {assignees.filter((a) => a.personId == null && a.freeTextName).length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {assignees.map((a, i) =>
                  a.personId == null && a.freeTextName ? (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 rounded-full bg-[var(--bg)] px-2 py-0.5 text-sm"
                    >
                      {a.freeTextName}
                      <button
                        type="button"
                        aria-label={`${personLabel}を外す`}
                        className="text-[var(--dim)]"
                        onClick={() => setAssignees(assignees.filter((_, j) => j !== i))}
                      >
                        ×
                      </button>
                    </span>
                  ) : null,
                )}
              </div>
            )}
            <div className="mt-2 flex gap-2">
              <input
                ref={freeNameRef}
                aria-label={`${personLabel}を直接入力`}
                className={inputCls}
                placeholder="直接入力（氏名）"
                value={freeName}
                onChange={(e) => setFreeName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  if (e.ctrlKey || e.metaKey) {
                    // Ctrl+Enter: add this name and stay here for the next one.
                    addFreeName();
                  } else {
                    // Enter: confirm (a pending typed name counts as a
                    // person) and move on to the next step.
                    const list = freeName.trim()
                      ? [
                          ...assignees,
                          { personId: null, freeTextName: freeName.trim(), role: defaultRole },
                        ]
                      : assignees;
                    if (freeName.trim()) {
                      setAssignees(list);
                      setFreeName("");
                    }
                    next(list);
                  }
                }}
              />
              <button
                type="button"
                className="shrink-0 rounded border border-[var(--border)] px-2 py-1.5 text-sm"
                onClick={addFreeName}
              >
                追加
              </button>
            </div>
            <p className="mt-1 text-xs text-[var(--dim)]">
              Enter：確定して次へ ／ Ctrl+Enter：{personLabel}を追加
            </p>
          </div>
        )}

        {step === 1 && !isLeave && (
          <div>
            <span className={labelCls}>場所を選んでください</span>
            {bootstrap.locations.length === 0 ? (
              <p className="mt-1 text-xs text-[var(--dim)]">
                登録済みの場所はありません。下の欄から直接入力できます。
              </p>
            ) : (
              <div className="mt-1 flex max-h-44 flex-col gap-0.5 overflow-y-auto">
                <button
                  type="button"
                  aria-pressed={locationText === ""}
                  className={`rounded px-2 py-1.5 text-left text-sm ${
                    locationText === "" ? "bg-[var(--accent)]/15 font-medium" : "hover:bg-[var(--bg)]"
                  }`}
                  onClick={() => setLocationText("")}
                >
                  指定なし
                </button>
                {bootstrap.locations.map((l) => {
                  const selected = locationText === l.name;
                  return (
                    <button
                      key={l.id}
                      type="button"
                      aria-label={`場所：${l.name}`}
                      aria-pressed={selected}
                      className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
                        selected ? "bg-[var(--accent)]/15 font-medium" : "hover:bg-[var(--bg)]"
                      }`}
                      onClick={() => setLocationText(l.name)}
                    >
                      <span aria-hidden="true">{selected ? "●" : "○"}</span>
                      {l.name}
                      {l.kind && <span className="text-xs text-[var(--dim)]">{l.kind}</span>}
                    </button>
                  );
                })}
              </div>
            )}
            <input
              ref={locationRef}
              aria-label="場所を直接入力"
              className={`${inputCls} mt-2`}
              placeholder="直接入力（例：体育館）"
              value={locationText}
              onChange={(e) => setLocationText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                e.preventDefault();
                next();
              }}
            />
            <p className="mt-1 text-xs text-[var(--dim)]">Enter：確定して次へ</p>
            {locationText.trim() !== "" &&
              !bootstrap.locations.some((l) => l.name === locationText.trim()) && (
                <p className="mt-0.5 text-xs text-[var(--dim)]">
                  未登録の場所です。テキストとして保存されます。
                </p>
              )}
          </div>
        )}

        {step === 1 && isLeave && (
          <div>
            <span className={labelCls}>休暇の分類を選んでください</span>
            <div className="mt-1 flex max-h-44 flex-col gap-0.5 overflow-y-auto">
              <button
                type="button"
                aria-pressed={leaveType === ""}
                className={`rounded px-2 py-1.5 text-left text-sm ${
                  leaveType === "" ? "bg-[var(--accent)]/15 font-medium" : "hover:bg-[var(--bg)]"
                }`}
                onClick={() => setLeaveType("")}
              >
                指定なし
              </button>
              {leaveTypes.map((t) => {
                const selected = leaveType === t;
                return (
                  <button
                    key={t}
                    type="button"
                    aria-label={`休暇分類：${t}`}
                    aria-pressed={selected}
                    className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
                      selected ? "bg-[var(--accent)]/15 font-medium" : "hover:bg-[var(--bg)]"
                    }`}
                    onClick={() => setLeaveType(t)}
                  >
                    <span aria-hidden="true">{selected ? "●" : "○"}</span>
                    {t}
                  </button>
                );
              })}
            </div>
            <input
              ref={leaveRef}
              aria-label="休暇分類を直接入力"
              className={`${inputCls} mt-2`}
              placeholder="直接入力（例：夏季休暇）"
              value={leaveType}
              onChange={(e) => setLeaveType(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                e.preventDefault();
                next();
              }}
            />
            <p className="mt-1 text-xs text-[var(--dim)]">Enter：確定して次へ</p>
          </div>
        )}

        {step === 2 && (
          <div
            ref={timeWrapRef}
            className="flex flex-col gap-2"
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
              const t = e.target as HTMLElement;
              // Buttons (時計盤など) keep their native Enter behaviour.
              if (t.tagName === "BUTTON") return;
              e.preventDefault();
              // The clock text fields commit their typed value in their own
              // Enter handler first; blur and defer so the payload is built
              // from the committed state.
              (document.activeElement as HTMLElement | null)?.blur?.();
              window.setTimeout(() => nextRef.current(), 50);
            }}
          >
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={allDay}
                  onChange={(e) => setAllDay(e.target.checked)}
                />
                終日
              </label>
              <div>
                <label className={labelCls} htmlFor="qs-slot">時間帯</label>
                <select
                  id="qs-slot"
                  className="ml-1 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
                  value={slot}
                  onChange={(e) => setSlot(e.target.value)}
                >
                  <option value="all_day">終日</option>
                  <option value="am">午前のみ</option>
                  <option value="pm">午後のみ</option>
                </select>
              </div>
            </div>
            {!allDay && (
              <div className="grid grid-cols-1 gap-2">
                <ClockPicker label="開始時刻" value={startsAt} onChange={setStartsAt} />
                <ClockPicker label="終了時刻" value={endsAt} onChange={setEndsAt} />
              </div>
            )}
            {periodChoices.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls} htmlFor="qs-pfrom">時限（開始）</label>
                  <select
                    id="qs-pfrom"
                    className={inputCls}
                    value={periodFrom}
                    onChange={(e) => setPeriodFrom(e.target.value)}
                  >
                    <option value="">指定なし</option>
                    {periodChoices.map((p) => (
                      <option key={p.id} value={p.periodNo}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls} htmlFor="qs-pto">時限（終了）</label>
                  <select
                    id="qs-pto"
                    className={inputCls}
                    value={periodTo}
                    onChange={(e) => setPeriodTo(e.target.value)}
                  >
                    <option value="">指定なし</option>
                    {periodChoices.map((p) => (
                      <option key={p.id} value={p.periodNo}>{p.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
            <p className="text-xs text-[var(--dim)]">Enter：確定して完了</p>
          </div>
        )}

        {save.error && (
          <p className="mt-2 text-sm text-[#b91c1c]">{String(save.error)}</p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {step > 0 && (
            <button
              type="button"
              className="whitespace-nowrap rounded border border-[var(--border)] px-3 py-1.5 text-sm"
              onClick={() => setStep(step - 1)}
            >
              戻る
            </button>
          )}
          <button
            type="button"
            className="whitespace-nowrap rounded border border-[var(--border)] px-3 py-1.5 text-sm"
            onClick={skip}
          >
            スキップ
          </button>
          <button
            type="button"
            className="whitespace-nowrap rounded bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            disabled={save.isPending}
            onClick={() => next()}
          >
            {step >= steps.length - 1 ? "完了" : "確定して次へ"}
          </button>
          <button
            type="button"
            className="ml-auto whitespace-nowrap text-sm text-[var(--dim)] underline"
            onClick={() => onOpenDetails(currentEvent())}
          >
            詳細編集を開く
          </button>
        </div>
      </div>
    </>
  );
}
