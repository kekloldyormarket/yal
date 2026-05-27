// Display formatters — port of mock utils.js fmt object.

export const fmt = {
  sol(n: number | undefined | null, decimals = 2): string {
    if (n === undefined || n === null || isNaN(n)) return "—";
    if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(2) + "K";
    return n.toFixed(decimals);
  },
  num(n: number | undefined | null, decimals = 0): string {
    if (n === undefined || n === null || isNaN(n)) return "—";
    return Number(n).toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  },
  pct(n: number | undefined | null, decimals = 1): string {
    if (n === undefined || n === null || isNaN(n)) return "—";
    return (n * 100).toFixed(decimals) + "%";
  },
  short(addr: string | undefined | null, head = 4, tail = 4): string {
    if (!addr) return "—";
    return addr.slice(0, head) + "…" + addr.slice(-tail);
  },
  ago(seconds: number | undefined | null): string {
    if (!seconds && seconds !== 0) return "—";
    const s = Math.max(0, Math.floor(seconds));
    if (s < 60) return s + "s";
    const m = Math.floor(s / 60);
    if (m < 60) return m + "m";
    const h = Math.floor(m / 60);
    if (h < 24) return h + "h";
    const d = Math.floor(h / 24);
    return d + "d";
  },
  agoTs(ts: number | undefined | null): string {
    if (!ts) return "—";
    return fmt.ago(Math.floor(Date.now() / 1000) - ts);
  },
  lamports(l: bigint | number | undefined | null): number {
    if (l === undefined || l === null) return 0;
    return Number(l) / 1e9;
  },
  /** Plain decimal — no scientific notation, even for tiny numbers. Useful
   *  for floor / sol-per-meme displays where 7.409e-10 reads as cryptic. */
  dec(n: number | undefined | null, sigFigs = 4): string {
    if (n === undefined || n === null || !isFinite(n)) return "—";
    if (n === 0) return "0";
    const abs = Math.abs(n);
    if (abs >= 1) return n.toFixed(Math.max(0, sigFigs));
    const exp = Math.floor(Math.log10(abs));
    const decimals = Math.max(sigFigs, -exp + sigFigs - 1);
    return n.toFixed(decimals);
  },
};

/** Token-2022 transfer fee on stacSOL — 6.9% (690 bps). Applied on every
 *  in/out movement of the LST. When redeeming, the user's net receive is
 *  computed_amount × (1 - 0.069). */
export const STACSOL_TRANSFER_FEE_BPS = 690;
export const STACSOL_NET_FACTOR = 1 - STACSOL_TRANSFER_FEE_BPS / 10_000;
