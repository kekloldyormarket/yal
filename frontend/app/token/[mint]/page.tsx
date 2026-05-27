// Server component wrapper for the token detail page.
// Owns generateMetadata so Telegram / X / iMessage / Discord previews get the
// per-token name, description, and image — not the generic site card.
//
// All interactive UI lives in TokenPageClient (use client).

import type { Metadata } from "next";
import { Connection, PublicKey } from "@solana/web3.js";
import { getTokenMetadata } from "@solana/spl-token";
import { RPC } from "@/lib/yal-client";
import { TOKEN_2022_PROGRAM } from "@/lib/sdk";
import TokenPageClient from "./TokenPageClient";

interface TokenJson {
  name?: string;
  symbol?: string;
  description?: string;
  image?: string;
}

async function fetchOgMeta(mint: string): Promise<{
  title: string;
  description: string;
  image: string | null;
}> {
  const fallback = {
    title: `$${mint.slice(0, 6).toUpperCase()} — yal.fun`,
    description: "Permissionless meme → stacSOL conversion. Burn your meme to claim your share.",
    image: null as string | null,
  };
  try {
    const conn = new Connection(RPC, "confirmed");
    const tokenMeta = await getTokenMetadata(
      conn,
      new PublicKey(mint),
      "confirmed",
      TOKEN_2022_PROGRAM,
    );
    if (!tokenMeta) return fallback;

    let json: TokenJson = {};
    if (tokenMeta.uri && /^https?:\/\//.test(tokenMeta.uri)) {
      try {
        const r = await fetch(tokenMeta.uri, { cache: "no-store" });
        if (r.ok) json = (await r.json()) as TokenJson;
      } catch {}
    }

    const symbol = tokenMeta.symbol || mint.slice(0, 4).toUpperCase();
    const name = tokenMeta.name || symbol;
    const desc =
      json.description ||
      `$${symbol} on YAL.fun — graduate into stacSOL. Hold to claim your share.`;
    return {
      title: `$${symbol} — ${name} · yal.fun`,
      description: desc.slice(0, 200),
      image: json.image || null,
    };
  } catch {
    return fallback;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ mint: string }>;
}): Promise<Metadata> {
  const { mint } = await params;
  const og = await fetchOgMeta(mint);
  const url = `https://yal.fun/token/${mint}`;
  return {
    title: og.title,
    description: og.description,
    openGraph: {
      title: og.title,
      description: og.description,
      url,
      siteName: "YAL.fun",
      images: og.image ? [{ url: og.image }] : undefined,
      type: "website",
    },
    twitter: {
      card: og.image ? "summary_large_image" : "summary",
      title: og.title,
      description: og.description,
      images: og.image ? [og.image] : undefined,
    },
  };
}

export default function Page({
  params,
}: {
  params: Promise<{ mint: string }>;
}) {
  return <TokenPageClient params={params} />;
}
