"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { runProposal } from "@/app/actions";
import type { ChatTurn, Proposal } from "@/lib/assistant/proposals";
import { toBnDigits } from "@/lib/format";
import { startRecording, type Recording } from "@/lib/wav-recorder";
import { Spinner, useReportBusy } from "./busy";
import { useI18n } from "./i18n";
import Sheet from "./sheet";

type CardState = { p: Proposal; status: "pending" | "done" | "cancelled"; result?: string };
type Turn = { role: "user" | "model"; text: string; cards?: CardState[]; error?: boolean };

const MAX_SECONDS = 30;
const noSubscribe = () => () => {};
const micAvailable = () => Boolean(navigator.mediaDevices?.getUserMedia);

/** Replies show as plain text: drop stray markdown emphasis, and use Bangla digits on Bangla screens. */
const tidyReply = (text: string, lang: "bn" | "en") => {
  const plain = text.replace(/\*+/g, "").trim();
  return lang === "bn" ? toBnDigits(plain) : plain;
};

/** Header button + chat window. The AI prepares changes as cards; nothing is saved until confirm. */
export default function Assistant() {
  const { t, f, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  useReportBusy(thinking);
  const chatRef = useRef<HTMLDivElement>(null);

  // Voice: tap the mic to record, tap again to send the recording
  const canRecord = useSyncExternalStore(noSubscribe, micAvailable, () => false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [micNote, setMicNote] = useState<string | null>(null);
  const recorder = useRef<{ stop(): Recording; cancel(): void } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  // Latest turns for callbacks that run after a render (the recording timer finishing)
  const turnsRef = useRef(turns);
  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, thinking]);

  // What the AI sees: the conversation text, plus what happened to each card
  const history = (all: Turn[]): ChatTurn[] =>
    all
      .filter((x) => !x.error)
      .map((x) => ({
        role: x.role,
        text: [
          x.text,
          ...(x.cards ?? []).map((c) => `[card ${c.p.kind}: ${c.status}${c.result ? ` (${c.result})` : ""}]`),
        ].join("\n"),
      }));

  async function send(text: string, audio?: Recording) {
    const msg = text.trim();
    if (!msg || thinking) return;
    const next: Turn[] = [...turnsRef.current, { role: "user", text: msg }];
    setTurns(next);
    setInput("");
    setThinking(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          history: history(next),
          audio: audio ? { mimeType: audio.mimeType, data: audio.data } : undefined,
        }),
      });
      const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
      if (!res.ok || !data) throw new Error(data?.error ?? t.aiFailed);
      const cards: CardState[] = (data.proposals as Proposal[]).map((p) => ({ p, status: "pending" }));
      setTurns((all) => [
        ...all,
        {
          role: "model",
          text: tidyReply(data.reply ?? "", lang) || (cards.length ? t.aiCheck : t.aiNoReply),
          cards,
        },
      ]);
    } catch (e) {
      const message = navigator.onLine ? (e as Error).message : t.aiOffline;
      setTurns((all) => [...all, { role: "model", text: message, error: true }]);
    } finally {
      setThinking(false);
    }
  }

  function stopRecording(sendIt: boolean) {
    clearInterval(timer.current);
    setRecording(false);
    const rec = recorder.current;
    recorder.current = null;
    if (!rec) return;
    if (!sendIt) return rec.cancel();
    const audio = rec.stop();
    if (audio.seconds < 0.6) return setMicNote(t.aiTooShort);
    send(t.aiVoiceTurn, audio);
  }

  async function toggleRecording() {
    if (recording) return stopRecording(true);
    setMicNote(null);
    try {
      recorder.current = await startRecording();
    } catch (e) {
      const name = (e as Error).name;
      setMicNote(name === "NotAllowedError" || name === "SecurityError" ? t.aiMicDenied : t.aiNoMic);
      return;
    }
    setSeconds(0);
    setRecording(true);
    let ticks = 0;
    timer.current = setInterval(() => {
      ticks += 1;
      setSeconds(ticks);
      if (ticks >= MAX_SECONDS) stopRecording(true);
    }, 1000);
  }

  // Closing the window throws away an unfinished recording
  const close = () => {
    stopRecording(false);
    setOpen(false);
  };
  useEffect(() => () => recorder.current?.cancel(), []);

  const setCard = (turn: number, card: number, patch: Partial<CardState>) =>
    setTurns((all) =>
      all.map((x, i) =>
        i !== turn ? x : { ...x, cards: x.cards?.map((c, j) => (j === card ? { ...c, ...patch } : c)) },
      ),
    );

  return (
    <>
      <button className="icon-btn" aria-label={t.aiOpen} onClick={() => setOpen(true)}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z" />
          <path d="M12 8.5l.9 2 2 .9-2 .9-.9 2-.9-2-2-.9 2-.9z" fill="currentColor" stroke="none" />
        </svg>
      </button>

      {open && (
        <Sheet title={t.aiTitle} onClose={close}>
          {turns.length > 0 && (
            <button className="mode-link" onClick={() => setTurns([])}>
              {t.aiNewChat}
            </button>
          )}
          <div className="chat" ref={chatRef} aria-live="polite">
            {!turns.length && (
              <div className="bubble model">
                {t.aiIntro}
                <div className="example-chips">
                  {t.aiExamples.map((ex) => (
                    <button key={ex} className="chip" onClick={() => send(ex)}>
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {turns.map((turn, i) => (
              <div key={i} className="turn">
                <div className={`bubble ${turn.role}${turn.error ? " error" : ""}`}>{turn.text}</div>
                {turn.cards?.map((c, j) => (
                  <ProposalCard
                    key={j}
                    card={c}
                    onDone={(result) => setCard(i, j, { status: "done", result })}
                    onCancel={() => setCard(i, j, { status: "cancelled" })}
                  />
                ))}
              </div>
            ))}
            {thinking && (
              <div className="bubble model thinking">
                <span className="dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                {t.aiThinking}
              </div>
            )}
          </div>
          <form
            className="chat-form"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            {recording ? (
              <div className="recording-bar" role="status">
                <span className="rec-dot" aria-hidden="true" />
                {t.aiRecording(f.digits(`0:${String(seconds).padStart(2, "0")}`))}
                <button type="button" className="mode-link" onClick={() => stopRecording(false)}>
                  {t.aiDismiss}
                </button>
              </div>
            ) : (
              <input
                className="input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={canRecord ? t.aiPlaceholderMic : t.aiPlaceholder}
                aria-label={t.aiPlaceholder}
                enterKeyHint="send"
              />
            )}
            {canRecord && (
              <button
                type="button"
                className={"mic-btn" + (recording ? " on" : "")}
                onClick={toggleRecording}
                disabled={thinking}
                aria-pressed={recording}
                aria-label={recording ? t.aiStopListening : t.aiSpeak}
              >
                {recording ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M4 12l16-8-6 16-2.5-6.5z" />
                  </svg>
                ) : (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="3" width="6" height="11" rx="3" />
                    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                  </svg>
                )}
              </button>
            )}
            {!recording && (
              <button className="send-btn" disabled={!input.trim() || thinking} aria-label={t.aiSend}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M4 12l16-8-6 16-2.5-6.5z" />
                </svg>
              </button>
            )}
          </form>
          {micNote && (
            <p className="sub" style={{ marginTop: 6 }}>
              {micNote}
            </p>
          )}
        </Sheet>
      )}
    </>
  );
}

function ProposalCard({
  card,
  onDone,
  onCancel,
}: {
  card: CardState;
  onDone: (result: string) => void;
  onCancel: () => void;
}) {
  const { t, f } = useI18n();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  useReportBusy(pending);
  const { p, status } = card;

  const confirm = () =>
    start(async () => {
      setError(null);
      const r = await runProposal(p);
      if (r.error) setError(r.error);
      else onDone(r.message ?? "");
    });

  const row = (label: string, value: string) => (
    <div className="line">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
  const change = (label: string, a: string, b: string) => (a === b ? null : row(label, `${a} → ${b}`));

  let title = "";
  let body: React.ReactNode = null;
  let total: number | null = null;
  switch (p.kind) {
    case "quick_sale":
      title = t.aiQuickSale;
      body = p.note ? row(t.note, p.note) : null;
      total = p.total;
      break;
    case "item_sale":
      title = t.aiItemSale;
      body = (
        <>
          {p.lines.map((l) =>
            row(
              l.amount ? `${l.name} (≈ ${f.qty(l.amount / l.price, l.unit)})` : `${l.name} × ${f.qty(l.qty ?? 0, l.unit)}`,
              f.money(l.line_total),
            ),
          )}
          {p.discount > 0 && row(t.discount, `−${f.money(p.discount)}`)}
        </>
      );
      total = p.total;
      break;
    case "update_product":
      title = t.aiUpdate(p.name);
      body = (
        <>
          {change(t.name, p.before.name, p.after.name)}
          {change(t.fNameBn, p.before.name_bn ?? "–", p.after.name_bn ?? "–")}
          {change(t.fCode, p.before.short_code ?? "–", p.after.short_code ?? "–")}
          {change(t.fCategory, p.before.category ?? "–", p.after.category ?? "–")}
          {change(t.favourite, p.before.is_favorite ? "✓" : "–", p.after.is_favorite ? "✓" : "–")}
          {change(t.aiPrice, f.money(p.before.sell_price), f.money(p.after.sell_price))}
          {change(t.aiStock, f.qty(p.before.stock_qty, p.unit), f.qty(p.after.stock_qty, p.unit))}
          {change(
            t.aiLowWarn,
            p.before.low_stock_at === null ? "–" : f.qty(p.before.low_stock_at, p.unit),
            p.after.low_stock_at === null ? "–" : f.qty(p.after.low_stock_at, p.unit),
          )}
        </>
      );
      break;
    case "new_product":
      title = t.aiNewProduct;
      body = (
        <>
          {row(t.name, p.product.name_bn ? `${p.product.name_bn} (${p.product.name})` : p.product.name)}
          {row(t.aiPrice, `${f.money(p.product.sell_price)} ${t.perUnit(f.unit(p.product.unit))}`)}
          {row(t.aiStock, f.qty(p.product.stock_qty, p.product.unit))}
          {p.product.category && row(t.fCategory, p.product.category)}
        </>
      );
      break;
    case "new_sr":
      title = t.aiNewSr;
      body = (
        <>
          {row(t.name, p.sr.name)}
          {p.sr.company && row(t.company, p.sr.company)}
          {row(t.srPhone, f.digits(p.sr.phone))}
        </>
      );
      break;
    case "open_shop":
      title = t.aiOpenShop;
      break;
    case "close_shop":
      title = t.aiCloseShop;
      body = <p className="sub">{t.closeSummary(f.num(p.count), f.money(p.total))}</p>;
      break;
    case "void_sale":
      title = t.aiVoid(f.digits(p.receipt_no));
      body = (
        <>
          <p className="sub">{f.date(p.day_date)}</p>
          {row(p.summary, f.money(p.total))}
        </>
      );
      break;
    case "delete_sales":
      title = t.aiDeleteSales(f.date(p.day_date), f.num(p.sales.length));
      body = (
        <>
          {p.sales.map((s) => (
            <div key={s.sale_id}>{row(`#${f.digits(s.receipt_no)} ${s.summary}`, f.money(s.total))}</div>
          ))}
          <p className="sub danger-note">{t.aiForGood}</p>
        </>
      );
      total = p.total;
      break;
    case "delete_days":
      title = t.aiDeleteDays(f.num(p.days.length));
      body = (
        <>
          {p.days.map((d) => (
            <div key={d.day_id}>{row(`${f.date(d.day_date)}, ${t.salesCount(f.num(d.sales))}`, f.money(d.total))}</div>
          ))}
          <p className="sub danger-note">{t.aiForGood}</p>
        </>
      );
      total = p.total;
      break;
  }

  return (
    <div className={`ai-card ${status}`}>
      <h4>{title}</h4>
      {body}
      {total !== null && (
        <div className="line total">
          <span>{t.total}</span>
          <span className="num">{f.money(total)}</span>
        </div>
      )}
      {status === "pending" && (
        <>
          {error && <p className="error">{error}</p>}
          <div className="actions">
            <button className="btn-small" disabled={pending} onClick={confirm}>
              {pending ? (
                <>
                  <Spinner />
                  {t.saving}
                </>
              ) : (
                t.aiConfirm
              )}
            </button>
            <button className="mini" disabled={pending} onClick={onCancel}>
              {t.aiDismiss}
            </button>
          </div>
        </>
      )}
      {status === "done" && <p className="ai-status done">✓ {card.result}</p>}
      {status === "cancelled" && <p className="ai-status">{t.aiCancelled}</p>}
    </div>
  );
}
