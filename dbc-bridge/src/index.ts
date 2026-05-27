// YAL ↔ Meteora DBC Bridge
//
// Monitors Meteora DBC pools whose migrator is set to the YAL router. On
// graduation transition (bonding curve fills → DAMM v2 LP minted), this
// daemon takes ownership of the LP position on behalf of the matching
// yal_token PDA so the daily liquidator can later withdraw + swap +
// deposit_to_stacsol against it.
//
// This is the scaffolded version. The actual Meteora DBC SDK calls
// (fetchPoolState, decodeMigrationStatus, claimLpPosition) are marked TODO
// — those need the real `@meteora-ag/dynamic-bonding-curve` package which
// I haven't pulled in here yet. The shell loop, RPC plumbing, and YAL
// account model are correct.
//
// Run mode:
//   bun run src/index.ts             # daemon — polls every 30s
//   bun run src/index.ts --once      # single pass, exit

import {
  Connection,
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import * as fs from "node:fs";

const RPC = process.env.RPC_URL ||
  "https://rpc.ironforge.network/mainnet?apiKey=01KSG5964GKG2V5B0CZDX3X3WY";
const KEYPAIR_PATH = process.env.YAL_BRIDGE_KEYPAIR ||
  `${process.env.HOME}/.config/solana/id.json`;
const YAL_PROGRAM = new PublicKey(
  process.env.YAL_PROGRAM_ID || "9zMMi7n47W9NK1aokyNZSaSqExz2n9nyASJNpE9eNDKL",
);

// Meteora DBC program ID — replace with the actual mainnet program once the
// integration is fully scoped against the real Meteora SDK.
const METEORA_DBC_PROGRAM = new PublicKey(
  process.env.METEORA_DBC_PROGRAM ||
    "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN", // Meteora DBC mainnet
);

const SLEEP_MS = 30_000;
const ARGV_ONCE = process.argv.includes("--once");

function loadKey(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path, "utf8"))));
}

interface YalToken {
  pubkey: PublicKey;
  memeMint: PublicKey;
  graduatedAt: bigint;
  bondedSolLamports: bigint;
}

async function fetchAllYalTokens(conn: Connection): Promise<YalToken[]> {
  const accounts = await conn.getProgramAccounts(YAL_PROGRAM, {
    filters: [{ dataSize: 153 }],
  });
  return accounts.map(({ pubkey, account }) => {
    const d = account.data;
    let off = 8; // discriminator
    const memeMint = new PublicKey(d.subarray(off, off + 32)); off += 32;
    off += 32 + 8 + 8 + 8 + 8 + 32; // authority + supplies + treasury_stacsol + sol + token_acct
    const graduatedAt = d.readBigInt64LE(off); off += 8;
    off += 8; // last_liquidation_ts
    const bondedSolLamports = d.readBigUInt64LE(off);
    return { pubkey, memeMint, graduatedAt, bondedSolLamports };
  });
}

// Stub — real impl reads the Meteora DBC pool account, decodes the bonding
// state, and detects the transition from `bonding` to `migrated`. Then
// returns the LP position pubkey so we can hand it to the YAL treasury.
async function checkDbcGraduation(
  _conn: Connection,
  _memeMint: PublicKey,
): Promise<{ migrated: boolean; lpPosition?: PublicKey; lockedSol?: bigint }> {
  // TODO: implement against @meteora-ag/dynamic-bonding-curve
  //   1. Derive DBC pool PDA from meme mint + Meteora config seed
  //   2. getAccountInfo(pool)
  //   3. Decode state via Meteora's borsh layout — look for migration_state field
  //   4. If migrated: derive DAMM v2 position pubkey + read locked SOL
  return { migrated: false };
}

// Stub — real impl builds an ix that claims the DAMM v2 position into the
// yal_token treasury PDA, then calls fund_treasury(locked_sol). This needs
// the YAL router to expose a `claim_dbc_migration(pool, position)` ix that
// validates the source pool was indeed a YAL-configured DBC pool.
async function claimMigrationForYal(
  _conn: Connection,
  _payer: Keypair,
  _yalToken: PublicKey,
  _memeMint: PublicKey,
  _lpPosition: PublicKey,
): Promise<string | null> {
  // TODO:
  //   1. Build claim_dbc_migration ix on YAL router
  //      - signer: any (permissionless to encourage shadow claimers)
  //      - reads: meme_mint, dbc_pool, dbc_config, lp_position
  //      - writes: yal_token (graduated_at = now, bonded_sol_lamports = locked_sol),
  //               yal_token treasury (receives SOL + LP position transfer)
  //   2. Sign + submit + confirm
  return null;
}

async function cycle(conn: Connection, payer: Keypair) {
  const ts = new Date().toISOString().slice(11, 19);
  const tokens = await fetchAllYalTokens(conn);
  const pending = tokens.filter((t) => t.graduatedAt === 0n);
  console.log(
    `[${ts}] tracking ${tokens.length} YAL tokens · ${pending.length} pre-graduation`,
  );

  for (const t of pending) {
    const state = await checkDbcGraduation(conn, t.memeMint);
    if (!state.migrated || !state.lpPosition) continue;
    console.log(
      `[${ts}] graduation detected: ${t.memeMint.toBase58()} · ${
        state.lockedSol ? Number(state.lockedSol) / 1e9 : "?"
      } SOL in DAMM`,
    );
    try {
      const sig = await claimMigrationForYal(
        conn,
        payer,
        t.pubkey,
        t.memeMint,
        state.lpPosition,
      );
      if (sig) {
        console.log(`[${ts}] CLAIMED ${t.memeMint.toBase58()}  sig=${sig}`);
      }
    } catch (err: any) {
      console.warn(
        `[${ts}] claim failed for ${t.memeMint.toBase58()}: ${err.message?.slice(0, 200)}`,
      );
    }
  }
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const payer = loadKey(KEYPAIR_PATH);
  console.log(
    `yal-dbc-bridge: payer=${payer.publicKey.toBase58()} yal=${YAL_PROGRAM.toBase58()} dbc=${METEORA_DBC_PROGRAM.toBase58()}`,
  );

  if (ARGV_ONCE) {
    await cycle(conn, payer);
    return;
  }
  while (true) {
    try {
      await cycle(conn, payer);
    } catch (err: any) {
      console.error(`cycle error: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, SLEEP_MS));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
