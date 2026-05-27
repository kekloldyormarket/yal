"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useYal } from "../providers";
import type { UiToken } from "@/lib/types";
import { TIER_LABELS, type GraduationTier, buildLaunchTx } from "@/lib/launch-tx";

type LaunchForm = {
  name: string;
  ticker: string;
  description: string;
  img: string | null;
  twitter: string;
  telegram: string;
  tier: GraduationTier;
};

// Every YAL-launched meme's homepage is yal.fun — no per-meme website field.
const YAL_EXTERNAL_URL = "https://yal.fun";

export default function LaunchPage() {
  const { wallet, pushToast, registerPendingLaunch, connection } = useYal();
  const { publicKey, signTransaction } = useWallet();
  const router = useRouter();
  const [form, setForm] = useState<LaunchForm>({
    name: "",
    ticker: "",
    description: "",
    img: null,
    twitter: "",
    telegram: "",
    tier: 80, // default to the pump.fun-comparable threshold
  });
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [errors, setErrors] = useState<Partial<Record<keyof LaunchForm, string>>>({});
  const [imgPreview, setImgPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [launched, setLaunched] = useState<UiToken | null>(null);

  function setField<K extends keyof LaunchForm>(k: K, v: LaunchForm[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  }

  function validate() {
    const e: Partial<Record<keyof LaunchForm, string>> = {};
    if (!form.name || form.name.length < 2) e.name = "needs a name. at least 2 chars.";
    if (!form.ticker || form.ticker.length < 2) e.ticker = "ticker is required. 2–10 chars.";
    if (form.ticker.length > 10) e.ticker = "max 10 chars.";
    if (form.ticker && !/^[a-zA-Z0-9]+$/.test(form.ticker))
      e.ticker = "letters and digits only.";
    if (!form.description) e.description = "what is this thing?";
    if (form.description.length > 240) e.description = "max 240 chars.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;

    // Local preview immediately — don't make the user wait for the upload to
    // see their image in the review step.
    const reader = new FileReader();
    reader.onload = (ev) => setImgPreview(ev.target?.result as string);
    reader.readAsDataURL(f);

    // Kick off upload to Vercel Blob in the background. The resulting URL is
    // what gets baked into the on-chain metadata JSON later, so it MUST be a
    // real http(s) URL — not a data: URL.
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await fetch("/api/upload-image", { method: "POST", body: fd });
      const j = (await r.json()) as { url?: string; error?: string };
      if (!r.ok || !j.url) throw new Error(j.error || "upload failed");
      setField("img", j.url);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "image upload failed";
      pushToast({ title: "image upload failed", sub: msg, kind: "danger" });
      setImgPreview(null);
    } finally {
      setUploading(false);
    }
  }

  function next() {
    if (validate()) setStep(1);
  }

  async function sign() {
    if (!publicKey || !signTransaction) {
      pushToast({ title: "connect a wallet first", kind: "danger" });
      return;
    }
    setStep(2);

    // 1. Upload Metaplex metadata JSON → public URL (goes on the mint).
    let metadataUri = "";
    try {
      const r = await fetch("/api/upload-metadata", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          symbol: form.ticker.toUpperCase(),
          description: form.description,
          image: form.img || "",
          external_url: YAL_EXTERNAL_URL,
          twitter: form.twitter,
          telegram: form.telegram,
        }),
      });
      const j = (await r.json()) as { url?: string; error?: string };
      if (!r.ok || !j.url) throw new Error(j.error || "metadata upload failed");
      metadataUri = j.url;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "metadata upload failed";
      pushToast({ title: "metadata upload failed", sub: msg, kind: "danger" });
      setStep(1);
      return;
    }

    // 2. Build the two on-chain txs (Meteora DBC createPool + YAL register_token).
    let built;
    try {
      built = await buildLaunchTx(connection, {
        name: form.name,
        ticker: form.ticker.toUpperCase(),
        description: form.description,
        metadataUri,
        tier: form.tier,
        user: publicKey,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "tx build failed";
      pushToast({ title: "couldn't build launch tx", sub: msg, kind: "danger" });
      setStep(1);
      return;
    }

    // 3. Sign + send Meteora createPool (baseMint is a co-signer).
    try {
      built.meteoraTx.partialSign(built.baseMint);
      const signed = await signTransaction(built.meteoraTx);
      const sig = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        maxRetries: 5,
      });
      await connection.confirmTransaction(sig, "confirmed");
      pushToast({ title: "DBC pool created", sub: sig.slice(0, 8) + "…" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "DBC tx failed";
      pushToast({ title: "DBC pool failed", sub: msg, kind: "danger" });
      setStep(1);
      return;
    }

    // 4. Sign + send YAL register_token (treasuryAta is a co-signer).
    try {
      built.registerTx.partialSign(built.treasuryAta);
      const signed = await signTransaction(built.registerTx);
      const sig = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        maxRetries: 5,
      });
      await connection.confirmTransaction(sig, "confirmed");
      pushToast({ title: "registered with YAL router", sub: sig.slice(0, 8) + "…" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "register_token failed";
      pushToast({
        title: "register_token failed",
        sub: msg + " (DBC pool exists — retry from token page)",
        kind: "danger",
      });
      setStep(1);
      return;
    }

    // 5. Optimistic insert so the user lands on /token/<mint> with state.
    const t: UiToken = {
      mint: built.baseMint.publicKey.toBase58(),
      pubkey: built.yalToken.toBase58(),
      ticker: form.ticker.toUpperCase(),
      name: form.name,
      desc: form.description,
      img: form.img,
      authority: publicKey.toBase58(),
      treasury_ata: built.treasuryAta.publicKey.toBase58(),
      total_supply: 1_000_000_000,
      circulating_supply: 1_000_000_000,
      treasury_stacsol: 0,
      treasury_sol_lamports: 0,
      bonded_sol_lamports: 0,
      bonded_sol: 0,
      redeemed_meme: 0,
      graduated_at: 0,
      last_liquidation_ts: 0,
      created_at: Math.floor(Date.now() / 1000),
      status: "bonding",
      progress: 0,
    };
    registerPendingLaunch(t);
    pushToast({
      title: "$" + t.ticker + " launched",
      sub: "bonding curve live · " + form.tier + " sol target",
    });
    setLaunched(t);
    setStep(3);
  }

  return (
    <div className="container" style={{ maxWidth: 920 }}>
      <div className="hero">
        <h1>launch a meme.</h1>
        <p className="sub">
          one form. one transaction. the bonding curve is meteora DBC. when ~80
          sol is bonded, your token graduates and the bonded SOL routes into{" "}
          <strong className="accent">stacSOL</strong> as redeemable backing —
          forever.
        </p>
      </div>

      <div className="grid-token">
        <div>
          {step === 0 && (
            <FormStep
              form={form}
              setField={setField}
              handleImage={handleImage}
              imgPreview={imgPreview}
              errors={errors}
              next={next}
              wallet={wallet}
            />
          )}
          {step === 1 && (
            <ReviewStep
              form={form}
              imgPreview={imgPreview}
              back={() => setStep(0)}
              sign={sign}
            />
          )}
          {step === 2 && <SigningStep />}
          {step === 3 && launched && (
            <DoneStep token={launched} onOpen={() => router.push("/token/" + launched.mint)} />
          )}
        </div>
        <div>
          <Flywheel />
        </div>
      </div>
    </div>
  );
}

