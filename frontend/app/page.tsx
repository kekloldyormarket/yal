"use client";

import { useEffect, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";

const RPC = process.env.NEXT_PUBLIC_RPC ||
  "https://rpc.ironforge.network/mainnet?apiKey=01KSG5964GKG2V5B0CZDX3X3WY";
const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_YAL_PROGRAM_ID || "9zMMi7n47W9NK1aokyNZSaSqExz2n9nyASJNpE9eNDKL",
);

interface YalToken {
  pubkey: string;
  memeMint: string;
  totalSupply: string;
  circulatingSupply: string;
  treasuryStacsol: string;
  graduatedAt: number;
  bondedSolLamports: string;
}

export default function Home() {
  const [tokens, setTokens] = useState<YalToken[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const conn = new Connection(RPC, "confirmed");
    (async () => {
      const accounts = await conn.getProgramAccounts(PROGRAM_ID, {
        filters: [{ dataSize: 153 }],
      });
      const parsed = accounts.map(({ pubkey, account }) => {
        const d = account.data;
        let off = 8;
        const memeMint = new PublicKey(d.subarray(off, off + 32)); off += 32;
        off += 32; // authority
        const totalSupply = d.readBigUInt64LE(off).toString(); off += 8;
        const circulatingSupply = d.readBigUInt64LE(off).toString(); off += 8;
        const treasuryStacsol = d.readBigUInt64LE(off).toString(); off += 8;
        off += 8 + 32; // treasury_sol_lamports + treasury_token_account
        const graduatedAt = Number(d.readBigInt64LE(off)); off += 8;
        off += 8; // last_liquidation_ts
        const bondedSolLamports = d.readBigUInt64LE(off).toString();
        return {
          pubkey: pubkey.toBase58(),
          memeMint: memeMint.toBase58(),
          totalSupply,
          circulatingSupply,
          treasuryStacsol,
          graduatedAt,
          bondedSolLamports,
        };
      });
      setTokens(parsed);
      setLoading(false);
    })().catch(console.error);
  }, []);

  return (
    <main style={{ fontFamily: "monospace", padding: 32, color: "#e7e7e7", background: "#0a0a0a", minHeight: "100vh" }}>
      <h1 style={{ fontSize: 36, marginBottom: 8 }}>yal.fun</h1>
      <p style={{ opacity: 0.6, marginBottom: 32 }}>
        Yet Another Launchpad. Every meme graduates into stacSOL.
      </p>

      <section style={{ marginBottom: 32 }}>
        <button
          style={{
            background: "#fff",
            color: "#000",
            padding: "12px 24px",
            border: 0,
            fontWeight: 700,
            fontSize: 16,
            cursor: "pointer",
          }}
        >
          launch a meme (WIP)
        </button>
      </section>

      <section>
        <h2 style={{ fontSize: 24, marginBottom: 16 }}>active tokens</h2>
        {loading ? (
          <p>loading...</p>
        ) : tokens.length === 0 ? (
          <p style={{ opacity: 0.5 }}>no tokens yet. be first.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ opacity: 0.5, fontSize: 12, textAlign: "left" }}>
                <th>mint</th>
                <th>circulating</th>
                <th>treasury stacSOL</th>
                <th>bonded SOL</th>
                <th>status</th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.pubkey} style={{ borderTop: "1px solid #222" }}>
                  <td style={{ padding: "12px 0" }}>
                    {t.memeMint.slice(0, 6)}…{t.memeMint.slice(-4)}
                  </td>
                  <td>{(BigInt(t.circulatingSupply) / 1_000_000n).toString()}M</td>
                  <td>{(BigInt(t.treasuryStacsol) / 1_000_000_000n).toString()}</td>
                  <td>{(BigInt(t.bondedSolLamports) / 1_000_000_000n).toString()}</td>
                  <td>{t.graduatedAt > 0 ? "graduated" : "bonding"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <footer style={{ marginTop: 64, opacity: 0.4, fontSize: 12 }}>
        program: 9zMMi7n47W9NK1aokyNZSaSqExz2n9nyASJNpE9eNDKL
        <br />
        stacsol pool: E6oqvrLKexQwFJyCnQ8ewx8xt9tQo7uezat24f5Qixqb
        <br />
        every meme that bonds → stacSOL backing forever ↗
      </footer>
    </main>
  );
}
