import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { ClockPicker } from "./ClockPicker";
import {
CATEGORIES,
CERTAINTY_OPTIONS,
VISIBILITY_OPTIONS,
leaveTypesOf,
monthEnd,
type Bootstrap,
type EventItem,
} from "./lib";

export type EventDraft = {
  date: string;
  category?: string;
  startsAt?: string | null;
  endsAt?: string | null;
  periodFrom?: number | null;
};

type AssigneeSel = { personId: number | null; freeTextName: string | null; role: string };

// Detail editor opened after a title is committed from a cell (or by tapping
// an existing event object). Everything except the title is optional:
// closing the modal keeps the title-only event.
export function EventModal({
  event,
  draft,
  bootstrap,
  onClose,
}: {
  event: EventItem | null; // existing event to edit
  draft: EventDraft | null; // create-mode initial values (from L4/L5 selection)
  bootstrap: Bootstrap;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isNew = event == null;
  const [title, setTitle] = useState(event?.title ?? "");
  const [category, setCategory] = useState(event?.category ?? draft?.category ?? "行事");
  const [precision, setPrecision] = useState(event?.datePrecision ?? "day");
  const [startsOn, setStartsOn] = useState(
    event?.startsOn ?? draft?.date ?? "",
  );
  const [endsOn, setEndsOn] = useState(event?.endsOn ?? draft?.date ?? "");
  const [monthVal, setMonthVal] = useState(
    event?.startsOn ? event.startsOn.slice(0, 7) : (draft?.date ?? "").slice(0, 7),
  );
  const [allDay, setAllDay] = useState(
    event ? event.isAllDay === 1 && !event.startsAt : draft?.startsAt == null,
  );
  const [startsAt, setStartsAt] = useState(event?.startsAt ?? draft?.startsAt ?? "");
  const [endsAt, setEndsAt] = useState(event?.endsAt ?? draft?.endsAt ?? "");
  const [slot, setSlot] = useState(event?.slot ?? "all_day");
  const [periodFrom, setPeriodFrom] = useState<string>(
    event?.periodFrom != null ? String(event.periodFrom) : draft?.periodFrom != null ? String(draft.periodFrom) : "",
  );
  const [periodTo, setPeriodTo] = useState<string>(
    event?.periodTo != null ? String(event.periodTo) : "",
  );
  const initLoc =
    event?.locationId != null
      ? (bootstrap.locations.find((l) => l.id === event.locationId)?.name ?? "")
      : (event?.locationText ?? "");
  const [locationText, setLocationText] = useState(initLoc);
  const [leaveType, setLeaveType] = useState(event?.leaveType ?? "");
  const [assignees, setAssignees] = useState<AssigneeSel[]>(
    event?.assignees.map((a) => ({
      personId: a.personId,
      freeTextName: a.freeTextName,
      role: a.role,
    })) ?? [],
  );
  const [addPersonId, setAddPersonId] = useState("");
  const [addFreeName, setAddFreeName] = useState("");
  const [targetIds, setTargetIds] = useState<number[]>(event?.targetIds ?? []);
  const [certainty, setCertainty] = useState(event?.certainty ?? "confirmed");
  const [visibility, setVisibility] = useState(event?.visibility ?? "staff_only");
  const [submitTo, setSubmitTo] = useState(event?.submitTo ?? "");
  const [description, setDescription] = useState(event?.description ?? "");

  const pattern = bootstrap.periodPatterns[0] ?? null;
  const periodChoices = (pattern?.periods ?? []).filter(
    (p) => p.periodNo >= 1 && p.periodNo <= 90,
  );
  const leaveTypes = leaveTypesOf(bootstrap);
  // The form is purpose-specific: for 休暇 events the person is the
  // 休暇取得者 (who takes the leave), the 件名 field disappears (the stored
  // title follows the taker names), and the person/classification fields
  // move to the top. Other categories keep the common event form.
  const isLeave = category === "休暇";
  const personLabel = isLeave ? "休暇取得者" : "担当者";
  const defaultRole = isLeave ? "取得者" : "担当";
  const heading = isLeave
    ? isNew
      ? "休暇を追加"
      : "休暇の詳細"
    : isNew
      ? "予定を追加"
      : "予定の詳細";

  const buildPayload = () => {
    const locMatch = bootstrap.locations.find((l) => l.name === locationText.trim());
    let sOn: string | null = startsOn || null;
    let eOn: string | null = endsOn || startsOn || null;
    if (precision === "month") {
      sOn = monthVal ? `${monthVal}-01` : null;
      eOn = monthVal ? monthEnd(`${monthVal}-01`) : null;
    }
    if (precision === "undecided") {
      sOn = null;
      eOn = null;
    }
    if (precision === "day") eOn = sOn;
    const takerNames = assignees
      .map((a) =>
        a.personId != null
          ? (bootstrap.people.find((p) => p.id === a.personId)?.name ?? a.freeTextName ?? "")
          : (a.freeTextName ?? ""),
      )
      .filter(Boolean);
    return {
      // For leave, the title is derived from the taker name(s) — displays
      // show the taker, not a subject line. Falls back to the previously
      // typed title, then to a plain "休暇".
      title:
        category === "休暇"
          ? takerNames.join("、") || title.trim() || "休暇"
          : title.trim(),
      category,
      datePrecision: precision,
      startsOn: sOn,
      endsOn: eOn,
      startsAt: allDay ? null : startsAt || null,
      endsAt: allDay ? null : endsAt || null,
      isAllDay: allDay ? 1 : 0,
      slot,
      periodFrom: periodFrom === "" ? null : Number(periodFrom),
      periodTo: periodTo === "" ? null : Number(periodTo),
      locationId:
        category === "休暇" ? (event?.locationId ?? null) : locMatch ? locMatch.id : null,
      locationText:
        category === "休暇"
          ? (event?.locationText ?? null)
          : locMatch
            ? null
            : locationText.trim() || null,
      leaveType: category === "休暇" ? leaveType.trim() || null : (event?.leaveType ?? null),
      description,
      certainty,
      visibility,
      submitTo: submitTo.trim() || null,
      assignees: assignees.map((a) => ({
        personId: a.personId,
        freeTextName: a.freeTextName,
        role: a.role || defaultRole,
      })),
      targetIds,
    };
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = buildPayload();
      if (!payload.title) throw new Error("件名を入力してください");
      // Same checks the server enforces, surfaced before the round trip.
      if (payload.startsOn && payload.endsOn && payload.endsOn < payload.startsOn)
        throw new Error("終了日が開始日より前になっています");
      if (
        payload.isAllDay === 0 &&
        payload.startsAt &&
        payload.endsAt &&
        payload.endsAt < payload.startsAt &&
        payload.endsOn === payload.startsOn
      )
        throw new Error("終了時刻が開始時刻より前になっています");
      if (
        payload.periodFrom != null &&
        payload.periodTo != null &&
        payload.periodTo < payload.periodFrom
      )
        throw new Error("終了時限が開始時限より前になっています");
      if (event == null) {
        await api.createEvent(payload);
      } else {
        await api.updateEvent({ id: event.id, ...payload });
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries();
      onClose();
    },
  });
  const del = useMutation({
    mutationFn: async () => {
      if (event) await api.deleteEvent({ id: event.id });
    },
    onSuccess: () => {
      void qc.invalidateQueries();
      onClose();
    },
  });
  const [confirmDelete, setConfirmDelete] = useState(false);

  const inputCls =
    "w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";
  const labelCls = "text-xs text-[var(--dim)]";

  // Person picker block. The wording follows the purpose: 担当者 for
  // ordinary events, 休暇取得者 for leave.
  const personBlock = (
    <div>
      <span className={labelCls}>{personLabel}（複数選択可・直接入力可）</span>
      <div className="mt-1 flex flex-wrap gap-1">
        {assignees.map((a, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 rounded-full bg-[var(--bg)] px-2 py-0.5 text-sm"
          >
            {a.personId != null
              ? (bootstrap.people.find((p) => p.id === a.personId)?.name ?? a.freeTextName ?? "")
              : a.freeTextName}
            <button
              type="button"
              aria-label={`${personLabel}を外す`}
              className="text-[var(--dim)]"
              onClick={() => setAssignees(assignees.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </span>
        ))}
        {assignees.length === 0 && (
          <span className="text-xs text-[var(--dim)]">未設定</span>
        )}
      </div>
      <div className="mt-1 flex flex-wrap gap-2">
        <select
          aria-label={`登録済みの人から${personLabel}を選ぶ`}
          className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
          value={addPersonId}
          onChange={(e) => setAddPersonId(e.target.value)}
        >
          <option value="">登録済みの人から選ぶ</option>
          {bootstrap.people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.role ? `（${p.role}）` : ""}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="rounded border border-[var(--border)] px-2 py-1.5 text-sm"
          onClick={() => {
            if (addPersonId === "") return;
            const pid = Number(addPersonId);
            if (!assignees.some((a) => a.personId === pid)) {
              setAssignees([...assignees, { personId: pid, freeTextName: null, role: defaultRole }]);
            }
            setAddPersonId("");
          }}
        >
          追加
        </button>
        <input
          aria-label={`${personLabel}を直接入力`}
          className="w-40 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
          placeholder="直接入力（氏名）"
          value={addFreeName}
          onChange={(e) => setAddFreeName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (addFreeName.trim()) {
                setAssignees([
                  ...assignees,
                  { personId: null, freeTextName: addFreeName.trim(), role: defaultRole },
                ]);
                setAddFreeName("");
              }
            }
          }}
        />
      </div>
    </div>
  );

  // Place block: a location for ordinary events; for leave, which has no
  // place, the leave classification takes its place.
  const placeBlock = category === "休暇" ? (
    <div>
      <label className={labelCls} htmlFor="ev-leave-type">
        休暇分類（リストから選択、または直接入力）
      </label>
      <input
        id="ev-leave-type"
        className={inputCls}
        value={leaveType}
        onChange={(e) => setLeaveType(e.target.value)}
        list="leave-type-list"
        placeholder="例：年休"
      />
      <datalist id="leave-type-list">
        {leaveTypes.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
    </div>
  ) : (
    <div>
      <label className={labelCls} htmlFor="ev-location">
        場所（登録済みの場所から選択、または直接入力）
      </label>
      <input
        id="ev-location"
        className={inputCls}
        value={locationText}
        onChange={(e) => setLocationText(e.target.value)}
        list="location-list"
        placeholder="例：体育館"
      />
      <datalist id="location-list">
        {bootstrap.locations.map((l) => (
          <option key={l.id} value={l.name} />
        ))}
      </datalist>
      {locationText.trim() !== "" &&
        !bootstrap.locations.some((l) => l.name === locationText.trim()) && (
          <p className="mt-0.5 text-xs text-[var(--dim)]">
            未登録の場所です。テキストとして保存され、設定画面から場所マスタへ追加できます。
          </p>
        )}
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={heading}
      onClick={(e) => {
        // Clicking the dimmed backdrop closes the modal, exactly like the
        // 閉じる button (unsaved edits are discarded the same way). Clicks
        // inside the panel — including the clock dial — never close it.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-[var(--surface)] p-4 shadow-xl sm:rounded-2xl">
        <div className="mb-3 flex items-start justify-between gap-2">
          <h2 className="font-serif text-lg font-bold">
            {heading}
          </h2>
          <button
            type="button"
            aria-label="閉じる"
            className="rounded border border-[var(--border)] px-2 py-1 text-sm"
            onClick={onClose}
          >
            閉じる
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {!isLeave && (
            <div>
              <label className={labelCls} htmlFor="ev-title">件名</label>
              <input
                id="ev-title"
                className={inputCls}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例：体育祭、職員会議、出張（県教研）"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelCls} htmlFor="ev-category">種別</label>
              <select
                id="ev-category"
                className={inputCls}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="ev-precision">日付の確定度</label>
              <select
                id="ev-precision"
                className={inputCls}
                value={precision}
                onChange={(e) => setPrecision(e.target.value)}
              >
                <option value="day">日が確定</option>
                <option value="range">期間</option>
                <option value="month">月のみ確定</option>
                <option value="undecided">時期未定</option>
              </select>
            </div>
          </div>

          {isLeave && (
            <>
              {personBlock}
              {placeBlock}
            </>
          )}

          {precision === "day" && (
            <div>
              <label className={labelCls} htmlFor="ev-date">日付</label>
              <input
                id="ev-date"
                type="date"
                className={inputCls}
                value={startsOn}
                onChange={(e) => {
                  setStartsOn(e.target.value);
                  setEndsOn(e.target.value);
                }}
              />
            </div>
          )}
          {precision === "range" && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls} htmlFor="ev-from">開始日</label>
                <input
                  id="ev-from"
                  type="date"
                  className={inputCls}
                  value={startsOn}
                  onChange={(e) => setStartsOn(e.target.value)}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="ev-to">終了日</label>
                <input
                  id="ev-to"
                  type="date"
                  className={inputCls}
                  value={endsOn}
                  onChange={(e) => setEndsOn(e.target.value)}
                />
              </div>
            </div>
          )}
          {precision === "month" && (
            <div>
              <label className={labelCls} htmlFor="ev-month">対象月</label>
              <input
                id="ev-month"
                type="month"
                className={inputCls}
                value={monthVal}
                onChange={(e) => setMonthVal(e.target.value)}
              />
            </div>
          )}
          {precision === "undecided" && (
            <p className="text-xs text-[var(--dim)]">
              日付未定の予定として登録します（月表の末尾「未定の予定」に表示されます）。
            </p>
          )}

          {precision !== "month" && precision !== "undecided" && (
            <>
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
                  <label className={labelCls} htmlFor="ev-slot">時間帯</label>
                  <select
                    id="ev-slot"
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
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <ClockPicker label="開始時刻" value={startsAt} onChange={setStartsAt} />
                  <ClockPicker label="終了時刻" value={endsAt} onChange={setEndsAt} />
                </div>
              )}
              {periodChoices.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls} htmlFor="ev-pfrom">時限で指定（開始）</label>
                    <select
                      id="ev-pfrom"
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
                    <label className={labelCls} htmlFor="ev-pto">時限で指定（終了）</label>
                    <select
                      id="ev-pto"
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
            </>
          )}

          {!isLeave && placeBlock}

          {!isLeave && personBlock}

          {!isLeave && bootstrap.targetGroups.some((g) => g.targets.length > 0) && (
            <div>
              <span className={labelCls}>対象</span>
              {bootstrap.targetGroups
                .filter((g) => g.targets.length > 0)
                .map((g) => (
                  <div key={g.id} className="mt-1">
                    <span className="text-xs font-medium">{g.name}</span>
                    <div className="mt-0.5 flex flex-wrap gap-2">
                      {g.targets.map((t) => (
                        <label key={t.id} className="flex items-center gap-1 text-sm">
                          <input
                            type="checkbox"
                            checked={targetIds.includes(t.id)}
                            onChange={(e) =>
                              setTargetIds(
                                e.target.checked
                                  ? [...targetIds, t.id]
                                  : targetIds.filter((x) => x !== t.id),
                              )
                            }
                          />
                          {t.name}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelCls} htmlFor="ev-certainty">確定度</label>
              <select
                id="ev-certainty"
                className={inputCls}
                value={certainty}
                onChange={(e) => setCertainty(e.target.value)}
              >
                {CERTAINTY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="ev-visibility">公開範囲</label>
              <select
                id="ev-visibility"
                className={inputCls}
                value={visibility}
                onChange={(e) => setVisibility(e.target.value)}
              >
                {VISIBILITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          {category === "〆切" && (
            <div>
              <label className={labelCls} htmlFor="ev-submit">提出先</label>
              <input
                id="ev-submit"
                className={inputCls}
                value={submitTo}
                onChange={(e) => setSubmitTo(e.target.value)}
              />
            </div>
          )}

          <div>
            <label className={labelCls} htmlFor="ev-desc">メモ・説明</label>
            <textarea
              id="ev-desc"
              className={inputCls}
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {save.error && (
            <p className="text-sm text-[#b91c1c]">{String(save.error)}</p>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              disabled={save.isPending || (!isLeave && title.trim() === "")}
              onClick={() => save.mutate()}
            >
              保存する
            </button>
            <button
              type="button"
              className="rounded border border-[var(--border)] px-3 py-2 text-sm"
              onClick={onClose}
            >
              {isNew ? "キャンセル" : "閉じる（詳細は任意）"}
            </button>
            {!isNew &&
              (confirmDelete ? (
                <span className="flex items-center gap-2 text-sm">
                  本当に削除しますか？
                  <button
                    type="button"
                    className="rounded bg-[#b91c1c] px-3 py-1.5 text-white"
                    onClick={() => del.mutate()}
                  >
                    削除する
                  </button>
                  <button
                    type="button"
                    className="underline"
                    onClick={() => setConfirmDelete(false)}
                  >
                    やめる
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="ml-auto text-sm text-[#b91c1c] underline"
                  onClick={() => setConfirmDelete(true)}
                >
                  この予定を削除
                </button>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
