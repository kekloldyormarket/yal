// View-model types shared by pages. The on-chain YalToken from @yal/sdk
// uses bigint for u64 fields; the UI prefers plain numbers (SOL-scaled) so
// the chart libs, table sorts and Math.* helpers behave normally.

export interface UiToken {
  mint: string;
  pubkey: string;
  ticker: string;
  name: string;
  desc: string;
  img: string | null;
  authority: string;
  treasury_ata: string;

  // u64 fields decoded into number form (small enough — supply is 1B, SOL <100k)
  total_supply: number;
  circulating_supply: number;
  treasury_stacsol: number;        // u64 stacSOL lamports → divided by 1e9
  treasury_sol_lamports: number;   // raw lamports
  bonded_sol_lamports: number;     // raw lamports
  bonded_sol: number;              // SOL-scaled
  redeemed_meme: number;           // total_supply - circulating_supply

  graduated_at: number;            // unix seconds, 0 if not graduated
  last_liquidation_ts: number;
  created_at: number;              // approximation via slot/time heuristic, 0 if unknown

  status: "bonding" | "graduated";
  progress: number;                // 0..1 — bonded/80 for bonding tokens

  /** Meteora DBC config pubkey this pool was launched against. Used to mark
   *  legacy tokens that have less LP drainable into stacSOL. */
  pool_config?: string;
}

export interface SystemStats {
  total_tokens: number;
  total_graduated: number;
  total_bonded_sol: number;
  total_stacsol: number;
  total_backing_sol: number;
  total_redeemed: number;
}

export interface MockWallet {
  addr: string;
  balance_sol: number;
  holdings: Record<string, number>;
}

export interface Toast {
  id: string;
  title: string;
  sub?: string;
  kind?: "danger";
}
