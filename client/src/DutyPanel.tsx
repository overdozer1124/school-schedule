import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import {
ABSENCE_CATEGORIES,
dayLabel,
slotLabel,
type Bootstrap,
type Conflict,
type RangeData,
} from "./lib";

// Duty operations panel: conflict detection results with swap arrangement,
// rotation auto-generation with preview, and duty change history.
export function DutyPanel({
  bootstrap,
  range,
  defaultFrom,
  defaultTo,
  onClose,
}: {
  bootstrap: Bootstrap;
  range: RangeData;
  defaultFrom: string;
  defaultTo: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const people = bootstrap.people;
  const alerts = range.conflicts.filter((c) => c.kind !== "unassigned");
  const unassigned = range.conflicts.filter((c) => c.kind === "unassigned");
  const unassignedByDuty = useMemo(() => {
    const map = new Map<string, Conflict[]>();
    for (const c of unassigned) {
      const key = c.dutyName;
      map.set(key, [...(map.get(key) ?? []), c]);
    }
    return [...map.entries()];
  }, [unassigned]);

  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [waiveReason, setWaiveReason] = useState("");
  const [changeReason, setChangeReason] = useState("");

  const change = useMutation({
    mutationFn: async (args: {
      kind: "swap" | "substitute";
      assignmentAId: number;
      assignmentBId?: number | null;
      toPersonId?: number | null;
    }) => {
      await api.applyDutyChange({
        kind: args.kind,
        assignmentAId: args.assignmentAId,
        assignmentBId: args.assignmentBId ?? null,
        toPersonId: args.toPersonId ?? null,
        toFreeTextName: null,
        reason: changeReason,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries();
      setActiveKey(null);
    },
  });
  const waive = useMutation({
    mutationFn: async (c: Conflict) => {
      if (c.assignmentId == null || c.eventId == null) return;
      await api.waiveConflict({
        assignmentId: c.assignmentId,
        eventId: c.eventId,
        reason: waiveReason,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries();
      setActiveKey(null);
    },
  });

  const candidatesFor = (c: Conflict): { id: number; name: string }[] => {
    const absentIds = new Set<number>();
    for (const e of range.events) {
      if (!ABSENCE_CATEGORIES.includes(e.category)) continue;
      if (!e.startsOn || !e.endsOn) continue;
      if (c.date < e.startsOn || c.date > e.endsOn) continue;
      for (const a of e.assignees) if (a.personId != null) absentIds.add(a.personId);
    }
    const def = bootstrap.duties.find((d) => d.id === c.dutyDefinitionId);
    const memberIds = (def?.members ?? [])
      .map((m) => m.personId)
      .filter((x): x is number => x != null);
    const startIdx = c.personId != null ? memberIds.indexOf(c.personId) : -1;
    const ordered: number[] = [];
    if (startIdx >= 0) {
      for (let i = 1; i <= memberIds.length; i++) {
        ordered.push(memberIds[(startIdx + i) % memberIds.length]!);
      }
    }
    for (const id of memberIds) if (!ordered.includes(id)) ordered.push(id);
    for (const p of people) if (!ordered.includes(p.id)) ordered.push(p.id);
    return ordered
      .filter((id) => id !== c.personId && !absentIds.has(id))
      .map((id) => ({ id, name: people.find((p) => p.id === id)?.name ?? "" }))
      .filter((x) => x.name !== "");
  };

  // rotation generator
  const dutiesWithMembers = bootstrap.duties.filter((d) => d.members.length > 0);
  const [rotDefId, setRotDefId] = useState<string>(
    dutiesWithMembers[0] ? String(dutiesWithMembers[0].id) : "",
  );
  const [rotFrom, setRotFrom] = useState(defaultFrom);
  const [rotTo, setRotTo] = useState(defaultTo);
  const [skipWeekend, setSkipWeekend] = useState(true);
  const [skipHoliday, setSkipHoliday] = useState(true);
  const [preview, setPreview] = useState<
    { date: string; slot: string; personId: number | null; personName: string }[] | null
  >(null);
  const [applyMsg, setApplyMsg] = useState("");
  const previewMut = useMutation({
    mutationFn: async () => {
      const res = await api.previewRotation({
        dutyDefinitionId: Number(rotDefId),
        from: rotFrom,
        to: rotTo,
        startIndex: 0,
        skipWeekend,
        skipHoliday,
      });
      return res.entries;
    },
    onSuccess: (entries) => setPreview(entries),
  });
  const applyMut = useMutation({
    mutationFn: async () => {
      if (!preview) return null;
      return api.applyRotation({
        dutyDefinitionId: Number(rotDefId),
        entries: preview,
      });
    },
    onSuccess: (res) => {
      if (res) {
        setApplyMsg(
          `${res.inserted}件を割り当てました（既存の割当がある ${res.skipped} 件は上書きせずスキップ）。`,
        );
      }
      setPreview(null);
      void qc.invalidateQueries();
    },
  });

  const inputCls =
    "rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="当番と競合"
    >
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-[var(--surface)] p-4 shadow-xl sm:rounded-2xl">
        <div className="mb-3 flex items-start justify-between">
          <h2 className="font-serif text-lg font-bold">当番・競合・交代</h2>
          <button
            type="button"
            aria-label="閉じる"
            className="rounded border border-[var(--border)] px-2 py-1 text-sm"
            onClick={onClose}
          >
            閉じる
          </button>
        </div>

        <section aria-label="競合の警告">
          <h3 className="mb-1 text-sm font-bold">
            競合の警告
            {alerts.length > 0 && (
              <span className="ml-2 rounded-full bg-[#b45309] px-2 py-0.5 text-xs text-white">
                {alerts.length}件
              </span>
            )}
          </h3>
          {alerts.length === 0 && (
            <p className="text-sm text-[var(--dim)]">
              表示範囲に、出張・休暇・研修と当番の重なりや二重割当はありません。
            </p>
          )}
          <ul className="flex flex-col gap-2">
            {alerts.map((c, i) => {
              const key = `${c.kind}:${c.assignmentId}:${c.eventId}:${c.date}:${i}`;
              const isOpen = activeKey === key;
              return (
                <li
                  key={key}
                  className="rounded border border-[#b45309]/50 bg-[#b45309]/5 p-2 text-sm"
                >
                  <p>
                    <span className="font-medium">{dayLabel(c.date)}</span>
                    {c.slot !== "all_day" && `（${slotLabel(c.slot)}）`}：
                    {c.dutyName}の当番{" "}
                    <span className="font-medium">{c.personName}</span> さんに
                    {c.kind === "absence" ? (
                      <>「{c.eventTitle}」が重なっています。</>
                    ) : (
                      <>当番が二重に割り当たっています。</>
                    )}
                  </p>
                  {c.kind === "absence" && c.assignmentId != null && (
                    <>
                      <button
                        type="button"
                        className="mt-1 rounded bg-[var(--accent)] px-3 py-1 text-white"
                        onClick={() => setActiveKey(isOpen ? null : key)}
                      >
                        交代を手配する
                      </button>
                      {isOpen && (
                        <div className="mt-2 flex flex-col gap-2">
                          <div>
                            <label className="text-xs text-[var(--dim)]" htmlFor={`reason-${i}`}>
                              理由（履歴に残ります）
                            </label>
                            <input
                              id={`reason-${i}`}
                              className={`${inputCls} w-full`}
                              value={changeReason}
                              onChange={(e) => setChangeReason(e.target.value)}
                              placeholder="例：出張のため"
                            />
                          </div>
                          <p className="text-xs text-[var(--dim)]">
                            候補（その日に不在予定がなく、輪番順が近い人から表示）
                          </p>
                          {candidatesFor(c).length === 0 && (
                            <p className="text-xs">候補がいません。表の当番セルから直接人を選ぶこともできます。</p>
                          )}
                          {candidatesFor(c).map((cand) => {
                            const candAssignments = range.dutyAssignments.filter(
                              (a) =>
                                a.dutyDefinitionId === c.dutyDefinitionId &&
                                a.personId === cand.id &&
                                a.id !== c.assignmentId,
                            );
                            return (
                              <div
                                key={cand.id}
                                className="flex flex-wrap items-center gap-2 rounded bg-[var(--surface)] p-2"
                              >
                                <span className="font-medium">{cand.name}</span>
                                <button
                                  type="button"
                                  className="rounded border border-[var(--border)] px-2 py-1 text-xs"
                                  disabled={change.isPending}
                                  onClick={() =>
                                    change.mutate({
                                      kind: "substitute",
                                      assignmentAId: c.assignmentId!,
                                      toPersonId: cand.id,
                                    })
                                  }
                                >
                                  この回だけ代行してもらう
                                </button>
                                {candAssignments.slice(0, 4).map((ca) => (
                                  <button
                                    key={ca.id}
                                    type="button"
                                    className="rounded border border-[var(--border)] px-2 py-1 text-xs"
                                    disabled={change.isPending}
                                    onClick={() =>
                                      change.mutate({
                                        kind: "swap",
                                        assignmentAId: c.assignmentId!,
                                        assignmentBId: ca.id,
                                      })
                                    }
                                  >
                                    {dayLabel(ca.date)}の当番と交換
                                  </button>
                                ))}
                              </div>
                            );
                          })}
                          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-2">
                            <input
                              aria-label="このままにする理由"
                              className={`${inputCls} flex-1`}
                              placeholder="このままにする理由（例：午前のみの出張で両立できる）"
                              value={waiveReason}
                              onChange={(e) => setWaiveReason(e.target.value)}
                            />
                            <button
                              type="button"
                              className="rounded border border-[var(--border)] px-2 py-1.5 text-xs"
                              disabled={waive.isPending}
                              onClick={() => waive.mutate(c)}
                            >
                              警告のまま、このままにする
                            </button>
                          </div>
                          <p className="text-xs text-[var(--dim)]">
                            競合は警告であり、保存を止めるものではありません。
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        {unassignedByDuty.length > 0 && (
          <section className="mt-4" aria-label="未割当の当番">
            <h3 className="mb-1 text-sm font-bold">未割当の当番</h3>
            {unassignedByDuty.map(([name, list]) => (
              <p key={name} className="text-sm">
                {name}：{list.length}件（
                {list.slice(0, 8).map((c) => dayLabel(c.date)).join("、")}
                {list.length > 8 ? " ほか" : ""}）
              </p>
            ))}
            <p className="text-xs text-[var(--dim)]">
              下の輪番自動生成でまとめて下書きできます。表の当番セルから直接選ぶこともできます。
            </p>
          </section>
        )}

        <section className="mt-4" aria-label="輪番の自動生成">
          <h3 className="mb-1 text-sm font-bold">輪番の自動生成（下書き）</h3>
          {dutiesWithMembers.length === 0 ? (
            <p className="text-sm text-[var(--dim)]">
              輪番リストを持つ当番定義がありません。設定画面の「当番定義」で担当者の順番を登録してください。
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="自動生成する当番"
                  className={inputCls}
                  value={rotDefId}
                  onChange={(e) => setRotDefId(e.target.value)}
                >
                  {dutiesWithMembers.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                <input
                  aria-label="生成開始日"
                  type="date"
                  className={inputCls}
                  value={rotFrom}
                  onChange={(e) => setRotFrom(e.target.value)}
                />
                <span>〜</span>
                <input
                  aria-label="生成終了日"
                  type="date"
                  className={inputCls}
                  value={rotTo}
                  onChange={(e) => setRotTo(e.target.value)}
                />
              </div>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={skipWeekend}
                    onChange={(e) => setSkipWeekend(e.target.checked)}
                  />
                  土日を回さない
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={skipHoliday}
                    onChange={(e) => setSkipHoliday(e.target.checked)}
                  />
                  祝日を回さない
                </label>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded border border-[var(--border)] px-3 py-1.5 text-sm"
                  disabled={previewMut.isPending}
                  onClick={() => previewMut.mutate()}
                >
                  プレビュー
                </button>
                {preview && (
                  <button
                    type="button"
                    className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-white"
                    disabled={applyMut.isPending}
                    onClick={() => applyMut.mutate()}
                  >
                    この内容で割り当てる（{preview.length}件）
                  </button>
                )}
              </div>
              {applyMsg && <p className="text-sm">{applyMsg}</p>}
              {preview && (
                <ul className="max-h-48 overflow-y-auto rounded border border-[var(--border)] p-2 text-sm">
                  {preview.map((e, i) => (
                    <li key={i}>
                      {dayLabel(e.date)}
                      {e.slot !== "all_day" && `（${slotLabel(e.slot)}）`}：{e.personName}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-[var(--dim)]">
                既に割当がある日は上書きしません（手動修正・交代済みの割当は常に優先されます）。
              </p>
            </div>
          )}
        </section>

        <section className="mt-4" aria-label="交代の履歴">
          <h3 className="mb-1 text-sm font-bold">交代の履歴</h3>
          {range.dutyChanges.length === 0 ? (
            <p className="text-sm text-[var(--dim)]">まだ交代の記録はありません。</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {range.dutyChanges.map((ch) => {
                const defName =
                  bootstrap.duties.find((d) => d.id === ch.dutyDefinitionId)?.name ?? "";
                return (
                  <li key={ch.id} className="rounded bg-[var(--bg)] px-2 py-1">
                    <span className="font-medium">
                      {ch.kind === "swap" ? "交換" : ch.kind === "substitute" ? "代行" : "指名し直し"}
                    </span>
                    （{defName}）：{ch.fromLabel} → {ch.toLabel}
                    {ch.reason && <span className="text-[var(--dim)]">／理由：{ch.reason}</span>}
                    <span className="ml-2 text-xs text-[var(--dim)]">
                      {new Date(ch.createdAt).toLocaleDateString("ja-JP")}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
