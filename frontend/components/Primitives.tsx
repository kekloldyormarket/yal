"use client";

// Shared visual primitives used across pages — Stat, TokenAvatar, SortBtn.

export function Stat({
  k,
  v,
  sub,
  accent,
}: {
  k: string;
  v: React.ReactNode;
  sub?: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className={"stat" + (accent ? " accent" : "")}>
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {sub && <div className="delta">{sub}</div>}
    </div>
  );
}

export function TokenAvatar({
  ticker,
  size = "",
}: {
  ticker: string;
  size?: "" | "lg" | "xl";
}) {
  const cls = "avatar" + (size ? " " + size : "");
  return <span className={cls}>{(ticker || "?").slice(0, 2)}</span>;
}

export function SortBtn<T extends string>({
  val,
  sort,
  setSort,
  label,
}: {
  val: T;
  sort: T;
  setSort: (v: T) => void;
  label: string;
}) {
  const active = sort === val;
  return (
    <span
      onClick={() => setSort(val)}
      style={{
        cursor: "pointer",
        color: active ? "var(--accent)" : "var(--text-2)",
        borderBottom: active
          ? "1px solid var(--accent)"
          : "1px solid transparent",
        paddingBottom: 2,
      }}
    >
      {label}
    </span>
  );
}