function FormStep({
  form,
  setField,
  handleImage,
  imgPreview,
  errors,
  next,
  wallet,
}: {
  form: LaunchForm;
  setField: <K extends keyof LaunchForm>(k: K, v: LaunchForm[K]) => void;
  handleImage: (e: React.ChangeEvent<HTMLInputElement>) => void;
  imgPreview: string | null;
  errors: Partial<Record<keyof LaunchForm, string>>;
  next: () => void;
  wallet: unknown;
}) {
  return (
    <div className="panel">
      <div className="panel-h">
        new token <span className="badge">step 1 / 3</span>
      </div>
      <div className="panel-body">
        <div className="field">
          <label className="label">name</label>
          <input
            value={form.name}
            onChange={(e) => setField("name", e.target.value)}
            placeholder="e.g. Moonbox"
            maxLength={32}
          />
          {errors.name && <div className="err">{errors.name}</div>}
        </div>

        <div className="grid-2">
          <div className="field">
            <label className="label">ticker</label>
            <input
              value={form.ticker}
              onChange={(e) => setField("ticker", e.target.value.toUpperCase())}
              placeholder="MOON"
              maxLength={10}
            />
            {errors.ticker && <div className="err">{errors.ticker}</div>}
          </div>
          <div className="field">
            <label className="label">supply (fixed)</label>
            <input value="1,000,000,000" disabled />
            <div className="hint">always 1B. matches YAL spec.</div>
          </div>
        </div>

        <div className="field">
          <label className="label">graduation tier — bonded SOL to graduate</label>
          <div className="btn-group">
            {([5, 20, 80] as GraduationTier[]).map((t) => (
              <button
                key={t}
                type="button"
                className={"btn " + (form.tier === t ? "active" : "")}
                style={{ flex: 1 }}
                onClick={() => setField("tier", t)}
              >
                {t} sol · {TIER_LABELS[t]}
              </button>
            ))}
          </div>
          <div className="hint">
            lower tier = easier graduation, smaller final stacSOL bag · higher
            tier = more skin in the game, bigger payout
          </div>
        </div>

        <div className="field">
          <label className="label">description · 240 max</label>
          <textarea
            rows={3}
            value={form.description}
            onChange={(e) => setField("description", e.target.value)}
            placeholder="say something true. or false. but be specific."
            maxLength={240}
          />
          <div className="hint">{form.description.length}/240</div>
          {errors.description && <div className="err">{errors.description}</div>}
        </div>

        <div className="field">
          <label className="label">image (png/jpg, optional)</label>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <label className="btn" style={{ cursor: "pointer", flexShrink: 0 }}>
              choose file
              <input
                type="file"
                accept="image/*"
                onChange={handleImage}
                style={{ display: "none" }}
              />
            </label>
            {imgPreview && (
              <img
                src={imgPreview}
                alt="token preview"
                style={{
                  width: 56,
                  height: 56,
                  objectFit: "cover",
                  border: "1px solid var(--border-2)",
                }}
              />
            )}
            {!imgPreview && (
              <span className="muted" style={{ fontSize: 11 }}>
                uses ticker glyph if blank
              </span>
            )}
          </div>
        </div>

        <div className="grid-2" style={{ gap: 12 }}>
          <div className="field">
            <label className="label">twitter (opt)</label>
            <input
              value={form.twitter}
              onChange={(e) => setField("twitter", e.target.value)}
              placeholder="@handle"
            />
          </div>
          <div className="field">
            <label className="label">telegram (opt)</label>
            <input
              value={form.telegram}
              onChange={(e) => setField("telegram", e.target.value)}
              placeholder="t.me/…"
            />
          </div>
        </div>
        <div className="hint" style={{ marginTop: -8, marginBottom: 12 }}>
          website is always <span className="accent">yal.fun</span> — every
          launch lives here.
        </div>

        <hr className="hr" />

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div className="muted" style={{ fontSize: 11 }}>
            cost: <strong className="accent">0.02 sol</strong> · creates Meteora
            DBC curve + register_token tx
          </div>
          <button className="btn primary lg" onClick={next} disabled={!wallet}>
            {wallet ? "review →" : "connect wallet first"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReviewStep({
  form,
  imgPreview,
  back,
  sign,
}: {
  form: LaunchForm;
  imgPreview: string | null;
  back: () => void;
  sign: () => void;
}) {
  return (
    <div className="panel">
      <div className="panel-h">
        review <span className="badge">step 2 / 3</span>
      </div>
      <div className="panel-body">
        <div style={{ display: "flex", gap: 16, marginBottom: 18 }}>
          {imgPreview ? (
            <img
              src={imgPreview}
              alt="token preview"
              style={{
                width: 64,
                height: 64,
                objectFit: "cover",
                border: "1px solid var(--border-2)",
              }}
            />
          ) : (
            <div className="avatar lg">{form.ticker.slice(0, 2)}</div>
          )}
          <div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>${form.ticker}</div>
            <div className="muted">{form.name}</div>
            <div style={{ marginTop: 6, fontSize: 12 }}>{form.description}</div>
          </div>
        </div>

        <div className="kv">
          <span className="k">total supply</span>
          <span className="v num">1,000,000,000</span>
        </div>
        <div className="kv">
          <span className="k">bonding curve</span>
          <span className="v">Meteora DBC</span>
        </div>
        <div className="kv">
          <span className="k">graduation target</span>
          <span className="v accent">YAL router</span>
        </div>
        <div className="kv">
          <span className="k">graduation threshold</span>
          <span className="v num">
            {form.tier.toFixed(2)} sol bonded · {TIER_LABELS[form.tier]} tier
          </span>
        </div>
        <div className="kv">
          <span className="k">post-grad backing</span>
          <span className="v accent">stacSOL</span>
        </div>
        <div className="kv">
          <span className="k">creator fee</span>
          <span className="v num">0 sol</span>
        </div>
        <div className="kv">
          <span className="k">tx fee</span>
          <span className="v num">0.02 sol</span>
        </div>

        <hr className="hr" />

        <div className="mono-block" style={{ marginBottom: 16 }}>
          <span className="muted">// atomic transaction</span>
          <br />
          1. create SPL mint ({form.ticker})
          <br />
          2. init Meteora DBC pool
          <br />
          3. <span className="accent">register_token</span>(total_supply =
          1_000_000_000)
          <br />
          4. seed initial reserves
        </div>

        <div style={{ display: "flex", gap: 12, justifyContent: "space-between" }}>
          <button className="btn" onClick={back}>
            ← back
          </button>
          <button className="btn primary lg" onClick={sign}>
            sign + launch
          </button>
        </div>
      </div>
    </div>
  );
}

function SigningStep() {
  return (
    <div className="panel">
      <div className="panel-h">
        signing <span className="badge live">awaiting wallet</span>
      </div>
      <div className="panel-body" style={{ textAlign: "center", padding: "48px 24px" }}>
        <pre
          className="ascii flicker"
          style={{ fontSize: 12, color: "var(--accent)" }}
        >{`    ╔═══════════════╗
    ║  approve tx   ║
    ║   in wallet   ║
    ╚═══════════════╝`}</pre>
        <p className="muted" style={{ marginTop: 18 }}>
          simulating · submitting · confirming
        </p>
        <div className="progress" style={{ marginTop: 12 }}>
          <div
            className="progress-fill"
            style={{ width: "60%", transition: "width 1.6s linear" }}
          />
        </div>
      </div>
    </div>
  );
}

function DoneStep({ token, onOpen }: { token: UiToken; onOpen: () => void }) {
  return (
    <div className="panel">
      <div className="panel-h">
        confirmed <span className="badge live">step 3 / 3</span>
      </div>
      <div className="panel-body" style={{ textAlign: "center", padding: "32px 24px" }}>
        <pre
          className="ascii"
          style={{ color: "var(--accent)", fontSize: 11, marginBottom: 18 }}
        >{`    ┌─────────────────────┐
    │       LIVE          │
    │   bonding curve     │
    │     activated       │
    └─────────────────────┘`}</pre>
        <div style={{ fontSize: 26, fontWeight: 800 }}>${token.ticker}</div>
        <div className="muted" style={{ marginBottom: 18 }}>
          {token.name}
        </div>
        <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>
          mint
        </div>
        <div className="mono-block" style={{ marginBottom: 18 }}>
          {token.mint}
        </div>
        <button className="btn primary lg" onClick={onOpen}>
          open token page →
        </button>
      </div>
    </div>
  );
}

function Flywheel() {
  return (
    <div>
      <div className="panel">
        <div className="panel-h">the flywheel</div>
        <div className="panel-body">
          <FlyStep n="01" t="someone launches" d="anyone. no permission. 0.02 sol." />
          <FlyStep n="02" t="bonding fills" d="meteora DBC. price discovers itself." />
          <FlyStep n="03" t="threshold hits" d="5 / 20 / 80 sol. curve graduates. 24h countdown." />
          <FlyStep
            n="04"
            t="music stops"
            d="bonded SOL minted into stacSOL. 6.9% fee → NAV."
            accent
          />
          <FlyStep
            n="05"
            t="holders redeem"
            d="burn meme. get (meme/supply) × treasury_stacsol."
          />
          <FlyStep
            n="06"
            t="every redemption funds NAV too"
            d="6.9% burn fee → NAV. floor up for everyone left."
            accent
          />
        </div>
      </div>

      <div style={{ height: 16 }} />

      <div className="panel">
        <div className="panel-h">spec</div>
        <div className="panel-body">
          <div className="kv">
            <span className="k">curve</span>
            <span className="v">Meteora DBC</span>
          </div>
          <div className="kv">
            <span className="k">graduation</span>
            <span className="v">YAL router</span>
          </div>
          <div className="kv">
            <span className="k">backing asset</span>
            <span className="v accent">stacSOL</span>
          </div>
          <div className="kv">
            <span className="k">supply</span>
            <span className="v num">1B fixed</span>
          </div>
          <div className="kv">
            <span className="k">decimals</span>
            <span className="v num">6</span>
          </div>
          <div className="kv">
            <span className="k">redemption</span>
            <span className="v">burn → claim</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function FlyStep({
  n,
  t,
  d,
  accent,
}: {
  n: string;
  t: string;
  d: string;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 14,
        padding: "10px 0",
        borderBottom: "1px dashed var(--border)",
      }}
    >
      <span
        className="num"
        style={{
          color: accent ? "var(--accent)" : "var(--text-3)",
          fontSize: 11,
          paddingTop: 2,
        }}
      >
        {n}
      </span>
      <div>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{t}</div>
        <div className="muted" style={{ fontSize: 11 }}>
          {d}
        </div>
      </div>
    </div>
  );
}

