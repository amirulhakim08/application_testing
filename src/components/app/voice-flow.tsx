"use client";

import * as React from "react";
import { AlertTriangle, Keyboard, Loader2, Mic, RotateCcw, Square, Trash2, Wand2 } from "lucide-react";
import { useI18n } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";
import type { ProposedExpense } from "@/lib/voice-parser";
import type { WorkspaceKind } from "@/lib/aggregate";
import { ExpenseFields, draftToInput, type DraftField, type ExpenseDraft } from "./expense-fields";
import { useSaveExpenses } from "./use-save";
import { useAppData, useWorkspaceHelpers } from "./app-data";
import { Notice } from "./scan-flow";

const MAX_SECONDS = 120;

type Stage = "idle" | "recording" | "transcribing" | "transcript" | "interpreting" | "review";

interface Proposal {
  key: string;
  draft: ExpenseDraft;
  uncertain: Set<DraftField>;
  suggestedCategory: string | null;
}

// Minimal typing for the Web Speech API (not in TS DOM lib everywhere)
type SpeechRec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

function getSpeechRecognition(): (new () => SpeechRec) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

export function VoiceFlow({ today }: { today: string }) {
  const { t, lang } = useI18n();
  const { ai } = useAppData();
  const { byKind, categoryByName } = useWorkspaceHelpers();
  const [stage, setStage] = React.useState<Stage>("idle");
  const [transcript, setTranscript] = React.useState("");
  const [notice, setNotice] = React.useState<string | null>(null);
  const [typed, setTyped] = React.useState(false);
  const [seconds, setSeconds] = React.useState(0);
  const [selectedWs, setSelectedWs] = React.useState<WorkspaceKind | null>(null);
  const [proposals, setProposals] = React.useState<Proposal[]>([]);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const recognitionRef = React.useRef<SpeechRec | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const { save, pending, dialog } = useSaveExpenses();

  // Browser capabilities are only known after mount (avoids hydration mismatch).
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const canServerTranscribe = mounted && ai.transcription && typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
  const SR = mounted ? getSpeechRecognition() : null;
  const canRecord = canServerTranscribe || Boolean(SR);

  const stopEverything = React.useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((tr) => tr.stop()); // release the microphone immediately
    streamRef.current = null;
  }, []);

  // Never keep recording in the background: stop when the page is hidden or unmounted.
  React.useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") {
        recorderRef.current?.state === "recording" && recorderRef.current.stop();
        recognitionRef.current?.stop();
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      recorderRef.current?.state === "recording" && recorderRef.current.stop();
      recognitionRef.current?.stop();
      stopEverything();
    };
  }, [stopEverything]);

  const startTimer = (onLimit: () => void) => {
    setSeconds(0);
    timerRef.current = setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= MAX_SECONDS) onLimit();
        return s + 1;
      });
    }, 1000);
  };

  const start = async () => {
    setNotice(null);
    if (canServerTranscribe) {
      try {
        // Permission is requested only now, when the user taps record.
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        streamRef.current = stream;
        const mimeType = pickMimeType();
        const rec = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 32000 } : undefined);
        chunksRef.current = [];
        rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
        rec.onstop = async () => {
          stopEverything();
          const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
          chunksRef.current = [];
          if (blob.size < 1000) return setStage("idle");
          await transcribe(blob);
        };
        recorderRef.current = rec;
        rec.start();
        setStage("recording");
        startTimer(() => rec.state === "recording" && rec.stop());
      } catch (err) {
        stopEverything();
        const denied = err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError");
        setNotice(denied ? t("voice.micDenied") : t("voice.unsupported"));
        setTyped(true);
        setStage("transcript");
      }
      return;
    }
    if (SR) {
      const r = new SR();
      r.lang = lang === "ms" ? "ms-MY" : "en-MY";
      r.interimResults = true;
      r.continuous = true;
      let finalText = "";
      r.onresult = (e) => {
        let interim = "";
        finalText = "";
        for (let i = 0; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) finalText += res[0].transcript + " ";
          else interim += res[0].transcript;
        }
        setTranscript((finalText + interim).trim());
      };
      r.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          setNotice(t("voice.micDenied"));
          setTyped(true);
        }
      };
      r.onend = () => {
        stopEverything();
        setStage("transcript");
      };
      recognitionRef.current = r;
      setTranscript("");
      r.start();
      setStage("recording");
      startTimer(() => r.stop());
      return;
    }
    setNotice(t("voice.unsupported"));
    setTyped(true);
    setStage("transcript");
  };

  const stop = () => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    recognitionRef.current?.stop();
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const transcribe = async (blob: Blob) => {
    setStage("transcribing");
    try {
      const body = new FormData();
      body.set("audio", new File([blob], "speech", { type: blob.type }));
      const res = await fetch("/api/voice/transcribe", { method: "POST", body });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "failed");
      setTranscript(json.text ?? "");
      setStage("transcript");
    } catch (e) {
      setNotice(e instanceof Error && e.message === "rate_limited" ? "Hourly voice limit reached. Type your expense instead." : "We couldn't transcribe that. You can type it instead.");
      setTyped(true);
      setStage("transcript");
    }
  };

  const interpret = async () => {
    if (!transcript.trim()) return;
    setStage("interpreting");
    setNotice(null);
    try {
      const res = await fetch("/api/voice/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript, defaultWorkspace: selectedWs }),
      });
      const json = (await res.json()) as { proposals: ProposedExpense[]; aiError?: string };
      if (!res.ok) throw new Error();
      if (json.aiError) setNotice("AI interpretation was unavailable; showing a basic interpretation — please double-check.");
      setProposals(
        json.proposals.map((p, i) => {
          const ws = p.workspace ? byKind(p.workspace) : null;
          const cat = ws ? categoryByName(ws.id, p.categoryName) : null;
          const uncertain = new Set<DraftField>();
          if (p.confidence.amount !== "high") uncertain.add("amount");
          if (p.confidence.date === "low") uncertain.add("date");
          uncertain.add("categoryId");
          return {
            key: `${i}-${Date.now()}`,
            suggestedCategory: p.categoryName,
            uncertain,
            draft: {
              amount: p.amountCents !== null ? (p.amountCents / 100).toFixed(2) : "",
              workspaceId: ws?.id ?? null,
              categoryId: cat?.id ?? null,
              merchant: p.merchant ?? "",
              description: p.description,
              date: p.date || today,
              time: "",
              notes: "",
              tax: "",
              discount: "",
            },
          };
        }),
      );
      setStage("review");
    } catch {
      setNotice(t("toast.error"));
      setStage("transcript");
    }
  };

  const update = (key: string, patch: Partial<ExpenseDraft>) =>
    setProposals((list) =>
      list.map((p) => {
        if (p.key !== key) return p;
        const next = { ...p.draft, ...patch };
        if (patch.workspaceId && !p.draft.workspaceId) next.categoryId = categoryByName(patch.workspaceId, p.suggestedCategory)?.id ?? null;
        const uncertain = new Set(p.uncertain);
        if (patch.amount !== undefined) uncertain.delete("amount");
        return { ...p, draft: next, uncertain };
      }),
    );

  const ready = proposals.length > 0 && proposals.every((p) => p.draft.amount && p.draft.workspaceId);

  return (
    <div className="grid gap-5">
      <div>
        <div className="mb-1.5 text-[13px] font-medium text-muted-foreground">{t("ws.choose")}</div>
        <Segmented<WorkspaceKind | "ask">
          size="sm"
          value={selectedWs ?? "ask"}
          onChange={(v) => setSelectedWs(v === "ask" ? null : v)}
          options={[
            { value: "ask", label: lang === "ms" ? "Tanya saya" : "Ask me" },
            { value: "personal", label: t("ws.personal"), tone: "personal" },
            { value: "company", label: t("ws.company"), tone: "company" },
          ]}
        />
      </div>

      {notice && <Notice tone="warning" icon={AlertTriangle}>{notice}</Notice>}

      {(stage === "idle" || stage === "recording" || stage === "transcribing") && (
        <Card className="grid place-items-center gap-5 px-6 py-10 text-center">
          <button
            type="button"
            onClick={stage === "recording" ? stop : start}
            disabled={stage === "transcribing" || (mounted && !canRecord)}
            aria-label={stage === "recording" ? t("voice.listening") : t("voice.tapToStart")}
            className={cn(
              "grid size-28 place-items-center rounded-full text-white shadow-xl transition-all active:scale-95 disabled:opacity-50",
              stage === "recording" ? "animate-pulse-ring bg-destructive" : "bg-primary shadow-primary/30",
            )}
          >
            {stage === "transcribing" ? <Loader2 className="size-10 animate-spin" /> : stage === "recording" ? <Square className="size-9 fill-current" /> : <Mic className="size-11" />}
          </button>
          <div>
            <div className="font-medium">
              {stage === "recording" ? t("voice.listening") : stage === "transcribing" ? t("voice.transcribing") : canRecord || !mounted ? t("voice.tapToStart") : t("voice.unsupported")}
            </div>
            {stage === "recording" ? (
              <div className="tabular mt-1 text-sm text-muted-foreground">
                {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} · {t("voice.limit", { s: MAX_SECONDS })}
              </div>
            ) : (
              <p className="mt-2 max-w-xs text-sm text-muted-foreground">{t("voice.examples")}</p>
            )}
            {stage === "recording" && SR && !canServerTranscribe && transcript && <p className="mt-3 text-sm italic">“{transcript}”</p>}
          </div>
          <p className="text-xs text-muted-foreground">{t("voice.privacy")}</p>
          {stage === "idle" && (
            <Button variant="ghost" size="sm" onClick={() => (setTyped(true), setStage("transcript"))}>
              <Keyboard /> {t("voice.typeInstead")}
            </Button>
          )}
        </Card>
      )}

      {(stage === "transcript" || stage === "interpreting") && (
        <Card className="grid gap-3 p-5">
          <label htmlFor="transcript" className="text-sm font-semibold">
            {typed ? t("voice.typeInstead") : t("voice.transcript")}
          </label>
          <Textarea
            id="transcript"
            value={transcript}
            maxLength={2000}
            autoFocus
            placeholder="Semalam beli barang dapur RM85 dekat Lotus"
            onChange={(e) => setTranscript(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t("voice.transcriptHint")}</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => (setTranscript(""), setTyped(false), setStage("idle"))} disabled={stage === "interpreting"}>
              <RotateCcw /> {t("voice.recordAgain")}
            </Button>
            <Button className="flex-1" onClick={interpret} disabled={!transcript.trim() || stage === "interpreting"}>
              {stage === "interpreting" ? <Loader2 className="animate-spin" /> : <Wand2 />}
              {stage === "interpreting" ? t("voice.interpreting") : t("voice.interpret")}
            </Button>
          </div>
        </Card>
      )}

      {stage === "review" && (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!ready) return;
            void save(proposals.map((p) => draftToInput(p.draft, { entryMethod: "voice" })));
          }}
        >
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{t("voice.proposals")}</h2>
            <Button type="button" variant="ghost" size="sm" onClick={() => setStage("transcript")}>
              {t("common.back")}
            </Button>
          </div>
          <p className="rounded-2xl bg-muted p-3 text-sm italic text-muted-foreground">“{transcript}”</p>
          {proposals.map((p, i) => (
            <Card key={p.key} className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">#{i + 1}</span>
                {proposals.length > 1 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setProposals((l) => l.filter((x) => x.key !== p.key))}>
                    <Trash2 /> {t("voice.remove")}
                  </Button>
                )}
              </div>
              {!p.draft.amount && <p className="mb-3 text-sm font-medium text-warning">{t("voice.noAmount")}</p>}
              <ExpenseFields draft={p.draft} onChange={(patch) => update(p.key, patch)} uncertain={p.uncertain} idPrefix={`v${i}`} />
            </Card>
          ))}
          <div className="sticky bottom-24 z-10 lg:static">
            <Button type="submit" size="lg" className="w-full shadow-lg" disabled={!ready || pending}>
              {pending && <Loader2 className="animate-spin" />}
              {pending ? t("form.saving") : proposals.length > 1 ? t("form.saveAll", { n: proposals.length }) : t("form.save")}
            </Button>
          </div>
          {dialog}
        </form>
      )}
    </div>
  );
}
