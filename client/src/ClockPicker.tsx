import { useState } from "react";

// Android-style analog clock dial: pick hour (with AM/PM), then minute in
// 5-minute steps. Direct text entry is always available next to the dial.
export function ClockPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string; // "HH:MM" or ""
  onChange: (v: string) => void;
}) {
  const [mode, setMode] = useState<"hour" | "minute">("hour");
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);

  const [hhStr = "", mmStr = ""] = value.split(":");
  const hh = hhStr === "" ? null : Number(hhStr);
  const mm = mmStr === "" ? 0 : Number(mmStr);
  const isPm = hh != null && hh >= 12;
  const hour12 = hh == null ? null : hh % 12 === 0 ? 12 : hh % 12;

  const setHour12 = (h12: number, pm: boolean) => {
    let h = h12 % 12;
    if (pm) h += 12;
    onChange(`${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`);
    setMode("minute");
  };
  const setMinute = (m: number) => {
    const h = hh ?? 0;
    onChange(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  };

  const commitText = (raw: string) => {
    const m = raw.trim().match(/^(\d{1,2})[:：](\d{1,2})$/);
    if (m) {
      const h = Math.min(23, Number(m[1]));
      const min = Math.min(59, Number(m[2]));
      onChange(
        `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`,
      );
    } else if (raw.trim() === "") {
      onChange("");
    }
    setText(null);
  };

  const positions = (count: number) =>
    Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
      const r = 62;
      return {
        x: 90 + r * Math.cos(angle),
        y: 90 + r * Math.sin(angle),
      };
    });

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-[var(--dim)]">{label}</span>
      <div className="flex items-center gap-2">
        <input
          aria-label={`${label}（直接入力）`}
          className="w-24 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
          placeholder="13:30"
          value={text ?? value}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commitText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitText((e.target as HTMLInputElement).value);
          }}
        />
        <button
          type="button"
          aria-label={`${label}を時計盤で選ぶ`}
          className="rounded border border-[var(--border)] px-2 py-1.5 text-sm"
          onClick={() => setOpen((v) => !v)}
        >
          時計盤
        </button>
        {value !== "" && (
          <button
            type="button"
            aria-label={`${label}をクリア`}
            className="text-xs text-[var(--dim)] underline"
            onClick={() => onChange("")}
          >
            クリア
          </button>
        )}
      </div>
      {open && (
        <div className="mt-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2">
          <div className="mb-1 flex items-center justify-center gap-2 text-sm">
            <button
              type="button"
              aria-label="午前"
              className={`rounded px-2 py-0.5 ${!isPm ? "bg-[var(--accent)] text-white" : "border border-[var(--border)]"}`}
              onClick={() => {
                if (hh != null && isPm) {
                  onChange(
                    `${String(hh - 12).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
                  );
                }
              }}
            >
              午前
            </button>
            <span className="font-medium tabular-nums">
              {value === "" ? "--:--" : value}
            </span>
            <button
              type="button"
              aria-label="午後"
              className={`rounded px-2 py-0.5 ${isPm ? "bg-[var(--accent)] text-white" : "border border-[var(--border)]"}`}
              onClick={() => {
                if (hh != null && !isPm) {
                  onChange(
                    `${String(hh + 12).padStart(2, "0")}:${String(mm).padStart(2, "0")}`,
                  );
                }
              }}
            >
              午後
            </button>
          </div>
          <div
            className="relative mx-auto"
            style={{ width: 180, height: 180 }}
            role="group"
            aria-label={mode === "hour" ? "時を選ぶ" : "分を選ぶ"}
          >
            <div className="absolute inset-0 rounded-full border border-[var(--border)] bg-[var(--bg)]" />
            {mode === "hour"
              ? positions(12).map((p, i) => {
                  const h12 = i === 0 ? 12 : i;
                  const selected = hour12 === h12;
                  return (
                    <button
                      key={h12}
                      type="button"
                      aria-label={`${h12}時`}
                      className={`absolute flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-sm ${selected ? "bg-[var(--accent)] font-bold text-white" : ""}`}
                      style={{ left: p.x, top: p.y }}
                      onClick={() => setHour12(h12, isPm)}
                    >
                      {h12}
                    </button>
                  );
                })
              : positions(12).map((p, i) => {
                  const m = i * 5;
                  const selected = mm === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      aria-label={`${m}分`}
                      className={`absolute flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-sm ${selected ? "bg-[var(--accent)] font-bold text-white" : ""}`}
                      style={{ left: p.x, top: p.y }}
                      onClick={() => setMinute(m)}
                    >
                      {String(m).padStart(2, "0")}
                    </button>
                  );
                })}
          </div>
          <div className="mt-1 flex justify-center gap-2 text-xs">
            <button
              type="button"
              className={`rounded px-2 py-1 ${mode === "hour" ? "bg-[var(--border)]" : ""}`}
              onClick={() => setMode("hour")}
            >
              時
            </button>
            <button
              type="button"
              className={`rounded px-2 py-1 ${mode === "minute" ? "bg-[var(--border)]" : ""}`}
              onClick={() => setMode("minute")}
            >
              分（5分刻み）
            </button>
            <button
              type="button"
              className="rounded px-2 py-1 underline"
              onClick={() => setOpen(false)}
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
