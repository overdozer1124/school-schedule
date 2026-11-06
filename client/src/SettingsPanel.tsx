import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import {
DEFAULT_LEAVE_TYPES,
LAYOUTS,
VISIBILITY_OPTIONS,
type Bootstrap,
type ColumnDef,
} from "./lib";
import {
  EntitlementSection,
  ImportSection,
  LinkSection,
  TemplateSection,
} from "./Phase3Sections";

const inputCls =
  "rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";
const btnCls = "rounded border border-[var(--border)] px-2 py-1.5 text-sm";
const primaryCls =
  "rounded bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50";

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-[var(--border)] py-4">
      <h3 className="mb-2 font-serif text-base font-bold">{title}</h3>
      {children}
    </section>
  );
}

export function SettingsPanel({
  bootstrap,
  onClose,
}: {
  bootstrap: Bootstrap;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries();
  const mut = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onSuccess: invalidate,
  });
  const run = (fn: () => Promise<unknown>) => mut.mutate(fn);

  // school settings
  const [schoolName, setSchoolName] = useState(bootstrap.settings.schoolName);
  const [schoolYear, setSchoolYear] = useState(String(bootstrap.settings.schoolYear));
  const [presetMsg, setPresetMsg] = useState("");

  // person form
  const [personId, setPersonId] = useState<number | null>(null);
  const [personName, setPersonName] = useState("");
  const [personRole, setPersonRole] = useState("");
  // location form
  const [locId, setLocId] = useState<number | null>(null);
  const [locName, setLocName] = useState("");
  const [locKind, setLocKind] = useState("");
  // leave types (休暇分類リスト) — editable, persisted via saveLeaveTypes
  const initialLeaveTypes =
    bootstrap.settings.leaveTypes && bootstrap.settings.leaveTypes.length > 0
      ? bootstrap.settings.leaveTypes
      : [...DEFAULT_LEAVE_TYPES];
  const [leaveTypes, setLeaveTypes] = useState<string[]>(initialLeaveTypes);
  const [newLeaveType, setNewLeaveType] = useState("");
  const [leaveMsg, setLeaveMsg] = useState("");
  const [leaveDirty, setLeaveDirty] = useState(false);
  // holiday form
  const [holDate, setHolDate] = useState("");
  const [holName, setHolName] = useState("");
  const [holKind, setHolKind] = useState("祝日");
  // target group form
  const [groupName, setGroupName] = useState("");
  const [groupKey, setGroupKey] = useState("");
  const [newTarget, setNewTarget] = useState<Record<number, string>>({});
  // item form
  const [itemId, setItemId] = useState<number | null>(null);
  const [itemName, setItemName] = useState("");
  const [itemKey, setItemKey] = useState("");
  const [itemType, setItemType] = useState("symbol");
  const [itemGroup, setItemGroup] = useState("");
  const [itemVis, setItemVis] = useState("staff_only");
  const [itemAgg, setItemAgg] = useState(false);
  const [itemOptionsText, setItemOptionsText] = useState("");
  // duty form
  const [dutyId, setDutyId] = useState<number | null>(null);
  const [dutyName, setDutyName] = useState("");
  const [dutyGran, setDutyGran] = useState("day");
  const [dutyPeriod, setDutyPeriod] = useState("all_year");
  const [dutyFrom, setDutyFrom] = useState("");
  const [dutyTo, setDutyTo] = useState("");
  const [dutyMembers, setDutyMembers] = useState<number[]>([]);
  // period pattern form
  const [patId, setPatId] = useState<number | null>(null);
  const [patCode, setPatCode] = useState("");
  const [patName, setPatName] = useState("");
  const [patPeriodsText, setPatPeriodsText] = useState("");
  // view form
  const [viewId, setViewId] = useState<number | null>(null);
  const [viewName, setViewName] = useState("");
  const [viewLayout, setViewLayout] = useState("month_rows");
  const [viewAudience, setViewAudience] = useState("staff");
  const [viewPaper, setViewPaper] = useState("A4");
  const [viewOrient, setViewOrient] = useState("landscape");
  const [viewColumns, setViewColumns] = useState<ColumnDef[]>([]);
  const [addColSource, setAddColSource] = useState("");
  // publication history edit
  const [pubEditId, setPubEditId] = useState<number | null>(null);
  const [pubLabel, setPubLabel] = useState("");
  const [pubNote, setPubNote] = useState("");

  const presetLabel = (p: string | null) =>
    p === "elem_no_bus"
      ? "小学校（バスなし）"
      : p === "elem_bus"
        ? "小学校（バスあり）"
        : p === "junior_high"
          ? "中学校"
          : "未適用";

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-10">
      <div className="flex items-center justify-between py-3">
        <h2 className="font-serif text-lg font-bold">設定・マスタ</h2>
        <button type="button" className={btnCls} onClick={onClose}>
          予定表に戻る
        </button>
      </div>

      <Section title="学校とプリセット">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="text-xs text-[var(--dim)]" htmlFor="set-school">学校名（印刷ヘッダーに表示）</label>
            <input
              id="set-school"
              className={`${inputCls} block w-56`}
              value={schoolName}
              onChange={(e) => setSchoolName(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-[var(--dim)]" htmlFor="set-year">年度</label>
            <input
              id="set-year"
              type="number"
              className={`${inputCls} block w-24`}
              value={schoolYear}
              onChange={(e) => setSchoolYear(e.target.value)}
            />
          </div>
          <button
            type="button"
          className={primaryCls}
            onClick={() =>
              run(() =>
                api.saveSettings({
                  schoolName,
                  schoolYear: Number(schoolYear) || 2026,
                }),
              )
            }
          >
            保存
          </button>
        </div>
        <p className="mt-3 text-sm">
          プリセットは初期値です。適用後に項目・当番・ビューは自由に編集できます（適用済み：
          {presetLabel(bootstrap.settings.presetApplied)}）。
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {(
            [
              ["elem_no_bus", "小学校（バスなし）", "給食・学年別下校・清掃・放課後、当番なし"],
              ["elem_bus", "小学校（バスあり）", "上記＋スクールバス（便別）・日番"],
              ["junior_high", "中学校", "給食・部活動・最終下校、日直＋週番、部の対象軸"],
            ] as const
          ).map(([key, label, desc]) => (
            <button
              key={key}
              type="button"
              className={`${btnCls} text-left`}
              onClick={() =>
                run(async () => {
                  await api.applyPreset({ preset: key });
                  setPresetMsg(`${label}プリセットを適用しました。`);
                })
              }
            >
              <span className="font-medium">{label}</span>
              <span className="block text-xs text-[var(--dim)]">{desc}</span>
            </button>
          ))}
        </div>
        {presetMsg && <p className="mt-1 text-sm">{presetMsg}</p>}
      </Section>

      <Section title="人（教職員・担当者候補）">
        <p className="mb-2 text-xs text-[var(--dim)]">
          マスタの出所：{bootstrap.settings.peopleSource === "linked" ? "参照（school-timetable）" : "自前（このアプリで保持）"}
          {bootstrap.settings.linkMode === "linked" ? "／連携モード" : "／単独モード"}（変更は下の「school-timetable連携」から）
        </p>
        <ul className="mb-2 flex flex-col gap-1 text-sm">
          {bootstrap.people.map((p) => (
            <li key={p.id} className="flex items-center gap-2">
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setPersonId(p.id);
                  setPersonName(p.name);
                  setPersonRole(p.role);
                }}
              >
                {p.name}
              </button>
              <span className="text-[var(--dim)]">{p.role}</span>
              <button
                type="button"
                aria-label={`${p.name}を削除`}
                className="text-[#b91c1c]"
                onClick={() => run(() => api.deletePerson({ id: p.id }))}
              >
                削除
              </button>
            </li>
          ))}
          {bootstrap.people.length === 0 && (
            <li className="text-[var(--dim)]">まだ登録がありません。下のフォームから追加してください。</li>
          )}
        </ul>
        <div className="flex flex-wrap gap-2">
          <input
            aria-label="氏名"
            className={inputCls}
            placeholder="氏名"
            value={personName}
            onChange={(e) => setPersonName(e.target.value)}
          />
          <input
            aria-label="役職・担当"
            className={inputCls}
            placeholder="役職・担当（任意）"
            value={personRole}
            onChange={(e) => setPersonRole(e.target.value)}
          />
          <button
            type="button"
            className={primaryCls}
            disabled={personName.trim() === ""}
            onClick={() =>
              run(async () => {
                await api.upsertPerson({
                  id: personId,
                  name: personName.trim(),
                  role: personRole,
                  sort: bootstrap.people.length,
                });
                setPersonId(null);
                setPersonName("");
                setPersonRole("");
              })
            }
          >
            {personId != null ? "更新" : "追加"}
          </button>
          {personId != null && (
            <button
              type="button"
              className={btnCls}
              onClick={() => {
                setPersonId(null);
                setPersonName("");
                setPersonRole("");
              }}
            >
              新規入力に戻す
            </button>
          )}
        </div>
      </Section>

      <Section title="場所">
        <ul className="mb-2 flex flex-col gap-1 text-sm">
          {bootstrap.locations.map((l) => (
            <li key={l.id} className="flex items-center gap-2">
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setLocId(l.id);
                  setLocName(l.name);
                  setLocKind(l.kind);
                }}
              >
                {l.name}
              </button>
              <span className="text-[var(--dim)]">{l.kind}</span>
              <button
                type="button"
                aria-label={`${l.name}を削除`}
                className="text-[#b91c1c]"
                onClick={() => run(() => api.deleteLocation({ id: l.id }))}
              >
                削除
              </button>
            </li>
          ))}
          {bootstrap.locations.length === 0 && (
            <li className="text-[var(--dim)]">まだ登録がありません（体育館、音楽室、校外施設など）。</li>
          )}
        </ul>
        <div className="flex flex-wrap gap-2">
          <input
            aria-label="場所名"
            className={inputCls}
            placeholder="場所名"
            value={locName}
            onChange={(e) => setLocName(e.target.value)}
          />
          <input
            aria-label="場所の種別"
            className={inputCls}
            placeholder="種別（教室／体育館／校外など、任意）"
            value={locKind}
            onChange={(e) => setLocKind(e.target.value)}
          />
          <button
            type="button"
            className={primaryCls}
            disabled={locName.trim() === ""}
            onClick={() =>
              run(async () => {
                await api.upsertLocation({
                  id: locId,
                  name: locName.trim(),
                  kind: locKind,
                  sort: bootstrap.locations.length,
                });
                setLocId(null);
                setLocName("");
                setLocKind("");
              })
            }
          >
            {locId != null ? "更新" : "追加"}
          </button>
        </div>
      </Section>

      <Section title="休暇分類（休暇の選択リスト）">
        <p className="mb-2 text-sm text-[var(--dim)]">
          種別「休暇」の予定で、場所の代わりに選ぶ分類のリストです。クイック入力と詳細編集の両方に反映されます。並び順がそのまま表示順になります。リストにない分類も、入力画面では直接入力できます（既存の予定に保存済みの分類は、リストから外しても表示は変わりません）。
        </p>
        <ul className="mb-2 flex flex-col gap-1">
          {leaveTypes.map((t, i) => (
            <li key={i} className="flex flex-wrap items-center gap-1">
              <span className="w-6 text-right text-xs text-[var(--dim)]">{i + 1}.</span>
              <input
                aria-label={`休暇分類 ${i + 1}`}
                className={`${inputCls} w-40`}
                value={t}
                onChange={(e) => {
                  const next = [...leaveTypes];
                  next[i] = e.target.value;
                  setLeaveTypes(next);
                  setLeaveDirty(true);
                  setLeaveMsg("");
                }}
              />
              <button
                type="button"
                aria-label={`${t}を上へ`}
                className={btnCls}
                disabled={i === 0}
                onClick={() => {
                  if (i === 0) return;
                  const next = [...leaveTypes];
                  [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
                  setLeaveTypes(next);
                  setLeaveDirty(true);
                  setLeaveMsg("");
                }}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`${t}を下へ`}
                className={btnCls}
                disabled={i >= leaveTypes.length - 1}
                onClick={() => {
                  if (i >= leaveTypes.length - 1) return;
                  const next = [...leaveTypes];
                  [next[i + 1], next[i]] = [next[i]!, next[i + 1]!];
                  setLeaveTypes(next);
                  setLeaveDirty(true);
                  setLeaveMsg("");
                }}
              >
                ↓
              </button>
              <button
                type="button"
                aria-label={`${t}を休暇分類から削除`}
                className="px-1 text-sm text-[#b91c1c]"
                onClick={() => {
                  setLeaveTypes(leaveTypes.filter((_, j) => j !== i));
                  setLeaveDirty(true);
                  setLeaveMsg("");
                }}
              >
                削除
              </button>
            </li>
          ))}
          {leaveTypes.length === 0 && (
            <li className="text-sm text-[var(--dim)]">
              分類がありません。下から追加するか、「初期値に戻す」を押してください（空のまま保存すると初期値が復元されます）。
            </li>
          )}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label="新しい休暇分類"
            className={inputCls}
            placeholder="新しい分類（例：介護）"
            value={newLeaveType}
            onChange={(e) => setNewLeaveType(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
              e.preventDefault();
              const v = newLeaveType.trim();
              if (!v) return;
              if (leaveTypes.includes(v)) {
                setLeaveMsg(`「${v}」はすでにリストにあります。`);
                return;
              }
              setLeaveTypes([...leaveTypes, v]);
              setNewLeaveType("");
              setLeaveDirty(true);
              setLeaveMsg("");
            }}
          />
          <button
            type="button"
            className={btnCls}
            disabled={newLeaveType.trim() === ""}
            onClick={() => {
              const v = newLeaveType.trim();
              if (!v) return;
              if (leaveTypes.includes(v)) {
                setLeaveMsg(`「${v}」はすでにリストにあります。`);
                return;
              }
              setLeaveTypes([...leaveTypes, v]);
              setNewLeaveType("");
              setLeaveDirty(true);
              setLeaveMsg("");
            }}
          >
            追加
          </button>
          <button
            type="button"
            className={btnCls}
            onClick={() => {
              setLeaveTypes([...DEFAULT_LEAVE_TYPES]);
              setLeaveDirty(true);
              setLeaveMsg("");
            }}
          >
            初期値に戻す
          </button>
          <button
            type="button"
            className={primaryCls}
            disabled={!leaveDirty || mut.isPending}
            onClick={() =>
              run(async () => {
                await api.saveLeaveTypes({ leaveTypes });
                setLeaveDirty(false);
                setLeaveMsg("休暇分類リストを保存しました。");
              })
            }
          >
            休暇分類を保存
          </button>
        </div>
        {leaveDirty && (
          <p className="mt-1 text-xs text-[var(--dim)]">未保存の変更があります。「休暇分類を保存」を押すと反映されます。</p>
        )}
        {leaveMsg && <p className="mt-1 text-sm">{leaveMsg}</p>}
      </Section>

      <Section title="祝日・学校休業日">
        <ul className="mb-2 flex flex-col gap-1 text-sm">
          {bootstrap.holidays.map((h) => (
            <li key={h.id} className="flex items-center gap-2">
              <span>{h.date}</span>
              <span className="font-medium">{h.name}</span>
              <span className="text-[var(--dim)]">{h.kind}</span>
              <button
                type="button"
                aria-label={`${h.name}を削除`}
                className="text-[#b91c1c]"
                onClick={() => run(() => api.deleteHoliday({ id: h.id }))}
              >
                削除
              </button>
            </li>
          ))}
          {bootstrap.holidays.length === 0 && (
            <li className="text-[var(--dim)]">まだ登録がありません。登録すると日曜と同じ赤表示になり、輪番生成のスキップ対象にできます。</li>
          )}
        </ul>
        <div className="flex flex-wrap gap-2">
          <input
            aria-label="祝日の日付"
            type="date"
            className={inputCls}
            value={holDate}
            onChange={(e) => setHolDate(e.target.value)}
          />
          <input
            aria-label="祝日名"
            className={inputCls}
            placeholder="名称（例：文化の日）"
            value={holName}
            onChange={(e) => setHolName(e.target.value)}
          />
          <select
            aria-label="祝日の種別"
            className={inputCls}
            value={holKind}
            onChange={(e) => setHolKind(e.target.value)}
          >
            <option value="祝日">祝日</option>
            <option value="振替休日">振替休日</option>
            <option value="学校休業日">学校休業日</option>
            <option value="閉庁日">閉庁日</option>
          </select>
          <button
            type="button"
            className={primaryCls}
            disabled={!holDate || holName.trim() === ""}
            onClick={() =>
              run(async () => {
                await api.upsertHoliday({ id: null, date: holDate, name: holName.trim(), kind: holKind });
                setHolName("");
              })
            }
          >
            追加
          </button>
        </div>
      </Section>

      <Section title="対象軸（学年・部・バス便など）">
        <p className="mb-2 text-xs text-[var(--dim)]">
          マスタの出所：{bootstrap.settings.targetsSource === "linked" ? "参照（school-timetable）" : "自前（このアプリで保持）"}
          {bootstrap.settings.linkMode === "linked" ? "／連携モード" : "／単独モード"}（変更は下の「school-timetable連携」から）
        </p>
        {bootstrap.targetGroups.map((g) => (
          <div key={g.id} className="mb-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">{g.name}</span>
              <span className="text-xs text-[var(--dim)]">key: {g.key}</span>
              <button
                type="button"
                aria-label={`${g.name}を削除`}
                className="text-[#b91c1c]"
                onClick={() => run(() => api.deleteTargetGroup({ id: g.id }))}
              >
                軸を削除
              </button>
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {g.targets.map((t) => (
                <span key={t.id} className="inline-flex items-center gap-1 rounded-full bg-[var(--bg)] px-2 py-0.5 text-sm">
                  {t.name}
                  <button
                    type="button"
                    aria-label={`${t.name}を削除`}
                    onClick={() => run(() => api.deleteTarget({ id: t.id }))}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="mt-1 flex gap-2">
              <input
                aria-label={`${g.name}に対象を追加`}
                className={inputCls}
                placeholder="対象名（例：7年、野球部、⑤便）"
                value={newTarget[g.id] ?? ""}
                onChange={(e) => setNewTarget({ ...newTarget, [g.id]: e.target.value })}
              />
              <button
                type="button"
                className={btnCls}
                disabled={(newTarget[g.id] ?? "").trim() === ""}
                onClick={() =>
                  run(async () => {
                    await api.upsertTarget({
                      id: null,
                      groupId: g.id,
                      name: (newTarget[g.id] ?? "").trim(),
                      sort: g.targets.length,
                    });
                    setNewTarget({ ...newTarget, [g.id]: "" });
                  })
                }
              >
                追加
              </button>
            </div>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <input
            aria-label="対象軸の名前"
            className={inputCls}
            placeholder="軸の名前（例：通学班）"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
          />
          <input
            aria-label="対象軸のキー"
            className={inputCls}
            placeholder="キー（英字、例：commute）"
            value={groupKey}
            onChange={(e) => setGroupKey(e.target.value)}
          />
          <button
            type="button"
            className={primaryCls}
            disabled={groupName.trim() === "" || groupKey.trim() === ""}
            onClick={() =>
              run(async () => {
                await api.upsertTargetGroup({
                  id: null,
                  key: groupKey.trim(),
                  name: groupName.trim(),
                  sort: bootstrap.targetGroups.length,
                });
                setGroupName("");
                setGroupKey("");
              })
            }
          >
            軸を追加
          </button>
        </div>
      </Section>

      <Section title="項目定義（表の列）">
        <ul className="mb-2 flex flex-col gap-1 text-sm">
          {bootstrap.items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="font-medium underline"
                onClick={() => {
                  setItemId(i.id);
                  setItemName(i.name);
                  setItemKey(i.key);
                  setItemType(i.valueType);
                  setItemGroup(i.targetGroupId != null ? String(i.targetGroupId) : "");
                  setItemVis(i.defaultVisibility);
                  setItemAgg(i.isAggregatable === 1);
                  setItemOptionsText(
                    i.options
                      .map((o) => `${o.code}|${o.meaning}|${o.countsAs}`)
                      .join("\n"),
                  );
                }}
              >
                {i.name}
              </button>
              <span className="text-[var(--dim)]">
                {i.valueType}
                {i.targetGroupId != null
                  ? `／対象：${bootstrap.targetGroups.find((g) => g.id === i.targetGroupId)?.name ?? ""}別`
                  : ""}
              </span>
              <button
                type="button"
                aria-label={`${i.name}を削除`}
                className="text-[#b91c1c]"
                onClick={() => run(() => api.deleteItemDefinition({ id: i.id }))}
              >
                削除
              </button>
            </li>
          ))}
          {bootstrap.items.length === 0 && (
            <li className="text-[var(--dim)]">まだ項目がありません。プリセット適用か、下のフォームで追加してください。</li>
          )}
        </ul>
        <div className="grid max-w-xl grid-cols-1 gap-2">
          <div className="flex gap-2">
            <input
              aria-label="項目名"
              className={`${inputCls} flex-1`}
              placeholder="項目名（例：会議、給食）"
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
            />
            <input
              aria-label="項目キー"
              className={`${inputCls} w-32`}
              placeholder="キー（英字）"
              value={itemKey}
              onChange={(e) => setItemKey(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              aria-label="値の型"
              className={inputCls}
              value={itemType}
              onChange={(e) => setItemType(e.target.value)}
            >
              <option value="symbol">記号（凡例から選択）</option>
              <option value="boolean">○×</option>
              <option value="text">自由文</option>
              <option value="time">時刻</option>
              <option value="time_range">時刻範囲</option>
              <option value="number">数値</option>
              <option value="person">人名</option>
            </select>
            <select
              aria-label="対象軸"
              className={inputCls}
              value={itemGroup}
              onChange={(e) => setItemGroup(e.target.value)}
            >
              <option value="">対象で分けない</option>
              {bootstrap.targetGroups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}別にする</option>
              ))}
            </select>
            <select
              aria-label="項目の公開範囲"
              className={inputCls}
              value={itemVis}
              onChange={(e) => setItemVis(e.target.value)}
            >
              {VISIBILITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={itemAgg}
                onChange={(e) => setItemAgg(e.target.checked)}
              />
              日数を集計する
            </label>
          </div>
          <div>
            <label className="text-xs text-[var(--dim)]" htmlFor="item-options">
              記号の凡例（記号型・○×型のみ。1行に1つ：記号｜意味｜集計に数える場合は1）
            </label>
            <textarea
              id="item-options"
              className={`${inputCls} w-full`}
              rows={3}
              placeholder={"○|実施する|1\n×|実施しない|0"}
              value={itemOptionsText}
              onChange={(e) => setItemOptionsText(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className={primaryCls}
              disabled={itemName.trim() === "" || itemKey.trim() === ""}
              onClick={() =>
                run(async () => {
                  const options = itemOptionsText
                    .split("\n")
                    .map((line) => line.trim())
                    .filter((line) => line !== "")
                    .map((line) => {
                      const [code = "", meaning = "", counts = "0"] = line.split("|");
                      return {
                        code: code.trim(),
                        label: code.trim(),
                        meaning: meaning.trim(),
                        countsAs: counts.trim() === "1" ? 1 : 0,
                      };
                    })
                    .filter((o) => o.code !== "");
                  await api.upsertItemDefinition({
                    id: itemId,
                    key: itemKey.trim(),
                    name: itemName.trim(),
                    valueType: itemType,
                    targetGroupId: itemGroup === "" ? null : Number(itemGroup),
                    granularity: "day",
                    defaultVisibility: itemVis,
                    isAggregatable: itemAgg ? 1 : 0,
                    sort: bootstrap.items.length,
                    options,
                  });
                  setItemId(null);
                  setItemName("");
                  setItemKey("");
                  setItemOptionsText("");
                })
              }
            >
              {itemId != null ? "項目を更新" : "項目を追加"}
            </button>
            {itemId != null && (
              <button
                type="button"
                className={btnCls}
                onClick={() => {
                  setItemId(null);
                  setItemName("");
                  setItemKey("");
                  setItemOptionsText("");
                }}
              >
                新規入力に戻す
              </button>
            )}
          </div>
        </div>
      </Section>

      <Section title="当番定義（日番・日直・週番など）">
        <ul className="mb-2 flex flex-col gap-1 text-sm">
          {bootstrap.duties.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="font-medium underline"
                onClick={() => {
                  setDutyId(d.id);
                  setDutyName(d.name);
                  setDutyGran(d.granularity);
                  setDutyPeriod(d.applicablePeriod);
                  setDutyFrom(d.startsOn ?? "");
                  setDutyTo(d.endsOn ?? "");
                  setDutyMembers(
                    d.members
                      .map((m) => m.personId)
                      .filter((x): x is number => x != null),
                  );
                }}
              >
                {d.name}
              </button>
              <span className="text-[var(--dim)]">
                {d.granularity === "day" ? "1日単位" : d.granularity === "am_pm" ? "午前・午後" : "週単位"}
                ／{d.applicablePeriod === "all_year" ? "通年" : d.applicablePeriod === "long_vacation_only" ? "長期休業のみ" : "期間指定"}
                ／輪番 {d.members.length}人
              </span>
              <button
                type="button"
                aria-label={`${d.name}を削除`}
                className="text-[#b91c1c]"
                onClick={() => run(() => api.deleteDutyDefinition({ id: d.id }))}
              >
                削除
              </button>
            </li>
          ))}
          {bootstrap.duties.length === 0 && (
            <li className="text-[var(--dim)]">当番定義がありません。当番のない学校では、このままで構いません。</li>
          )}
        </ul>
        <div className="grid max-w-xl grid-cols-1 gap-2">
          <div className="flex flex-wrap gap-2">
            <input
              aria-label="当番名"
              className={inputCls}
              placeholder="当番名（例：日番、夏休み日直）"
              value={dutyName}
              onChange={(e) => setDutyName(e.target.value)}
            />
            <select
              aria-label="当番の粒度"
              className={inputCls}
              value={dutyGran}
              onChange={(e) => setDutyGran(e.target.value)}
            >
              <option value="day">1日単位</option>
              <option value="am_pm">午前・午後で分ける</option>
              <option value="week">週単位</option>
            </select>
            <select
              aria-label="当番の適用期間"
              className={inputCls}
              value={dutyPeriod}
              onChange={(e) => setDutyPeriod(e.target.value)}
            >
              <option value="all_year">通年</option>
              <option value="long_vacation_only">長期休業のみ</option>
              <option value="custom_range">期間を指定</option>
            </select>
          </div>
          {dutyPeriod !== "all_year" && (
            <div className="flex items-center gap-2">
              <input
                aria-label="当番の開始日"
                type="date"
                className={inputCls}
                value={dutyFrom}
                onChange={(e) => setDutyFrom(e.target.value)}
              />
              <span>〜</span>
              <input
                aria-label="当番の終了日"
                type="date"
                className={inputCls}
                value={dutyTo}
                onChange={(e) => setDutyTo(e.target.value)}
              />
            </div>
          )}
          <div>
            <span className="text-xs text-[var(--dim)]">
              輪番リスト（チェックした人が、人の登録順で輪番になります）
            </span>
            <div className="mt-1 flex flex-wrap gap-2">
              {bootstrap.people.map((p) => (
                <label key={p.id} className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={dutyMembers.includes(p.id)}
                    onChange={(e) =>
                      setDutyMembers(
                        e.target.checked
                          ? [...dutyMembers, p.id]
                          : dutyMembers.filter((x) => x !== p.id),
                      )
                    }
                  />
                  {p.name}
                </label>
              ))}
              {bootstrap.people.length === 0 && (
                <span className="text-xs text-[var(--dim)]">先に「人」を登録してください。</span>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className={primaryCls}
              disabled={dutyName.trim() === ""}
              onClick={() =>
                run(async () => {
                  const ordered = bootstrap.people
                    .filter((p) => dutyMembers.includes(p.id))
                    .map((p) => p.id);
                  await api.upsertDutyDefinition({
                    id: dutyId,
                    name: dutyName.trim(),
                    granularity: dutyGran,
                    applicablePeriod: dutyPeriod,
                    startsOn: dutyPeriod === "all_year" ? null : dutyFrom || null,
                    endsOn: dutyPeriod === "all_year" ? null : dutyTo || null,
                    sort: bootstrap.duties.length,
                    memberPersonIds: ordered,
                  });
                  setDutyId(null);
                  setDutyName("");
                  setDutyMembers([]);
                })
              }
            >
              {dutyId != null ? "当番を更新" : "当番を追加"}
            </button>
            {dutyId != null && (
              <button
                type="button"
                className={btnCls}
                onClick={() => {
                  setDutyId(null);
                  setDutyName("");
                  setDutyMembers([]);
                }}
              >
                新規入力に戻す
              </button>
            )}
          </div>
        </div>
      </Section>

      <Section title="時限・日課パターン">
        <p className="mb-2 text-xs text-[var(--dim)]">
          マスタの出所：{bootstrap.settings.periodsSource === "linked" ? "参照（school-timetable）" : "自前（このアプリで保持）"}
          {bootstrap.settings.linkMode === "linked" ? "／連携モード" : "／単独モード"}（変更は下の「school-timetable連携」から）
        </p>
        {bootstrap.periodPatterns.map((p) => (
          <div key={p.id} className="mb-2 text-sm">
            <button
              type="button"
              className="font-medium underline"
              onClick={() => {
                setPatId(p.id);
                setPatCode(p.code);
                setPatName(p.name);
                setPatPeriodsText(
                  p.periods
                    .map((d) => `${d.periodNo}|${d.label}|${d.startsAt ?? ""}|${d.endsAt ?? ""}`)
                    .join("\n"),
                );
              }}
            >
              {p.name}
            </button>
            <span className="ml-2 text-[var(--dim)]">
              {p.periods.map((d) => d.label).join("・")}
            </span>
            <button
              type="button"
              aria-label={`${p.name}を削除`}
              className="ml-2 text-[#b91c1c]"
              onClick={() => run(() => api.deletePeriodPattern({ id: p.id }))}
            >
              削除
            </button>
          </div>
        ))}
        <div className="grid max-w-xl grid-cols-1 gap-2">
          <div className="flex gap-2">
            <input
              aria-label="日課コード"
              className={`${inputCls} w-24`}
              placeholder="コード（A等）"
              value={patCode}
              onChange={(e) => setPatCode(e.target.value)}
            />
            <input
              aria-label="日課名"
              className={`${inputCls} flex-1`}
              placeholder="名前（例：A日課・7限）"
              value={patName}
              onChange={(e) => setPatName(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-[var(--dim)]" htmlFor="pat-periods">
              時限（1行に1つ：番号｜ラベル｜開始｜終了。朝=0、放課後=99。時限数は行数で決まります）
            </label>
            <textarea
              id="pat-periods"
              className={`${inputCls} w-full`}
              rows={5}
              placeholder={"0|朝|08:20|08:40\n1|1限|08:45|09:30\n99|放課後|15:10|16:00"}
              value={patPeriodsText}
              onChange={(e) => setPatPeriodsText(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className={primaryCls}
              disabled={patCode.trim() === "" || patName.trim() === ""}
              onClick={() =>
                run(async () => {
                  const periods = patPeriodsText
                    .split("\n")
                    .map((l) => l.trim())
                    .filter((l) => l !== "")
                    .map((l) => {
                      const [no = "1", label = "", s = "", e = ""] = l.split("|");
                      return {
                        periodNo: Number(no) || 0,
                        label: label.trim(),
                        startsAt: s.trim() || null,
                        endsAt: e.trim() || null,
                      };
                    })
                    .filter((p) => p.label !== "");
                  await api.upsertPeriodPattern({
                    id: patId,
                    code: patCode.trim(),
                    name: patName.trim(),
                    sort: bootstrap.periodPatterns.length,
                    periods,
                  });
                  setPatId(null);
                  setPatCode("");
                  setPatName("");
                  setPatPeriodsText("");
                })
              }
            >
              {patId != null ? "日課を更新" : "日課を追加"}
            </button>
          </div>
        </div>
      </Section>

      <Section title="ビュー（表示の定義）">
        <ul className="mb-2 flex flex-col gap-1 text-sm">
          {bootstrap.views.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="font-medium underline"
                onClick={() => {
                  setViewId(v.id);
                  setViewName(v.name);
                  setViewLayout(v.layout);
                  setViewAudience(v.audience);
                  try {
                    const pj = JSON.parse(v.printJson) as { paper?: string; orientation?: string };
                    setViewPaper(pj.paper ?? "A4");
                    setViewOrient(pj.orientation ?? "landscape");
                  } catch { /* keep defaults */ }
                  try {
                    setViewColumns(JSON.parse(v.columnsJson) as ColumnDef[]);
                  } catch {
                    setViewColumns([]);
                  }
                }}
              >
                {v.name}
              </button>
              <span className="text-[var(--dim)]">
                {LAYOUTS.find((l) => l.key === v.layout)?.label ?? v.layout}／
                {v.audience === "staff" ? "職員用" : v.audience === "guardian" ? "保護者用" : v.audience === "student" ? "生徒用" : "公開用"}
              </span>
              <button
                type="button"
                aria-label={`${v.name}を削除`}
                className="text-[#b91c1c]"
                onClick={() => run(() => api.deleteView({ id: v.id }))}
              >
                削除
              </button>
            </li>
          ))}
        </ul>
        <div className="grid max-w-xl grid-cols-1 gap-2">
          <div className="flex flex-wrap gap-2">
            <input
              aria-label="ビュー名"
              className={inputCls}
              placeholder="ビュー名（例：生徒用月表）"
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
            />
            <select
              aria-label="ビューのレイアウト"
              className={inputCls}
              value={viewLayout}
              onChange={(e) => setViewLayout(e.target.value)}
            >
              {LAYOUTS.map((l) => (
                <option key={l.key} value={l.key}>{l.label}</option>
              ))}
            </select>
            <select
              aria-label="ビューの対象者"
              className={inputCls}
              value={viewAudience}
              onChange={(e) => setViewAudience(e.target.value)}
            >
              <option value="staff">職員用</option>
              <option value="guardian">保護者用</option>
              <option value="student">生徒用</option>
              <option value="public">公開用</option>
            </select>
            <select
              aria-label="印刷の用紙"
              className={inputCls}
              value={viewPaper}
              onChange={(e) => setViewPaper(e.target.value)}
            >
              <option value="A4">A4</option>
              <option value="A3">A3</option>
            </select>
            <select
              aria-label="印刷の向き"
              className={inputCls}
              value={viewOrient}
              onChange={(e) => setViewOrient(e.target.value)}
            >
              <option value="landscape">横</option>
              <option value="portrait">縦</option>
            </select>
          </div>
          <div>
            <span className="text-xs text-[var(--dim)]">列の構成（上から順に表示。会議だけの列もここで作れます）</span>
            <ul className="mt-1 flex flex-col gap-1">
              {viewColumns.map((c, i) => (
                <li key={i} className="flex items-center gap-1 text-sm">
                  <input
                    aria-label="列の見出し"
                    className={`${inputCls} w-40`}
                    value={c.label}
                    onChange={(e) => {
                      const next = [...viewColumns];
                      next[i] = { ...c, label: e.target.value };
                      setViewColumns(next);
                    }}
                  />
                  <button
                    type="button"
                    aria-label="列を上へ"
                    className={btnCls}
                    onClick={() => {
                      if (i === 0) return;
                      const next = [...viewColumns];
                      [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
                      setViewColumns(next);
                    }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label="列を下へ"
                    className={btnCls}
                    onClick={() => {
                      if (i >= viewColumns.length - 1) return;
                      const next = [...viewColumns];
                      [next[i + 1], next[i]] = [next[i]!, next[i + 1]!];
                      setViewColumns(next);
                    }}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label="列を削除"
                    className="text-[#b91c1c]"
                    onClick={() => setViewColumns(viewColumns.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-1 flex gap-2">
              <select
                aria-label="追加する列"
                className={inputCls}
                value={addColSource}
                onChange={(e) => setAddColSource(e.target.value)}
              >
                <option value="">列を追加…</option>
                <optgroup label="予定の種別">
                  {["行事", "会議", "出張", "〆切", "休暇", "研修", "その他"].map((c) => (
                    <option key={c} value={`cat:${c}`}>{c}の列</option>
                  ))}
                </optgroup>
                <optgroup label="日次項目">
                  {bootstrap.items.map((i) => (
                    <option key={i.id} value={`item:${i.id}`}>{i.name}</option>
                  ))}
                </optgroup>
                <optgroup label="当番">
                  {bootstrap.duties.map((d) => (
                    <option key={d.id} value={`duty:${d.id}`}>{d.name}</option>
                  ))}
                </optgroup>
              </select>
              <button
                type="button"
                className={btnCls}
                disabled={addColSource === ""}
                onClick={() => {
                  const [kind = "", rest = ""] = addColSource.split(":");
                  if (kind === "cat") {
                    setViewColumns([...viewColumns, { kind: "category", category: rest, label: rest }]);
                  } else if (kind === "item") {
                    const item = bootstrap.items.find((i) => i.id === Number(rest));
                    if (item) setViewColumns([...viewColumns, { kind: "daily_item", itemId: item.id, label: item.name }]);
                  } else if (kind === "duty") {
                    const duty = bootstrap.duties.find((d) => d.id === Number(rest));
                    if (duty) setViewColumns([...viewColumns, { kind: "duty", dutyId: duty.id, label: duty.name }]);
                  }
                  setAddColSource("");
                }}
              >
                追加
              </button>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className={primaryCls}
              disabled={viewName.trim() === ""}
              onClick={() =>
                run(async () => {
                  await api.upsertView({
                    id: viewId,
                    name: viewName.trim(),
                    layout: viewLayout,
                    audience: viewAudience,
                    columnsJson: JSON.stringify(viewColumns),
                    printJson: JSON.stringify({ paper: viewPaper, orientation: viewOrient }),
                    sort: bootstrap.views.length,
                  });
                  setViewId(null);
                  setViewName("");
                  setViewColumns([]);
                })
              }
            >
              {viewId != null ? "ビューを更新" : "ビューを追加"}
            </button>
            {viewId != null && (
              <button
                type="button"
                className={btnCls}
                onClick={() => {
                  setViewId(null);
                  setViewName("");
                  setViewColumns([]);
                }}
              >
                新規入力に戻す
              </button>
            )}
          </div>
        </div>
      </Section>

      <Section title="発行履歴（印刷・配布した版）">
        {bootstrap.publications.length === 0 ? (
          <p className="text-sm text-[var(--dim)]">
            まだ発行記録がありません。予定表の「印刷・PDF」から版を発行すると、ここに残ります。
          </p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {bootstrap.publications.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2">
                {pubEditId === p.id ? (
                  <>
                    <input
                      aria-label="版ラベル"
                      className={`${inputCls} w-40`}
                      value={pubLabel}
                      onChange={(e) => setPubLabel(e.target.value)}
                    />
                    <input
                      aria-label="発行のメモ"
                      className={`${inputCls} w-48`}
                      placeholder="メモ（配布先など）"
                      value={pubNote}
                      onChange={(e) => setPubNote(e.target.value)}
                    />
                    <button
                      type="button"
                      className={btnCls}
                      disabled={pubLabel.trim() === ""}
                      onClick={() =>
                        run(async () => {
                          await api.updatePublication({
                            id: p.id,
                            versionLabel: pubLabel.trim(),
                            note: pubNote.trim(),
                          });
                          setPubEditId(null);
                        })
                      }
                    >
                      保存
                    </button>
                    <button
                      type="button"
                      className={btnCls}
                      onClick={() => setPubEditId(null)}
                    >
                      やめる
                    </button>
                  </>
                ) : (
                  <>
                    <span>
                      {p.targetMonth}／{p.viewName}／版：{p.versionLabel}
                    </span>
                    <span className="text-xs text-[var(--dim)]">
                      {new Date(p.publishedAt).toLocaleString("ja-JP")}
                    </span>
                    {p.note && <span className="text-[var(--dim)]">／{p.note}</span>}
                    <button
                      type="button"
                      aria-label={`${p.versionLabel}を編集`}
                      className="underline"
                      onClick={() => {
                        setPubEditId(p.id);
                        setPubLabel(p.versionLabel);
                        setPubNote(p.note);
                      }}
                    >
                      編集
                    </button>
                    <button
                      type="button"
                      aria-label={`${p.versionLabel}を削除`}
                      className="text-[#b91c1c]"
                      onClick={() => run(() => api.deletePublication({ id: p.id }))}
                    >
                      削除
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <ImportSection bootstrap={bootstrap} />
      <TemplateSection bootstrap={bootstrap} />
      <LinkSection bootstrap={bootstrap} />
      <EntitlementSection bootstrap={bootstrap} />
    </div>
  );
}
