// Phase 3 sections for the settings screen (DESIGN §10 / §12):
// ① CSV / spreadsheet import with column mapping,
// ② definition template export / import (JSON),
// ③ school-timetable link-mode settings + master name-matching,
// ④ product entitlement administration.
// The link is settings-and-records only in this prototype: no real
// federation, SSO, or billing happens, and the UI says so.

import { useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, type ApiRequest } from "./api";
import {
  CATEGORIES,
  ENT_STATUS_LABELS,
  PLAN_LABELS,
  PRODUCT_LABELS,
  entitlementUsable,
  governingEntitlement,
  type Bootstrap,
} from "./lib";

const inputCls =
  "rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm";
const btnCls = "rounded border border-[var(--border)] px-2 py-1.5 text-sm";
const primaryCls =
  "rounded bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-[var(--border)] py-4">
      <h3 className="mb-2 font-serif text-base font-bold">{title}</h3>
      {children}
    </section>
  );
}

// ---------------- shared CSV helpers ----------------

type ImportRow = ApiRequest<typeof api, "importEvents">["rows"][number];

/** Parses CSV or TSV text (spreadsheet paste), honoring quoted fields. */
export function parseDelimited(text: string): string[][] {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  const delim = firstLine.includes("\t") ? "\t" : ",";
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

async function readTextFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    // Excel-saved CSV files in Japan are often Shift_JIS.
    return new TextDecoder("shift_jis").decode(buf);
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** School year runs April–March: Jan–Mar belong to schoolYear + 1. */
function schoolYearDate(schoolYear: number, month: number, day: number): string {
  const y = month >= 4 ? schoolYear : schoolYear + 1;
  return `${y}-${pad2(month)}-${pad2(day)}`;
}

export function normalizeDate(raw: string, schoolYear: number): string | null {
  const s = raw.trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${pad2(Number(m[2]))}-${pad2(Number(m[3]))}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/月](\d{1,2})日?$/);
  if (m) return schoolYearDate(schoolYear, Number(m[1]), Number(m[2]));
  return null;
}

export function normalizeTime(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  let m = s.match(/^(\d{1,2}):(\d{2})/);
  if (m) return `${pad2(Number(m[1]))}:${m[2]}`;
  m = s.match(/^(\d{1,2})時(\d{1,2})分?/);
  if (m) return `${pad2(Number(m[1]))}:${pad2(Number(m[2]))}`;
  m = s.match(/^(\d{1,2})時/);
  if (m) return `${pad2(Number(m[1]))}:00`;
  return null;
}

function normalizeCategory(raw: string): string {
  const s = raw.trim();
  if (!s) return "行事";
  if (CATEGORIES.includes(s)) return s;
  for (const c of CATEGORIES) if (s.includes(c)) return c;
  if (/年休|病休|特休|夏特|看護|職専免|振休/.test(s)) return "休暇";
  return "行事";
}

const FIELD_OPTIONS: { value: string; label: string }[] = [
  { value: "ignore", label: "取り込まない" },
  { value: "date", label: "日付" },
  { value: "endDate", label: "終了日" },
  { value: "month", label: "月" },
  { value: "day", label: "日" },
  { value: "category", label: "種別" },
  { value: "title", label: "件名" },
  { value: "startTime", label: "開始時刻" },
  { value: "endTime", label: "終了時刻" },
  { value: "location", label: "場所" },
  { value: "assignees", label: "担当者（休暇は取得者）" },
  { value: "leaveType", label: "休暇分類" },
  { value: "description", label: "メモ・備考" },
];

function guessField(header: string): string {
  const h = header.trim();
  if (/休暇分類|休暇種別/.test(h)) return "leaveType";
  if (/終了日/.test(h)) return "endDate";
  if (/日付|開始日|年月日/.test(h)) return "date";
  if (/^月$/.test(h)) return "month";
  if (/^日$/.test(h)) return "day";
  if (/種別|分類|カテゴリ/.test(h)) return "category";
  if (/開始時刻|開始時間|^開始/.test(h)) return "startTime";
  if (/終了時刻|終了時間|^終了/.test(h)) return "endTime";
  if (/時刻|時間/.test(h)) return "startTime";
  if (/場所|会場/.test(h)) return "location";
  if (/担当|取得者|出張者|氏名/.test(h)) return "assignees";
  if (/メモ|備考|詳細|説明/.test(h)) return "description";
  if (/件名|タイトル|行事名|予定名|内容/.test(h)) return "title";
  return "ignore";
}

