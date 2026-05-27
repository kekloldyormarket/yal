// POST a multipart form with a single 'file' field (PNG/JPG/GIF/WEBP, <= 5MB).
// Returns { url } pointing at the public Vercel Blob URL for the image.
//
// Used by the /launch page during meme creation. Memes are public, anonymous,
// permanent — same access model as the rest of the protocol.

import { NextResponse } from "next/server";
import { put } from "@vercel/blob";

export const runtime = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "missing 'file' field" }, { status: 400 });
    }
    if (!ALLOWED.has(file.type)) {
      return NextResponse.json(
        { error: `unsupported mime: ${file.type}` },
        { status: 400 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `file too large: ${file.size} > ${MAX_BYTES}` },
        { status: 413 },
      );
    }

    const ext = file.type.split("/")[1] || "bin";
    const safeName = (file.name || "meme")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 40);
    // `addRandomSuffix` keeps two launches with the same filename from colliding.
    const blob = await put(`memes/${Date.now()}-${safeName}.${ext}`, file, {
      access: "public",
      contentType: file.type,
      addRandomSuffix: true,
    });

    return NextResponse.json({ url: blob.url, contentType: file.type, size: file.size });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "upload failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
