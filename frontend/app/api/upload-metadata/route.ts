// POST a JSON body with the Metaplex-shape metadata (name, symbol, image URL,
// description, social links). Returns { url } pointing at the public Vercel
// Blob URL of the JSON — this is what gets passed as the token's `uri` to
// Meteora's DBC createPool.
//
// Anyone reading the SPL/Token-2022 mint's metadata pointer follows the uri
// here and reads the resulting JSON.

import { NextResponse } from "next/server";
import { put } from "@vercel/blob";

export const runtime = "nodejs";

interface Metadata {
  name: string;
  symbol: string;
  description?: string;
  image: string;
  external_url?: string;
  twitter?: string;
  telegram?: string;
  // Metaplex extensions
  attributes?: { trait_type: string; value: string }[];
  properties?: {
    files?: { uri: string; type: string }[];
    category?: string;
  };
}

const MAX_FIELD = 240;

function sanitize(s: string | undefined, max = MAX_FIELD): string {
  if (!s) return "";
  return s.trim().slice(0, max);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<Metadata>;
    const name = sanitize(body.name, 32);
    const symbol = sanitize(body.symbol, 10);
    const image = sanitize(body.image, 512);

    if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
    if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });
    // Image is optional. If provided, it must be a real URL.
    if (image && !/^https?:\/\//.test(image)) {
      return NextResponse.json(
        { error: "image must be an http(s) url" },
        { status: 400 },
      );
    }

    const metadata: Metadata = {
      name,
      symbol,
      description: sanitize(body.description, 240),
      image,
      external_url: sanitize(body.external_url, 512),
      twitter: sanitize(body.twitter, 64),
      telegram: sanitize(body.telegram, 128),
    };
    if (image) {
      metadata.properties = {
        files: [{ uri: image, type: "image/png" }],
        category: "image",
      };
    }

    const filename = `metadata/${symbol.toLowerCase()}-${Date.now()}.json`;
    const blob = await put(filename, JSON.stringify(metadata, null, 2), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: true,
    });

    return NextResponse.json({ url: blob.url, metadata });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "metadata upload failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