// ---------------- ① CSV / spreadsheet import ----------------

const WIDE_CATEGORY_HEADERS: Record<string, string> = {
  "行事等予定": "行事",
  "行事": "行事",
  "会議": "会議",
  "職員動静": "出張",
  "出張": "出張",
  "各種〆切": "〆切",
  "〆切": "〆切",
  "締切": "〆切",
  "休暇予定": "休暇",
  "休暇": "休暇",
  "研修": "研修",
  "その他": "その他",
};

export function ImportSection({ bootstrap }: { bootstrap: Bootstrap }) {
  const qc = useQueryClient();
  const [preset, setPreset] = useState<"standard" | "wide">("standard");
  const [rawText, setRawText] = useState("");
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");

  const parsed = useMemo(() => {
    if (!rawText.trim()) return null;
    const rows = parseDelimited(rawText);
    if (rows.length === 0) return null;
    return { header: rows[0]!, data: rows.slice(1) };
  }, [rawText]);

  const applyText = (text: string) => {
    setRawText(text);
    setResult("");
    const rows = parseDelimited(text);
    const header = rows[0] ?? [];
    const next: Record<number, string> = {};
    header.forEach((h, i) => {
      next[i] = guessField(h);
    });
    setMapping(next);
  };

  const built = useMemo((): { rows: ImportRow[]; titleless: number } => {
    if (!parsed) return { rows: [], titleless: 0 };
    const sy = bootstrap.settings.schoolYear;
    const out: ImportRow[] = [];
    let titleless = 0;
    if (preset === "wide") {
      const monthIdx = parsed.header.findIndex((h) => h.trim() === "月");
      const dayIdx = parsed.header.findIndex((h) => h.trim() === "日");
      const dateIdx = parsed.header.findIndex((h) => /日付|年月日/.test(h));
      const catCols = parsed.header
        .map((h, i) => ({ i, cat: WIDE_CATEGORY_HEADERS[h.trim()] }))
        .filter((c): c is { i: number; cat: string } => c.cat != null);
      for (const r of parsed.data) {
        let date: string | null = null;
        if (monthIdx >= 0 && dayIdx >= 0) {
          const mo = Number((r[monthIdx] ?? "").trim());
          const da = Number((r[dayIdx] ?? "").trim());
          if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) date = schoolYearDate(sy, mo, da);
        } else if (dateIdx >= 0) {
          date = normalizeDate(r[dateIdx] ?? "", sy);
        }
        if (!date) continue;
        for (const c of catCols) {
          const cell = (r[c.i] ?? "").trim();
          if (!cell) continue;
          for (const line of cell.split("\n").map((x) => x.trim()).filter(Boolean)) {
            out.push({
              title: line,
              category: c.cat,
              startsOn: date,
              endsOn: date,
              startsAt: null,
              endsAt: null,
              locationName: null,
              assigneeNames: [],
              leaveType: null,
              description: "",
            });
          }
        }
      }
      return { rows: out, titleless: 0 };
    }
    const colOf = (field: string): number => {
      const e = Object.entries(mapping).find(([, v]) => v === field);
      return e ? Number(e[0]) : -1;
    };
    const get = (r: string[], field: string): string => {
      const i = colOf(field);
      return i >= 0 ? (r[i] ?? "").trim() : "";
    };
    for (const r of parsed.data) {
      const title = get(r, "title");
      if (!title) {
        titleless++;
        continue;
      }
      let date = normalizeDate(get(r, "date"), sy);
      if (!date) {
        const mo = Number(get(r, "month"));
        const da = Number(get(r, "day"));
        if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) date = schoolYearDate(sy, mo, da);
      }
      const category = normalizeCategory(get(r, "category"));
      const leaveRaw = get(r, "leaveType") || (category === "休暇" ? get(r, "category") : "");
      out.push({
        title,
        category,
        // Invalid dates are sent through so the server reports them as skips.
        startsOn: date ?? get(r, "date"),
        endsOn: normalizeDate(get(r, "endDate"), sy),
        startsAt: normalizeTime(get(r, "startTime")),
        endsAt: normalizeTime(get(r, "endTime")),
        locationName: get(r, "location") || null,
        assigneeNames: get(r, "assignees")
          .split(/[、,，/／]/)
          .map((x) => x.trim())
          .filter(Boolean),
        leaveType: category === "休暇" && leaveRaw ? leaveRaw : null,
        description: get(r, "description"),
      });
    }
    return { rows: out, titleless };
  }, [parsed, mapping, preset, bootstrap.settings.schoolYear]);

  const doImport = async () => {
    setBusy(true);
    setResult("");
    try {
      const res = await api.importEvents({ rows: built.rows });
      await qc.invalidateQueries();
      const detail =
        res.errors.length > 0
          ? ` スキップ内訳：${res.errors.slice(0, 5).map((e) => `${e.row}行目「${e.reason}」`).join("、")}${res.errors.length > 5 ? " ほか" : ""}`
          : "";
      setResult(
        `${res.created}件を取り込みました（スキップ${res.skipped + built.titleless}件${built.titleless > 0 ? `、うち件名なし${built.titleless}件は送信前に除外` : ""}）。${detail}`,
      );
    } catch (e) {
      setResult(`取り込みに失敗しました：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="データの取り込み（CSV／スプレッドシート）">
      <p className="mb-2 text-sm text-[var(--dim)]">
        既存の行事予定表から書き出したCSVファイルを選ぶか、スプレッドシートのセル範囲をそのまま貼り付けてください。列の対応付けを確認してから、一括で予定として登録します。担当者名は登録済みの人と一致すればその人に、場所は登録済みの場所と一致すればその場所に結び付きます（一致しない場合は自由文として保持されます）。
      </p>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <label className="text-sm" htmlFor="csv-preset">対応付けプリセット</label>
        <select
          id="csv-preset"
          aria-label="対応付けプリセット"
          className={inputCls}
          value={preset}
          onChange={(e) => setPreset(e.target.value as "standard" | "wide")}
        >
          <option value="standard">標準（1行＝1予定）</option>
          <option value="wide">本校シート形式（行事データ：月・日＋種別ごとの列を展開）</option>
        </select>
        <label className={`${btnCls} cursor-pointer`}>
          CSVファイルを選ぶ
          <input
            type="file"
            accept=".csv,.tsv,.txt"
            className="hidden"
            aria-label="CSVファイルを選ぶ"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void readTextFile(f).then(applyText);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {preset === "wide" && (
        <p className="mb-2 text-xs text-[var(--dim)]">
          本校シート形式では、「月」「日」列（または日付列）と、種別ごとの列（行事等予定／会議／職員動静／各種〆切／休暇予定 など）を使います。各セルの中身が、その種別の予定として1件ずつ登録されます。年度は設定の「年度」を使い、4月〜翌3月で年を決めます。
        </p>
      )}
      <textarea
        aria-label="CSVデータを貼り付け"
        className={`${inputCls} w-full font-mono text-xs`}
        rows={5}
        placeholder={"日付,種別,件名,開始時刻,終了時刻,場所,担当者\n2026-11-10,行事,運動会,09:00,12:00,グラウンド,山田花子"}
        value={rawText}
        onChange={(e) => applyText(e.target.value)}
      />
      {parsed && preset === "standard" && (
        <div className="mt-2">
          <p className="text-xs text-[var(--dim)]">列の対応付け（1行目を見出しとして読みました。違う場合は選び直してください）</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {parsed.header.map((h, i) => (
              <label key={i} className="flex flex-col gap-0.5 text-xs">
                <span className="font-medium">{h || `列${i + 1}`}</span>
                <select
                  aria-label={`列「${h || i + 1}」の対応付け`}
                  className={inputCls}
                  value={mapping[i] ?? "ignore"}
                  onChange={(e) => setMapping({ ...mapping, [i]: e.target.value })}
                >
                  {FIELD_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </div>
      )}
      {parsed && (
        <div className="mt-2">
          <p className="text-sm">
            取り込み候補：<span className="font-medium">{built.rows.length}件</span>
            {built.titleless > 0 && <span className="text-[var(--dim)]">（件名のない行{built.titleless}件は除外）</span>}
          </p>
          <ul className="mt-1 flex flex-col gap-0.5 text-xs text-[var(--dim)]">
            {built.rows.slice(0, 8).map((r, i) => (
              <li key={i}>
                {r.startsOn}／{r.category}／{r.title}
                {r.startsAt ? `／${r.startsAt}〜${r.endsAt ?? ""}` : ""}
                {r.locationName ? `／${r.locationName}` : ""}
                {r.assigneeNames.length > 0 ? `／${r.assigneeNames.join("、")}` : ""}
              </li>
            ))}
            {built.rows.length > 8 && <li>…ほか{built.rows.length - 8}件</li>}
          </ul>
          <button
            type="button"
            className={`${primaryCls} mt-2`}
            disabled={busy || built.rows.length === 0}
            onClick={() => void doImport()}
          >
            {busy ? "取り込み中…" : `${built.rows.length}件を取り込む`}
          </button>
        </div>
      )}
      {result && <p className="mt-2 text-sm" role="status">{result}</p>}
    </Section>
  );
}

// ---------------- ② template export / import ----------------

export function TemplateSection({ bootstrap }: { bootstrap: Bootstrap }) {
  const qc = useQueryClient();
  const [exportText, setExportText] = useState("");
  const [importText, setImportText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const doExport = async () => {
    setBusy(true);
    setMsg("");
    try {
      const res = await api.exportTemplate({});
      setExportText(res.templateJson);
      setMsg(
        `定義を書き出しました（対象軸${bootstrap.targetGroups.length}件・項目${bootstrap.items.length}件・当番${bootstrap.duties.length}件・日課${bootstrap.periodPatterns.length}件・ビュー${bootstrap.views.length}件）。下のJSONを保存して、別の学校・環境で読み込めます。`,
      );
    } catch (e) {
      setMsg(`書き出しに失敗しました：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    const blob = new Blob([exportText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "school-schedule-template.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const doImport = async () => {
    setBusy(true);
    setMsg("");
    try {
      const res = await api.importTemplate({ templateJson: importText });
      await qc.invalidateQueries();
      setMsg(
        `テンプレートを適用しました：対象軸+${res.createdGroups}、項目+${res.createdItems}、当番+${res.createdDuties}、日課+${res.createdPatterns}、ビュー+${res.createdViews}（既存と重なる定義${res.skipped}件はそのまま保持）。予定データには触れていません。`,
      );
    } catch (e) {
      setMsg(`読み込みに失敗しました：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="テンプレートの共有（定義の書き出し／読み込み）">
      <p className="mb-2 text-sm text-[var(--dim)]">
        この学校で作った定義一式（対象軸・項目定義と記号の凡例・当番定義・日課パターン・ビュー定義・休暇分類）をJSONで書き出し、別の学校や別の環境で読み込めます。読み込みでは、すでに同じキー・名前の定義がある場合は上書きせず保持し、足りないものだけ追加します。予定や日ごとの入力データは含まれません。
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primaryCls} disabled={busy} onClick={() => void doExport()}>
          定義をJSONで書き出す
        </button>
        {exportText && (
          <button type="button" className={btnCls} onClick={download}>
            JSONファイルをダウンロード
          </button>
        )}
      </div>
      {exportText && (
        <textarea
          aria-label="書き出したテンプレートJSON"
          className={`${inputCls} mt-2 w-full font-mono text-xs`}
          rows={6}
          readOnly
          value={exportText}
        />
      )}
      <div className="mt-3">
        <label className="text-xs text-[var(--dim)]" htmlFor="tpl-import">テンプレートJSONを読み込む（貼り付け、またはファイル）</label>
        <textarea
          id="tpl-import"
          aria-label="読み込むテンプレートJSON"
          className={`${inputCls} w-full font-mono text-xs`}
          rows={5}
          placeholder='{"format": "school-schedule-template", "version": 1, ...}'
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
        />
        <div className="mt-1 flex flex-wrap gap-2">
          <label className={`${btnCls} cursor-pointer`}>
            JSONファイルを選ぶ
            <input
              type="file"
              accept=".json,application/json"
              className="hidden"
              aria-label="テンプレートJSONファイルを選ぶ"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void readTextFile(f).then(setImportText);
                e.target.value = "";
              }}
            />
          </label>
          <button
            type="button"
            className={primaryCls}
            disabled={busy || importText.trim() === ""}
            onClick={() => void doImport()}
          >
            {busy ? "処理中…" : "テンプレートを適用する"}
          </button>
        </div>
      </div>
      {msg && <p className="mt-2 text-sm" role="status">{msg}</p>}
    </Section>
  );
}

// ---------------- ③ link mode + name matching ----------------

type LinkKind = "people" | "grade" | "period";

export function LinkSection({ bootstrap }: { bootstrap: Bootstrap }) {
  const qc = useQueryClient();
  const s = bootstrap.settings;
  const [mode, setMode] = useState(s.linkMode);
  const [peopleSource, setPeopleSource] = useState(s.peopleSource);
  const [targetsSource, setTargetsSource] = useState(s.targetsSource);
  const [periodsSource, setPeriodsSource] = useState(s.periodsSource);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const timetableEnt = governingEntitlement(bootstrap, "timetable");
  const timetableUsable = entitlementUsable(timetableEnt);

  // name-matching draft rows, keyed `${kind}:${localKey}`
  const [drafts, setDrafts] = useState<Record<string, { linkedName: string; linkedId: string; status: string }>>(() => {
    const init: Record<string, { linkedName: string; linkedId: string; status: string }> = {};
    for (const l of bootstrap.masterLinks) {
      init[`${l.kind}:${l.localKey}`] = { linkedName: l.linkedName, linkedId: l.linkedId, status: l.status };
    }
    return init;
  });
  const draftOf = (kind: string, key: string) =>
    drafts[`${kind}:${key}`] ?? { linkedName: "", linkedId: "", status: "unmatched" };
  const setDraft = (kind: string, key: string, patch: Partial<{ linkedName: string; linkedId: string; status: string }>) =>
    setDrafts((prev) => ({ ...prev, [`${kind}:${key}`]: { ...draftOf(kind, key), ...patch } }));

  const gradeGroup =
    bootstrap.targetGroups.find((g) => g.key === "grade") ?? bootstrap.targetGroups[0] ?? null;
  const kindGroups: { kind: LinkKind; label: string; entries: { key: string; name: string }[] }[] = [
    {
      kind: "people",
      label: "教職員",
      entries: bootstrap.people.map((p) => ({ key: String(p.id), name: p.name })),
    },
    {
      kind: "grade",
      label: gradeGroup ? `${gradeGroup.name}（対象軸）` : "対象軸",
      entries: (gradeGroup?.targets ?? []).map((t) => ({ key: String(t.id), name: t.name })),
    },
    {
      kind: "period",
      label: "時限・日課パターン",
      entries: bootstrap.periodPatterns.map((p) => ({ key: String(p.id), name: `${p.code} ${p.name}` })),
    },
  ];

  const saveSettings = async () => {
    setBusy(true);
    setMsg("");
    try {
      await api.saveLinkSettings({
        linkMode: mode as "standalone" | "linked",
        peopleSource: peopleSource as "local" | "linked",
        targetsSource: targetsSource as "local" | "linked",
        periodsSource: periodsSource as "local" | "linked",
      });
      await qc.invalidateQueries();
      setMsg("連携設定を保存しました。");
    } catch (e) {
      setMsg(`保存に失敗しました：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const saveLink = async (kind: LinkKind, entry: { key: string; name: string }) => {
    const d = draftOf(kind, entry.key);
    setBusy(true);
    try {
      await api.upsertMasterLink({
        kind,
        localKey: entry.key,
        localName: entry.name,
        linkedName: d.linkedName.trim(),
        linkedId: d.linkedId.trim(),
        status: d.status as "matched" | "local_only" | "unmatched",
      });
      await qc.invalidateQueries();
      setMsg(`「${entry.name}」の対応付けを保存しました。`);
    } catch (e) {
      setMsg(`対応付けの保存に失敗しました：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const sourceSelect = (
    label: string,
    value: string,
    set: (v: string) => void,
    ariaLabel: string,
  ) => (
    <label className="flex items-center gap-2 text-sm">
      <span className="w-28">{label}</span>
      <select aria-label={ariaLabel} className={inputCls} value={value} onChange={(e) => set(e.target.value)}>
        <option value="local">自前（このアプリで保持）</option>
        <option value="linked">参照（school-timetable）</option>
      </select>
      <span className="text-xs text-[var(--dim)]">
        現在：{value === "linked" ? "参照" : "自前"}
      </span>
    </label>
  );

  return (
    <Section title="school-timetable連携">
      <div className="mb-2 rounded border border-[var(--border)] bg-[var(--bg)] p-2 text-sm">
        <p>
          この試作では、<span className="font-medium">実際の連携・SSOは行いません</span>。連携モードの切替、マスタの出所の表示、連携開始時の名寄せ（対応付けの記録）までを、画面と保存データの形として用意しています。実連携は製品側の開発範囲です。
        </p>
        <p className="mt-1 text-xs text-[var(--dim)]">
          時間割（school-timetable）の利用権限：{timetableEnt ? `${PLAN_LABELS[timetableEnt.plan] ?? timetableEnt.plan}／${ENT_STATUS_LABELS[timetableEnt.status] ?? timetableEnt.status}` : "未登録（連携モードは使えません）"}
          {!timetableUsable && " ― 連携モードに切り替えるには、下の「利用権限（entitlement）」で時間割を有効にしてください。"}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="連携モード">
          <span className="w-28 text-sm">モード</span>
          <button
            type="button"
            aria-pressed={mode === "standalone"}
            className={`rounded px-3 py-1.5 text-sm ${mode === "standalone" ? "bg-[var(--accent)] font-medium text-white" : "border border-[var(--border)]"}`}
            onClick={() => setMode("standalone")}
          >
            単独モード
          </button>
          <button
            type="button"
            aria-pressed={mode === "linked"}
            disabled={!timetableUsable}
            title={!timetableUsable ? "時間割の利用権限が有効でないため選べません" : undefined}
            className={`rounded px-3 py-1.5 text-sm disabled:opacity-40 ${mode === "linked" ? "bg-[var(--accent)] font-medium text-white" : "border border-[var(--border)]"}`}
            onClick={() => setMode("linked")}
          >
            連携モード
          </button>
          <span className="text-xs text-[var(--dim)]">
            {mode === "linked" ? "連携モード（試作：実連携は行っていません）" : "単独モード：このアプリだけで完結します"}
          </span>
        </div>
        {sourceSelect("教職員マスタ", peopleSource, setPeopleSource, "教職員マスタの出所")}
        {sourceSelect("学年・対象軸", targetsSource, setTargetsSource, "学年・対象軸の出所")}
        {sourceSelect("時限・日課", periodsSource, setPeriodsSource, "時限・日課の出所")}
        <div>
          <button type="button" className={primaryCls} disabled={busy} onClick={() => void saveSettings()}>
            連携設定を保存
          </button>
        </div>
      </div>

      <h4 className="mt-4 mb-1 font-medium">名寄せ（連携開始時の対応付け）</h4>
      <p className="mb-2 text-sm text-[var(--dim)]">
        自前マスタの各項目について、連携先での名称・IDを記録します。「対応付け済み」にした項目が、連携時に同一のものとして扱われる想定です。連携先の実データは取得しないため、名称・IDは手入力です。
      </p>
      {kindGroups.map((g) => {
        const matched = g.entries.filter((e) => draftOf(g.kind, e.key).status === "matched").length;
        return (
          <div key={g.kind} className="mb-3">
            <p className="text-sm font-medium">
              {g.label}
              <span className="ml-2 text-xs font-normal text-[var(--dim)]">
                対応付け済み {matched}／{g.entries.length}件
              </span>
            </p>
            {g.entries.length === 0 ? (
              <p className="text-xs text-[var(--dim)]">登録がありません。先にマスタを登録してください。</p>
            ) : (
              <ul className="mt-1 flex flex-col gap-1">
                {g.entries.map((e) => {
                  const d = draftOf(g.kind, e.key);
                  const saved = bootstrap.masterLinks.find((l) => l.kind === g.kind && l.localKey === e.key);
                  return (
                    <li key={e.key} className="flex flex-wrap items-center gap-1 text-sm">
                      <span className="w-28 shrink-0">{e.name}</span>
                      <input
                        aria-label={`${e.name}の連携先名称`}
                        className={`${inputCls} w-40`}
                        placeholder="連携先での名称"
                        value={d.linkedName}
                        onChange={(ev) => setDraft(g.kind, e.key, { linkedName: ev.target.value })}
                      />
                      <input
                        aria-label={`${e.name}の連携先ID`}
                        className={`${inputCls} w-28`}
                        placeholder="連携先ID（任意）"
                        value={d.linkedId}
                        onChange={(ev) => setDraft(g.kind, e.key, { linkedId: ev.target.value })}
                      />
                      <select
                        aria-label={`${e.name}の対応付け状態`}
                        className={inputCls}
                        value={d.status}
                        onChange={(ev) => setDraft(g.kind, e.key, { status: ev.target.value })}
                      >
                        <option value="matched">対応付け済み</option>
                        <option value="local_only">自前のみ（連携先に無い）</option>
                        <option value="unmatched">未対応</option>
                      </select>
                      <button
                        type="button"
                        className={btnCls}
                        disabled={busy}
                        onClick={() => void saveLink(g.kind, e)}
                      >
                        保存
                      </button>
                      {saved && (
                        <button
                          type="button"
                          aria-label={`${e.name}の対応付けを削除`}
                          className="text-[#b91c1c]"
                          onClick={() => {
                            void api.deleteMasterLink({ id: saved.id }).then(() => qc.invalidateQueries());
                          }}
                        >
                          削除
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
      {msg && <p className="mt-1 text-sm" role="status">{msg}</p>}
    </Section>
  );
}

// ---------------- ④ entitlements ----------------

export function EntitlementSection({ bootstrap }: { bootstrap: Bootstrap }) {
  const qc = useQueryClient();
  const [editId, setEditId] = useState<number | null>(null);
  const [schoolName, setSchoolName] = useState(bootstrap.settings.schoolName);
  const [product, setProduct] = useState("event_schedule");
  const [plan, setPlan] = useState("standard");
  const [status, setStatus] = useState("active");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const govSchedule = governingEntitlement(bootstrap, "event_schedule");
  const govTimetable = governingEntitlement(bootstrap, "timetable");
  const govLabel = (p: string, e: typeof govSchedule) =>
    e
      ? `${PRODUCT_LABELS[p]}：${PLAN_LABELS[e.plan] ?? e.plan}／${ENT_STATUS_LABELS[e.status] ?? e.status}${entitlementUsable(e) ? "（利用可）" : "（利用不可）"}`
      : `${PRODUCT_LABELS[p]}：未登録（利用可として扱います）`;

  const resetForm = () => {
    setEditId(null);
    setSchoolName(bootstrap.settings.schoolName);
    setProduct("event_schedule");
    setPlan("standard");
    setStatus("active");
    setStartsOn("");
    setEndsOn("");
    setNote("");
  };

  const save = async () => {
    setBusy(true);
    setMsg("");
    try {
      await api.upsertEntitlement({
        id: editId,
        schoolName: schoolName.trim(),
        product: product as "event_schedule" | "timetable",
        plan,
        status: status as "active" | "trial" | "suspended" | "none",
        startsOn: startsOn || null,
        endsOn: endsOn || null,
        note: note.trim(),
        sort: bootstrap.entitlements.length,
      });
      await qc.invalidateQueries();
      setMsg("利用権限を保存しました。");
      resetForm();
    } catch (e) {
      setMsg(`保存に失敗しました：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="利用権限（entitlement）">
      <p className="mb-2 text-sm text-[var(--dim)]">
        学校×製品（行事予定／時間割）×プラン×状態を管理します。課金処理そのものは行いません。行事予定がこの学校で「停止」または「未契約」になると、予定表は閲覧のみになります。時間割が有効でない学校は、連携モードに切り替えられません。片方の停止が、もう片方のデータに影響することはありません。
      </p>
      <div className="mb-2 rounded border border-[var(--border)] bg-[var(--bg)] p-2 text-sm">
        <p className="font-medium">この学校（{bootstrap.settings.schoolName || "学校名未設定"}）の現在の判定</p>
        <p>{govLabel("event_schedule", govSchedule)}</p>
        <p>{govLabel("timetable", govTimetable)}</p>
      </div>
      <ul className="mb-2 flex flex-col gap-1 text-sm">
        {bootstrap.entitlements.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="font-medium underline"
              onClick={() => {
                setEditId(e.id);
                setSchoolName(e.schoolName);
                setProduct(e.product);
                setPlan(e.plan);
                setStatus(e.status);
                setStartsOn(e.startsOn ?? "");
                setEndsOn(e.endsOn ?? "");
                setNote(e.note);
              }}
            >
              {e.schoolName || "（学校名なし＝この学校）"}
            </button>
            <span>
              {PRODUCT_LABELS[e.product] ?? e.product}／{PLAN_LABELS[e.plan] ?? e.plan}／
              <span className={e.status === "suspended" || e.status === "none" ? "font-medium text-[#b91c1c]" : ""}>
                {ENT_STATUS_LABELS[e.status] ?? e.status}
              </span>
            </span>
            {(e.startsOn || e.endsOn) && (
              <span className="text-xs text-[var(--dim)]">{e.startsOn ?? "…"}〜{e.endsOn ?? "…"}</span>
            )}
            {e.note && <span className="text-[var(--dim)]">{e.note}</span>}
            <button
              type="button"
              aria-label={`${PRODUCT_LABELS[e.product] ?? e.product}の利用権限を削除`}
              className="text-[#b91c1c]"
              onClick={() => {
                void api.deleteEntitlement({ id: e.id }).then(() => qc.invalidateQueries());
              }}
            >
              削除
            </button>
          </li>
        ))}
        {bootstrap.entitlements.length === 0 && (
          <li className="text-[var(--dim)]">まだ登録がありません（未登録の製品は利用可として扱われます）。</li>
        )}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="text-xs text-[var(--dim)]" htmlFor="ent-school">学校名</label>
          <input
            id="ent-school"
            className={`${inputCls} block w-48`}
            placeholder="学校名（この学校の判定に使います）"
            value={schoolName}
            onChange={(e) => setSchoolName(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs text-[var(--dim)]" htmlFor="ent-product">製品</label>
          <select id="ent-product" aria-label="製品" className={`${inputCls} block`} value={product} onChange={(e) => setProduct(e.target.value)}>
            <option value="event_schedule">行事予定</option>
            <option value="timetable">時間割（school-timetable）</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-[var(--dim)]" htmlFor="ent-plan">プラン</label>
          <select id="ent-plan" aria-label="プラン" className={`${inputCls} block`} value={plan} onChange={(e) => setPlan(e.target.value)}>
            <option value="free">フリー</option>
            <option value="standard">スタンダード</option>
            <option value="pro">プロ</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-[var(--dim)]" htmlFor="ent-status">状態</label>
          <select id="ent-status" aria-label="状態" className={`${inputCls} block`} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">有効</option>
            <option value="trial">体験中</option>
            <option value="suspended">停止</option>
            <option value="none">未契約</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-[var(--dim)]" htmlFor="ent-from">開始日（任意）</label>
          <input id="ent-from" type="date" className={`${inputCls} block`} value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-[var(--dim)]" htmlFor="ent-to">終了日（任意）</label>
          <input id="ent-to" type="date" className={`${inputCls} block`} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-[var(--dim)]" htmlFor="ent-note">メモ</label>
          <input id="ent-note" className={`${inputCls} block w-40`} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <button type="button" className={primaryCls} disabled={busy} onClick={() => void save()}>
          {editId != null ? "利用権限を更新" : "利用権限を追加"}
        </button>
        {editId != null && (
          <button type="button" className={btnCls} onClick={resetForm}>
            新規入力に戻す
          </button>
        )}
      </div>
      {msg && <p className="mt-1 text-sm" role="status">{msg}</p>}
    </Section>
  );
}
