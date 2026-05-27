"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useYal } from "../providers";
import type { UiToken } from "@/lib/types";

type LaunchForm = {
  name: string;
  ticker: string;
  description: string;
  img: string | null;
  twitter: string;
  telegram: string;
  website: string;
};

export default function LaunchPage() {
  const { wallet, pushToast, registerPendingLaunch } = useYal();
  const router = useRouter();
  const [form, setForm] = useState<LaunchForm>({
    name: "",
    ticker: "",
    description: "",
    img: null,
    twitter: "",
    telegram: "",
    website: "",
  });
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [errors, setErrors] = useState<Partial<Record<keyof LaunchForm, string>>>({});
  const [imgPreview, setImgPreview] = useState<string | null>(null);
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

  function handleImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const src = ev.target?.result as string;
      setImgPreview(src);
      setField("img", src);
    };
    reader.readAsDataURL(f);
  }

  function next() {
    if (validate()) setStep(1);
  }

  function sign() {
    setStep(2);
    // Mock launch — real flow will create mint + Meteora DBC pool + register_token.
    setTimeout(() => {
      const fakeMint = generateFakeMint(form.ticker + Date.now());
      const t: UiToken = {
        mint: fakeMint,
        pubkey: fakeMint,
        ticker: form.ticker.toUpperCase(),
        name: form.name,
        desc: form.description,
        img: form.img,
        authority: wallet?.addr || "",
        treasury_ata: generateFakeMint("ata" + fakeMint),
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
      pushToast({ title: "$" + t.ticker + " launched", sub: "bonding curve live" });
      setLaunched(t);
      setStep(3);
    }, 1800);
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
            placeholder="e.g. Premium Jeet"
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
              placeholder="JEET"
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

        <div className="grid-3" style={{ gap: 12 }}>
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
          <div className="field">
            <label className="label">website (opt)</label>
            <input
              value={form.website}
              onChange={(e) => setField("website", e.target.value)}
              placeholder="https://…"
            />
          </div>
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
          <span className="v num">80.00 sol bonded</span>
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
          <FlyStep n="03" t="80 sol reached" d="curve graduates. liquidity stops being LP." />
          <FlyStep
            n="04"
            t="bonded sol → stacSOL"
            d="staked. 100% commission. NAV grows forever."
            accent
          />
          <FlyStep
            n="05"
            t="holders redeem"
            d="burn meme. get (meme/supply) × treasury_stacsol."
          />
          <FlyStep
            n="06"
            t="floor only rises"
            d="every redemption shrinks supply faster than treasury."
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

function generateFakeMint(seed: string): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ123456789";
  let s = 0;
  for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
  let out = "";
  for (let i = 0; i < 44; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out += chars[Math.floor(((s & 0x7fffffff) / 0x7fffffff) * chars.length)];
  }
  return out;
}
