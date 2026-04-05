"use client";

import {
  Fragment,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  extractFollowUpQuestionLoose,
  extractPlainAssistantFromBlob,
  looksLikeAdvisorJsonBlob,
  safeUiAssistantLine,
  safeUiFollowUpPrompt,
  unwrapFollowUpListItem,
  type ProgramRecommendation,
} from "@/lib/lyzr";

type ChatMessage = { role: "user" | "assistant"; content: string };

type StructuredFollowUp = {
  id: string;
  prompt: string;
  choices: Array<{ label: string; value: string; sendAs: string }>;
};

type ApiResponse = {
  ok: boolean;
  status: number;
  assistantText?: string;
  recommendations?: ProgramRecommendation[];
  followUps?: string[];
  userProfile?: {
    persona?: string;
    industry?: string[];
    location?: string;
    stage?: string;
    needs?: string[];
    timeline?: string;
    constraints?: string[];
  };
  /** Present in development only — helps verify followUps vs assistantText shape. */
  diagnostics?: {
    followUpCount: number;
    assistantTextChars: number;
    note?: string;
  };
  error?: string;
};

type PipelineStepId = "understand" | "retrieve" | "rank" | "followups" | "format";
type PipelineStep = { id: PipelineStepId; title: string };

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function looksLikeJsonObjectString(s: string): boolean {
  const t = s.trim();
  return t.length > 2 && t.startsWith("{") && t.endsWith("}");
}

/** Pull a user-facing string from a field that may itself contain JSON. */
function extractHumanTextFromValue(val: unknown): string {
  if (typeof val !== "string") return "";
  const t = val.trim();
  if (!t) return "";
  if (looksLikeJsonObjectString(t)) {
    try {
      const inner = JSON.parse(t) as Record<string, unknown>;
      const nested =
        (typeof inner.message === "string" && inner.message.trim() && inner.message) ||
        (typeof inner.text === "string" && inner.text.trim() && inner.text) ||
        (typeof inner.detail === "string" && inner.detail.trim() && inner.detail);
      if (nested && String(nested).trim() && !looksLikeJsonObjectString(String(nested))) {
        return String(nested).trim();
      }
    } catch {
      /* ignore */
    }
    return "";
  }
  return t;
}

const HUMAN_BY_FEATURE: Record<string, string> = {
  __start__: "",
  __end__: "",
  llm_generation: "Generating a tailored response",
  knowledge_base: "Searching the program knowledge base",
  memory: "Saving conversation context",
  tool_calling: "Planning and running tools",
  agent: "Running the advisor agent",
};

const HUMAN_BY_EVENT: Record<string, string> = {
  agent_process_start: "Starting the agent",
  agent_process_end: "Finishing up",
  open: "",
  ws_open: "",
  ws_close: "",
};

function humanizeMetricFallback(eventType?: string, feature?: string): string {
  const f = (feature ?? "").toLowerCase();
  const e = (eventType ?? "").toLowerCase();
  if (f in HUMAN_BY_FEATURE) return HUMAN_BY_FEATURE[f];
  if (e in HUMAN_BY_EVENT) return HUMAN_BY_EVENT[e];
  return "";
}

function ensureStepDetail(heading: string, text: string): string {
  const t = text.trim();
  if (t) return t;
  const h = heading.toLowerCase();
  if (h.includes("memory")) return "Updating session memory";
  if (h.includes("knowledge")) return "Retrieving relevant program information";
  if (h.includes("llm") || h.includes("generation")) return "Crafting your answer";
  if (h.includes("tool")) return "Using tools to gather details";
  if (h.includes("start") || h.includes("process_start")) return "Initializing your request";
  if (h.includes("end") || h.includes("process_end")) return "Completing this turn";
  return "Working…";
}

type MetricMetaRow = { label: string; value: string };

function isSensitiveMetricKey(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    lower.includes("api_key") ||
    lower.includes("apikey") ||
    lower.includes("x-api-key") ||
    lower.includes("secret") ||
    lower.includes("password") ||
    lower.includes("authorization") ||
    lower.includes("bearer") ||
    (lower.includes("token") && !lower.includes("max_tokens") && !lower.includes("maxtokens"))
  );
}

function tryFormatMetricTimestamp(ts: string): string | undefined {
  const n = Date.parse(ts);
  if (Number.isNaN(n)) return undefined;
  try {
    return new Date(n).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return undefined;
  }
}

/** Pull safe, user-displayable fields from a metrics JSON payload (never secrets). */
function extractMetricMetaPayload(j: Record<string, unknown>): MetricMetaRow[] {
  const acc = new Map<string, string>();

  const add = (label: string, raw: unknown) => {
    if (raw === undefined || raw === null) return;
    if (isSensitiveMetricKey(label)) return;
    let s =
      typeof raw === "string"
        ? raw.trim()
        : typeof raw === "number" && Number.isFinite(raw)
          ? String(raw)
          : typeof raw === "boolean"
            ? String(raw)
            : "";
    if (!s || s.length > 220) return;
    if (looksLikeJsonObjectString(s) && s.length > 120) return;
    if (!acc.has(label)) acc.set(label, s.length > 96 ? `${s.slice(0, 95)}…` : s);
  };

  const labelForKey = (k: string): string | undefined => {
    const kl = k.toLowerCase();
    if (kl === "run_id" || kl === "runid") return "Run ID";
    if (kl === "session_id" || kl === "sessionid") return "Session";
    if (kl === "model" || kl === "model_name" || kl === "modelid" || kl === "model_id") return "Model";
    if (kl === "provider" || kl === "llm_provider") return "Provider";
    if (kl === "deployment" || kl === "endpoint") return "Endpoint";
    if (kl === "temperature") return "Temperature";
    if (kl === "max_tokens" || kl === "maxtokens") return "Max tokens";
    if (kl === "top_p" || kl === "topp") return "Top P";
    if (kl === "level" || kl === "log_level") return "Level";
    if (kl === "event_type" || kl === "eventtype") return "Event";
    if (kl === "feature") return "Feature";
    if (kl === "status" || kl === "state") return "State";
    if (kl === "latency_ms" || kl === "duration_ms" || kl === "elapsed_ms") return "Latency";
    if (kl === "trace_id" || kl === "traceid" || kl === "span_id" || kl === "request_id") return "Trace";
    if (kl === "agent_id" || kl === "agentid") return "Agent ID";
    if (kl === "user_id" || kl === "userid") return "User";
    return undefined;
  };

  /** Lyzr often nests model/run_id under arbitrary objects — walk the tree (bounded depth). */
  function deepScan(obj: unknown, depth: number): void {
    if (depth > 8) return;
    if (obj === null || obj === undefined) return;

    if (typeof obj === "string") {
      const t = obj.trim();
      if (t.length > 4000) return;
      if (t.startsWith("{") && t.includes("}")) {
        try {
          deepScan(JSON.parse(t) as Record<string, unknown>, depth + 1);
        } catch {
          /* not JSON */
        }
      }
      return;
    }

    if (typeof obj !== "object") return;

    if (Array.isArray(obj)) {
      for (const el of obj) deepScan(el, depth + 1);
      return;
    }

    const rec = obj as Record<string, unknown>;
    for (const [k, v] of Object.entries(rec)) {
      if (isSensitiveMetricKey(k)) continue;
      const label = labelForKey(k);
      if (label && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")) {
        add(label, v);
      }
      // Descend into nested objects and JSON strings (e.g. payload nested under arbitrary keys).
      deepScan(v, depth + 1);
    }
  }

  const ts = j.timestamp ?? j["@timestamp"] ?? j.time ?? j.created_at ?? j.ts;
  if (typeof ts === "string" && ts.length < 120) {
    const ft = tryFormatMetricTimestamp(ts);
    add("Time", ft ?? ts);
  } else if (typeof ts === "number" && Number.isFinite(ts)) {
    add("Time", new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
  }

  add("Run ID", j.run_id ?? j.runId);
  add("Session", j.session_id ?? j.sessionId);
  add("Model", j.model ?? j.model_name ?? j.modelId);
  add("Provider", j.provider);
  if (typeof j.temperature === "number") add("Temperature", j.temperature);
  if (typeof j.max_tokens === "number") add("Max tokens", j.max_tokens);
  if (typeof j.maxTokens === "number") add("Max tokens", j.maxTokens);
  if (typeof j.top_p === "number") add("Top P", j.top_p);
  add("Level", j.level);
  add("Event", j.event_type);
  const feat = j.feature;
  if (typeof feat === "string" && feat !== "__start__" && feat !== "__end__") add("Feature", feat);
  add("State", j.status);

  const mergeInner = (inner: Record<string, unknown>) => {
    const pick = (k: string, label: string) => {
      if (isSensitiveMetricKey(k)) return;
      if (isSensitiveMetricKey(label)) return;
      const v = inner[k];
      if (v === undefined || v === null) return;
      if (k === "feature" && typeof v === "string" && (v === "__start__" || v === "__end__")) return;
      add(label, v);
    };
    pick("run_id", "Run ID");
    pick("runId", "Run ID");
    pick("model", "Model");
    pick("model_name", "Model");
    pick("provider", "Provider");
    pick("temperature", "Temperature");
    pick("max_tokens", "Max tokens");
    pick("status", "State");
    pick("level", "Level");
    pick("feature", "Feature");
    pick("event_type", "Event");
  };

  const msg = j.message;
  if (typeof msg === "object" && msg !== null && !Array.isArray(msg)) {
    mergeInner(msg as Record<string, unknown>);
    deepScan(msg, 0);
  } else if (typeof msg === "string") {
    const t = msg.trim();
    if (t.startsWith("{")) {
      try {
        mergeInner(JSON.parse(t) as Record<string, unknown>);
      } catch {
        /* ignore */
      }
    }
  }

  for (const nestKey of ["data", "payload", "response", "details", "metadata", "context", "attributes", "extra"] as const) {
    const v = j[nestKey];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      mergeInner(v as Record<string, unknown>);
    }
  }

  deepScan(j, 0);

  const order = [
    "Time",
    "Run ID",
    "Session",
    "Model",
    "Provider",
    "Endpoint",
    "Temperature",
    "Max tokens",
    "Top P",
    "Level",
    "Event",
    "Feature",
    "State",
    "Latency",
    "Trace",
    "Agent ID",
    "User",
  ];
  const rows: MetricMetaRow[] = [];
  for (const label of order) {
    if (acc.has(label)) rows.push({ label, value: acc.get(label)! });
  }
  for (const [label, value] of acc) {
    if (!order.includes(label)) rows.push({ label, value });
  }
  return rows.slice(0, 8);
}

function parseMetricLine(raw: string): {
  text: string;
  heading: string;
  status?: string;
  tag?: string;
  meta?: MetricMetaRow[];
} {
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;

    const recordType = typeof j.type === "string" ? j.type : undefined;
    if (recordType === "open" || recordType === "error" || recordType === "error_detail") {
      return { text: "", heading: "" };
    }

    const eventType = typeof j.event_type === "string" ? j.event_type : undefined;
    const feature = typeof j.feature === "string" ? j.feature : undefined;
    const status = typeof j.status === "string" ? j.status : undefined;

    if (eventType === "open" || eventType === "ws_open" || eventType === "ws_close") {
      return { text: "", heading: "", status };
    }
    if (recordType === "ws_close") {
      return { text: "", heading: "", status };
    }

    const heading =
      typeof feature === "string" && feature !== "__start__" && feature !== "__end__"
        ? feature
        : typeof eventType === "string"
          ? eventType
          : "step";

    let text =
      extractHumanTextFromValue(j.message) ||
      extractHumanTextFromValue(j.text) ||
      extractHumanTextFromValue(j.detail) ||
      extractHumanTextFromValue(j.step) ||
      extractHumanTextFromValue(j.response);

    if (!text.trim()) {
      text = humanizeMetricFallback(eventType, feature);
    }

    const tag =
      (typeof j.tag === "string" && j.tag) ||
      (typeof j.category === "string" && j.category) ||
      (typeof feature === "string" ? feature : undefined);

    text = ensureStepDetail(heading, text);

    const metaRows = extractMetricMetaPayload(j);
    return {
      text: String(text).slice(0, 500),
      heading,
      status,
      tag: tag ? String(tag).slice(0, 48) : undefined,
      meta: metaRows.length ? metaRows : undefined,
    };
  } catch {
    if (looksLikeJsonObjectString(raw)) {
      return { text: "", heading: "" };
    }
    const plain = raw.trim().slice(0, 300);
    return plain ? { text: plain, heading: "step" } : { text: "", heading: "" };
  }
}

function formatHeading(h: string): string {
  return h
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateText(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function friendlyOrchestrationTitle(heading: string): string {
  const h = heading.toLowerCase();
  const map: Record<string, string> = {
    agent_process_start: "Agent started",
    agent_process_end: "Process complete",
    knowledge_base: "Knowledge base",
    llm_generation: "Answer generation",
    memory: "Memory",
    tool_calling: "Tools & actions",
  };
  if (map[h]) return map[h];
  return formatHeading(heading);
}

function orchestrationSubtleTag(heading: string): string | undefined {
  const h = heading.toLowerCase();
  if (h.includes("memory")) return "memory";
  if (h.includes("knowledge")) return "knowledge";
  if (h.includes("llm") || h.includes("generation")) return "generation";
  if (h.includes("tool")) return "tools";
  if (h.includes("agent_process")) return "agent";
  return undefined;
}

function IconWrench({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21.75 6.75a4.5 4.5 0 01-4.884 4.484c-1.076-.091-2.264.071-2.95.904l-7.152 8.684a2.548 2.548 0 11-3.586-3.586l8.684-7.152c.833-.686.995-1.874.904-2.95a4.5 4.5 0 016.164-4.164l1.06 1.06a4.5 4.5 0 011.06 4.164z"
      />
    </svg>
  );
}

function IconBolt({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 13.5 10.5 4.5 9 9l7.5-1.5-6.75 9.75L12 14.25 3.75 13.5z"
      />
    </svg>
  );
}

function IconCylinder({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 7.5V18a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18V7.5m18 0A2.25 2.25 0 0018.75 5.25H5.25A2.25 2.25 0 003 7.5m18 0v.243a48.94 48.94 0 01-3 1.032v7.725a48.94 48.94 0 013 1.032V18m0-10.5v.243a48.94 48.94 0 00-3 1.032v7.725a48.94 48.94 0 003 1.032M3 7.5v.243a48.94 48.94 0 013 1.032v7.725a48.94 48.94 0 00-3 1.032M18.75 5.25H5.25A2.25 2.25 0 003 7.5m15.75 0A2.25 2.25 0 0118.75 9v10.5"
      />
    </svg>
  );
}

function IconSparkles({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.847a4.5 4.5 0 003.09 3.09L15.75 12l-2.847.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423L16.5 15l.394 1.183a2.25 2.25 0 001.423 1.423L19.5 18.75l-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
    </svg>
  );
}

function IconCheck({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function IconChevron({ className, down }: { className?: string; down?: boolean }) {
  return (
    <svg
      className={cn(className, down ? "rotate-0" : "-rotate-90")}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function stepRowIconForHeading(heading: string): ReactNode {
  const h = heading.toLowerCase();
  if (h.includes("knowledge") || h.includes("retrieve")) {
    return <IconCylinder className="h-3.5 w-3.5 text-slate-500" />;
  }
  if (h.includes("memory")) {
    return <IconCylinder className="h-3.5 w-3.5 text-slate-500" />;
  }
  if (h.includes("tool")) {
    return <IconWrench className="h-3.5 w-3.5 text-slate-500" />;
  }
  if (h.includes("llm") || h.includes("generation")) {
    return <IconSparkles className="h-3.5 w-3.5 text-[#0F7C8C]" />;
  }
  if (h.includes("start")) {
    return <IconBolt className="h-3.5 w-3.5 text-amber-500" />;
  }
  return <IconSparkles className="h-3.5 w-3.5 text-slate-400" />;
}

/** Drop agent-style numbered questionnaire tails (e.g. lines starting with `1.`) so we can show one question per bubble. */
function stripNumberedQuestionnaireSuffix(text: string): string {
  const lines = text.split(/\n/);
  const firstNumberedIdx = lines.findIndex((line) => {
    const t = line.trim();
    return /^\d+\.[\s\t]/.test(t) || /^\d+[\).]\s/.test(t);
  });
  if (firstNumberedIdx === -1) return text.trim();
  return lines.slice(0, firstNumberedIdx).join("\n").trim();
}

/**
 * When the model puts the first question in `assistantText` and numbered choices below `1.`,
 * stripped intro text matches `mapped[0].prompt`. Appending both would duplicate the same bubble.
 */
function assistantIntroAlreadyContainsFirstQuestion(introStripped: string, firstPrompt: string): boolean {
  const intro = introStripped.trim();
  const q = firstPrompt.trim();
  if (!q) return true;
  if (!intro) return false;
  const ni = intro.replace(/\s+/g, " ");
  const nq = q.replace(/\s+/g, " ");
  return ni === nq || ni.endsWith(nq);
}

function humanizeBenefitType(raw: string): string {
  const map: Record<string, string> = {
    grant: "Grant",
    loan: "Loan",
    tax_credit: "Tax credit",
    procurement: "Procurement",
    technical_assistance: "Technical assistance",
    real_estate: "Real estate",
    other: "Other",
  };
  const t = raw.trim();
  if (map[t]) return map[t];
  return t
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Options we no longer show (legacy model output may still include them). */
function shouldOmitNumberedChoiceLabel(label: string): boolean {
  const t = label.trim().toLowerCase();
  if (t.includes("city/county")) return true;
  if (t.includes("specify") && (t.includes("city") || t.includes("county")) && (t.includes("chat") || t.includes("type"))) {
    return true;
  }
  return false;
}

/** Build button choices from "1. Option" / "2) Option" lines inside a follow-up string. */
function parseNumberedChoicesFromFollowUp(q: string, idx: number): StructuredFollowUp | null {
  const lines = q.split(/\n/).map((l) => l.trim());
  const choices: string[] = [];
  const promptLines: string[] = [];

  for (const line of lines) {
    if (!line) continue;
    const m =
      line.match(/^\d+\.[\s\t]+(.+)/) ??
      line.match(/^\d+[\).]\s+(.+)/);
    if (m) {
      const label = m[1].trim();
      if (label) choices.push(label);
    } else if (choices.length === 0) {
      promptLines.push(line);
    }
  }

  const filteredLabels = choices.filter((label) => !shouldOmitNumberedChoiceLabel(label));
  if (filteredLabels.length < 2) return null;

  const prompt =
    promptLines.join("\n").trim() ||
    "Please select one:";
  const promptOneLine = promptLines.join(" ").replace(/\s+/g, " ").trim();

  return {
    id: `parsed_followup_${idx}`,
    prompt,
    choices: filteredLabels.map((label, i) => ({
      label,
      value: `parsed_${idx}_${i}`,
      sendAs: promptOneLine ? `${promptOneLine} — ${label}` : label,
    })),
  };
}

function inferStructuredFollowUpFallback(q: string, idx: number): StructuredFollowUp {
  const lower = q.toLowerCase();

  if (
    lower.includes("assistance") ||
    (lower.includes("choose") && (lower.includes("funding") || lower.includes("incentive")))
  ) {
    return {
      id: `assistance_type_${idx}`,
      prompt: "What kind of assistance do you need most right now? Choose one:",
      choices: [
        { label: "Funding", value: "funding", sendAs: "Assistance type: funding" },
        { label: "Incentives", value: "incentives", sendAs: "Assistance type: incentives" },
        { label: "Procurement", value: "procurement", sendAs: "Assistance type: procurement" },
        {
          label: "Technical assistance",
          value: "technical_assistance",
          sendAs: "Assistance type: technical assistance",
        },
        { label: "Real estate", value: "real_estate", sendAs: "Assistance type: real estate" },
        { label: "Other", value: "other", sendAs: "Assistance type: other" },
      ],
    };
  }

  if (lower.includes("use case") || lower.includes("picks the program category")) {
    return {
      id: `use_case_${idx}`,
      prompt: "Pick the use case:",
      choices: [
        { label: "Loans", value: "loans", sendAs: "Use case: loans" },
        { label: "Grants", value: "grants", sendAs: "Use case: grants" },
        {
          label: "Procurement support",
          value: "procurement_support",
          sendAs: "Use case: procurement support",
        },
        {
          label: "Technical assistance",
          value: "technical_assistance",
          sendAs: "Use case: technical assistance",
        },
        {
          label: "Real estate help",
          value: "real_estate_help",
          sendAs: "Use case: real estate help",
        },
      ],
    };
  }

  if (lower.includes("stage") && (lower.includes("idea") || lower.includes("mvp") || lower.includes("revenue"))) {
    return {
      id: `stage_${idx}`,
      prompt: "What stage is your business in?",
      choices: [
        { label: "Idea", value: "idea", sendAs: "Stage: idea" },
        { label: "MVP", value: "mvp", sendAs: "Stage: mvp" },
        { label: "Revenue", value: "revenue", sendAs: "Stage: revenue" },
        { label: "Growth", value: "growth", sendAs: "Stage: growth" },
      ],
    };
  }

  if (lower.includes("timeline") || lower.includes("when") || lower.includes("how soon")) {
    return {
      id: `timeline_${idx}`,
      prompt: "What’s your timeline?",
      choices: [
        { label: "0–3 months", value: "0_3_months", sendAs: "Timeline: 0–3 months" },
        { label: "3–6 months", value: "3_6_months", sendAs: "Timeline: 3–6 months" },
        { label: "6–12 months", value: "6_12_months", sendAs: "Timeline: 6–12 months" },
        { label: "12+ months", value: "12_plus_months", sendAs: "Timeline: 12+ months" },
      ],
    };
  }

  if (lower.includes("county") || lower.includes("city") || lower.includes("where") || lower.includes("located")) {
    return {
      id: `location_${idx}`,
      prompt: "Where in NJ are you located?",
      choices: [
        { label: "North NJ", value: "north_nj", sendAs: "Location: North NJ" },
        { label: "Central NJ", value: "central_nj", sendAs: "Location: Central NJ" },
        { label: "South NJ", value: "south_nj", sendAs: "Location: South NJ" },
        { label: "Not sure", value: "not_sure", sendAs: "Location: not sure" },
      ],
    };
  }

  const safePrompt = extractPlainAssistantFromBlob(q).trim() || q.trim();
  if (looksLikeAdvisorJsonBlob(safePrompt) || safePrompt.startsWith("{")) {
    return {
      id: `followup_${idx}`,
      prompt: "Choose the option that fits best:",
      choices: [
        { label: "Yes", value: "yes", sendAs: `Follow-up ${idx + 1}: yes` },
        { label: "No", value: "no", sendAs: `Follow-up ${idx + 1}: no` },
        { label: "Not sure", value: "not_sure", sendAs: `Follow-up ${idx + 1}: not sure` },
      ],
    };
  }
  return {
    id: `followup_${idx}`,
    prompt: safePrompt,
    choices: [
      { label: "Yes", value: "yes", sendAs: `Q: ${safePrompt}\nA: yes` },
      { label: "No", value: "no", sendAs: `Q: ${safePrompt}\nA: no` },
      { label: "Not sure", value: "not_sure", sendAs: `Q: ${safePrompt}\nA: not sure` },
    ],
  };
}

/**
 * When the agent puts numbered questions in assistant prose but followUps[] is empty or malformed,
 * recover the actual lines (e.g. "1. Are you registered...?").
 */
function extractNumberedQuestionsFromAssistant(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\n/)) {
    const m = line.match(/^\d+\.[\s\t]+(.+)/) ?? line.match(/^\d+[\).]\s+(.+)/);
    if (m?.[1]?.trim()) out.push(m[1].trim());
  }
  return out;
}

/** Model/UI fallbacks that are not real questions — treat as missing and recover or substitute. */
function isGenericFollowUpPlaceholder(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return true;
  if (t === "quick question") return true;
  if (t === "choose the option that fits best:") return true;
  const placeholders = new Set([
    "choose an option below:",
    "choose an option below",
    "choose an option:",
    "choose an option",
    "choose option below:",
    "choose option below",
  ]);
  if (placeholders.has(t)) return true;
  return false;
}

function structuredFollowUpWhenPromptMissing(idx: number): StructuredFollowUp {
  const seed =
    idx === 0
      ? "What kind of assistance do you need? assistance"
      : idx === 1
        ? "What's your timeline? timeline when how soon"
        : "Where in NJ are you located? county city where";
  return inferStructuredFollowUpFallback(seed, idx);
}

/** Prefer agent-numbered options; use heuristics only when parsing fails. */
function mapFollowUpStringToStructured(
  q: string,
  idx: number,
  recovery?: { assistantProse?: string },
): StructuredFollowUp {
  let qClean = unwrapFollowUpListItem(q);
  if (!qClean.trim()) qClean = extractPlainAssistantFromBlob(q).trim();
  if (looksLikeAdvisorJsonBlob(qClean) || (qClean.includes("{") && qClean.includes('"userProfile"'))) {
    qClean = extractPlainAssistantFromBlob(qClean).trim();
  }
  if (!qClean.trim()) {
    const loose = extractFollowUpQuestionLoose(q)?.trim();
    if (loose) qClean = loose;
  }
  if (!qClean.trim() || isGenericFollowUpPlaceholder(qClean)) {
    const fromProse = recovery?.assistantProse
      ? extractNumberedQuestionsFromAssistant(recovery.assistantProse)[idx]
      : "";
    if (fromProse?.trim()) qClean = fromProse.trim();
  }
  if (!qClean.trim() || isGenericFollowUpPlaceholder(qClean)) {
    return structuredFollowUpWhenPromptMissing(idx);
  }
  return parseNumberedChoicesFromFollowUp(qClean, idx) ?? inferStructuredFollowUpFallback(qClean, idx);
}

function newSessionId(): string {
  const rand = Math.random().toString(36).slice(2);
  return `njeda-${Date.now().toString(36)}-${rand}`;
}

function ProgramRecCards({ recs }: { recs: ProgramRecommendation[] }) {
  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Recommended programs
      </div>
      <div className="flex flex-col gap-4">
        {recs.map((r, idx) => (
          <article
            key={`${r.program_url}-${idx}`}
            className="group overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm transition-shadow hover:shadow-md"
          >
            <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{r.title}</div>
                  {r.benefit_type ? (
                    <div className="mt-2 inline-flex items-center rounded-full bg-[#0F7C8C]/10 px-2 py-1 text-xs font-semibold text-[#0F7C8C]">
                      {humanizeBenefitType(r.benefit_type)}
                    </div>
                  ) : null}
                </div>
                <a
                  className="shrink-0 rounded-lg border bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                  href={r.program_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {r.cta_label ?? "View program"}
                </a>
              </div>

              {r.summary ? (
                <p className="mt-2 text-sm leading-6 text-slate-700">{r.summary}</p>
              ) : null}
            </div>

            <div className="p-4">
              {r.who_its_for ? (
                <div className="mb-3 text-sm text-slate-700">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Who it’s for
                  </div>
                  <div className="mt-1">{r.who_its_for}</div>
                </div>
              ) : null}

              {r.why_fit ? (
                <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Why this fits
                  </div>
                  <div className="mt-1">{r.why_fit}</div>
                </div>
              ) : null}

              {r.tags?.length ? (
                <div className={cn("flex flex-wrap gap-2", r.why_fit ? "mt-3" : "")}>
                  {r.tags.slice(0, 6).map((t) => (
                    <span
                      key={t}
                      className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              ) : null}

              {r.eligibility_bullets?.length ? (
                <ul className="mt-3 space-y-1 text-sm text-slate-700">
                  {r.eligibility_bullets.slice(0, 4).map((b, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                      <span className="min-w-0">{b}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="border-t bg-slate-50 p-3">
              <div className="text-xs text-slate-600">
                Source:{" "}
                <a
                  className="font-medium text-slate-800 underline underline-offset-2"
                  href={r.program_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  njeda.gov
                </a>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

type MetricEntry = {
  id: number;
  text: string;
  heading: string;
  status?: string;
  tag?: string;
  meta?: MetricMetaRow[];
};

type OrchestrationStepDisplay = {
  key: string;
  title: string;
  detail: string;
  tag?: string;
  meta?: MetricMetaRow[];
};

function AgentOrchestrationPanel({
  orchestrationDone,
  slow,
  orchestrationExpanded,
  onToggleExpanded,
  steps,
  activeHeading,
  sessionId,
}: {
  orchestrationDone: boolean;
  slow: boolean;
  orchestrationExpanded: boolean;
  onToggleExpanded: () => void;
  steps: OrchestrationStepDisplay[];
  activeHeading?: string;
  sessionId?: string;
}) {
  const headerTitle = orchestrationDone
    ? "I've completed your request"
    : slow
      ? "Still working on it — thanks for your patience"
      : "Working on your request";

  const stepCount = steps.length;

  const activeIdx =
    orchestrationDone || steps.length === 0
      ? -1
      : activeHeading
        ? (() => {
            const i = steps.findIndex((s) => s.key === activeHeading);
            return i >= 0 ? i : steps.length - 1;
          })()
        : steps.length - 1;

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[92%] overflow-hidden rounded-2xl border border-slate-200/70 bg-[#FAFAF8] shadow-sm">
        <button
          type="button"
          onClick={onToggleExpanded}
          className="flex w-full items-center gap-2.5 rounded-full border border-slate-200/80 bg-white px-3.5 py-2.5 text-left shadow-[0_1px_0_rgba(15,23,42,0.04)] transition hover:bg-slate-50/90"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
            <IconWrench className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="line-clamp-1 text-[13px] font-medium leading-snug text-slate-800">{headerTitle}</span>
          </span>
          {stepCount > 0 ? (
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-600">
              {stepCount}
            </span>
          ) : null}
          <span className="flex shrink-0 items-center gap-1.5 text-slate-400">
            <IconChevron className="h-4 w-4" down={orchestrationExpanded} />
            {orchestrationDone ? (
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                <IconCheck className="h-4 w-4" />
              </span>
            ) : null}
          </span>
        </button>

        {orchestrationExpanded ? (
          <div className="mt-2 max-h-[min(42vh,320px)] overflow-y-auto px-1 pb-2 pt-1">
            {steps.length ? (
              <div className="relative pl-2">
                <div
                  className="absolute bottom-2 left-[15px] top-2 w-px bg-gradient-to-b from-slate-200 via-slate-200 to-transparent"
                  aria-hidden
                />
                <ul className="space-y-0">
                  {steps.map((s, idx) => {
                    const isDone = orchestrationDone || (activeIdx >= 0 && idx < activeIdx);
                    const isActive = !orchestrationDone && activeIdx >= 0 && idx === activeIdx;
                    const isPending = !orchestrationDone && activeIdx >= 0 && idx > activeIdx;

                    return (
                      <li key={`${s.key}-${idx}`} className="relative flex gap-3 pb-4 last:pb-0">
                        <div className="relative z-[1] flex shrink-0 flex-col items-center">
                          <span
                            className={cn(
                              "flex h-7 w-7 items-center justify-center rounded-full border bg-white shadow-sm",
                              isDone && "border-emerald-200 bg-emerald-50",
                              isActive && "border-[#0F7C8C]/40 bg-cyan-50/80",
                              isPending && "border-slate-200 bg-slate-50/80",
                            )}
                          >
                            {isDone ? (
                              <IconCheck className="h-3.5 w-3.5 text-emerald-600" />
                            ) : isActive ? (
                              <span className="relative flex h-2 w-2">
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#0F7C8C]/40" />
                                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#0F7C8C]" />
                              </span>
                            ) : (
                              <span className={cn(isPending && "opacity-50")}>{stepRowIconForHeading(s.key)}</span>
                            )}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1 pt-0.5">
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                            <span className="text-[13px] font-semibold text-slate-900">{s.title}</span>
                            {s.tag ? (
                              <span className="rounded-full bg-slate-100/90 px-2 py-0.5 text-[10px] font-medium capitalize text-slate-500">
                                {s.tag}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-0.5 text-[12px] leading-relaxed text-slate-600">{s.detail}</p>
                          {s.meta?.length ? (
                            <dl className="mt-2 space-y-1 rounded-lg border border-slate-200/80 bg-white/80 px-2.5 py-2 text-[10px] leading-snug text-slate-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
                              {s.meta.map((row, mi) => (
                                <div key={`${s.key}-${idx}-${mi}`} className="flex gap-2">
                                  <dt className="w-[4.5rem] shrink-0 font-medium text-slate-500">{row.label}</dt>
                                  <dd className="min-w-0 break-all font-mono text-[10px] text-slate-700">{row.value}</dd>
                                </div>
                              ))}
                            </dl>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              <p className="px-3 py-2 text-[12px] text-slate-500">Waiting for agent steps…</p>
            )}
            {sessionId ? (
              <div
                className={cn(
                  "border-t border-slate-200/80 px-1 pt-2.5 text-[10px] text-slate-500",
                  steps.length ? "mt-3" : "mt-1",
                )}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>
                    <span className="font-semibold text-slate-600">Session</span>{" "}
                    <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-slate-800">
                      {truncateText(sessionId, 44)}
                    </code>
                  </span>
                  <span className="text-slate-400">·</span>
                  <span>Metrics: Lyzr Studio WebSocket (via server)</span>
                  <span className="text-slate-400">·</span>
                  <span className="text-slate-500">API keys stay on the server</span>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export type ProgramAdvisorProps = {
  variant?: "floating" | "panel";
  defaultOpen?: boolean;
};

export function ProgramAdvisor({ variant = "floating", defaultOpen = false }: ProgramAdvisorProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [sessionId, setSessionId] = useState<string>("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [recs, setRecs] = useState<ProgramRecommendation[] | null>(null);
  const [structuredFollowUps, setStructuredFollowUps] = useState<StructuredFollowUp[] | null>(
    null,
  );
  const [structuredIdx, setStructuredIdx] = useState(0);
  const [userProfile, setUserProfile] = useState<ApiResponse["userProfile"] | null>(null);
  const followUpPendingRef = useRef<string[]>([]);
  const [pipeline, setPipeline] = useState<Record<PipelineStepId, { done: boolean; active: boolean }>>({
    understand: { done: false, active: false },
    retrieve: { done: false, active: false },
    rank: { done: false, active: false },
    followups: { done: false, active: false },
    format: { done: false, active: false },
  });
  const [lastMetric, setLastMetric] = useState<string | null>(null);
  const [metricsEntries, setMetricsEntries] = useState<MetricEntry[]>([]);
  const metricIdRef = useRef(0);
  const [orchestrationExpanded, setOrchestrationExpanded] = useState(true);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const metricsRef = useRef<EventSource | null>(null);

  useEffect(() => {
    setSessionId(newSessionId());
  }, []);

  useEffect(() => {
    // Connect to server-bridged metrics stream (which connects upstream to:
    // wss://metrics.studio.lyzr.ai/ws/{sessionId}?x-api-key=...).
    // We only keep it open while the modal is open.
    if (!open || !sessionId) return;

    // Reset for each session open (or session change).
    setLastMetric(null);
    setMetricsEntries([]);
    metricIdRef.current = 0;
    setPipeline({
      understand: { done: false, active: false },
      retrieve: { done: false, active: false },
      rank: { done: false, active: false },
      followups: { done: false, active: false },
      format: { done: false, active: false },
    });

    try {
      metricsRef.current?.close();
    } catch {
      /* ignore */
    }

    const es = new EventSource(`/api/metrics?sessionId=${encodeURIComponent(sessionId)}`);
    metricsRef.current = es;

    const mark = (id: PipelineStepId, state: Partial<{ done: boolean; active: boolean }>) => {
      setPipeline((p) => ({
        ...p,
        [id]: {
          done: state.done ?? p[id].done,
          active: state.active ?? p[id].active,
        },
      }));
    };

    const deactivateAll = () => {
      setPipeline((p) => ({
        understand: { ...p.understand, active: false },
        retrieve: { ...p.retrieve, active: false },
        rank: { ...p.rank, active: false },
        followups: { ...p.followups, active: false },
        format: { ...p.format, active: false },
      }));
    };

    const onMetric = (data: string) => {
      setLastMetric(data);
      const parsed = parseMetricLine(data);
      if (!parsed.heading.trim()) return;
      const id = metricIdRef.current++;
      setMetricsEntries((prev) =>
        [
          ...prev,
          {
            id,
            text: parsed.text,
            heading: parsed.heading,
            status: parsed.status,
            tag: parsed.tag,
            meta: parsed.meta,
          },
        ].slice(-60),
      );
      const lower = data.toLowerCase();

      // Heuristic mapping: we don't assume a strict schema; we infer progress from text.
      // This can be tightened once we see the exact upstream payloads.
      if (lower.includes("intent") || lower.includes("understand") || lower.includes("parse")) {
        deactivateAll();
        mark("understand", { active: true });
      }
      if (lower.includes("retrieve") || lower.includes("kb") || lower.includes("search") || lower.includes("rag")) {
        mark("understand", { done: true, active: false });
        deactivateAll();
        mark("retrieve", { active: true });
      }
      if (lower.includes("score") || lower.includes("rank") || lower.includes("rerank")) {
        mark("retrieve", { done: true, active: false });
        deactivateAll();
        mark("rank", { active: true });
      }
      if (lower.includes("follow") || lower.includes("question")) {
        // follow-ups may happen early or late; don't force ordering too much.
        mark("followups", { active: true });
      }
      if (lower.includes("format") || lower.includes("card") || lower.includes("render")) {
        deactivateAll();
        mark("format", { active: true });
      }
      if (lower.includes("done") || lower.includes("complete") || lower.includes("finished")) {
        deactivateAll();
        setPipeline((p) => ({
          understand: { done: true, active: false },
          retrieve: { done: true, active: false },
          rank: { done: true, active: false },
          followups: { done: p.followups.done || false, active: false },
          format: { done: true, active: false },
        }));
      }
    };

    const messageHandler = (ev: MessageEvent<string>) => onMetric(ev.data);
    const errorHandler = () => {
      // If metrics fails, keep UI usable (we just won't show real-time progress).
      setLastMetric("Metrics stream disconnected.");
    };

    es.onmessage = messageHandler;
    es.onerror = errorHandler;

    return () => {
      es.onmessage = null;
      es.onerror = null;
      try {
        es.close();
      } catch {
        /* ignore */
      }
      if (metricsRef.current === es) metricsRef.current = null;
    };
  }, [open, sessionId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, recs?.length, structuredFollowUps?.length, structuredIdx]);

  const workflowSteps = useMemo(() => {
    // Group websocket events by heading (feature/event_type), keeping first-seen order.
    // Each heading stores the latest status/message.
    const byHeading = new Map<
      string,
      { heading: string; status?: string; text: string; lastId: number; meta?: MetricMetaRow[] }
    >();
    const order: string[] = [];

    for (const e of metricsEntries) {
      const key = e.heading || "step";
      const latestMeta = e.meta && e.meta.length > 0 ? e.meta : undefined;
      if (!byHeading.has(key)) {
        byHeading.set(key, {
          heading: key,
          status: e.status,
          text: e.text,
          lastId: e.id,
          meta: latestMeta,
        });
        order.push(key);
      } else {
        const prev = byHeading.get(key)!;
        byHeading.set(key, {
          ...prev,
          status: e.status,
          text: e.text,
          lastId: e.id,
          meta: latestMeta ?? prev.meta,
        });
      }
    }

    return order
      .map((k) => byHeading.get(k)!)
      .filter((s) => s.heading && (s.text?.trim()?.length ?? 0) > 0);
  }, [metricsEntries]);

  const activeWorkflowHeading = useMemo(() => {
    // Latest in_progress/running step wins.
    for (let i = metricsEntries.length - 1; i >= 0; i--) {
      const st = metricsEntries[i].status?.toLowerCase();
      if (st === "in_progress" || st === "running") return metricsEntries[i].heading;
    }
    return metricsEntries.length ? metricsEntries[metricsEntries.length - 1].heading : undefined;
  }, [metricsEntries]);

  const orchestrationDone = useMemo(() => {
    const last = metricsEntries[metricsEntries.length - 1];
    if (!last) return false;
    const h = (last.heading ?? "").toLowerCase();
    const st = (last.status ?? "").toLowerCase();
    return (
      h.includes("agent_process_end") ||
      h.includes("process_end") ||
      h.endsWith("end") ||
      st === "success" ||
      st === "completed"
    );
  }, [metricsEntries]);

  const orchestrationDisplaySteps = useMemo((): OrchestrationStepDisplay[] => {
    const source =
      workflowSteps.length > 0
        ? workflowSteps
        : metricsEntries.map((e) => ({
            heading: e.heading,
            status: e.status,
            text: e.text,
            lastId: e.id,
            meta: e.meta,
          }));

    return source
      .filter((s) => (s.text?.trim()?.length ?? 0) > 0)
      .map((s) => ({
        key: s.heading,
        title: friendlyOrchestrationTitle(s.heading),
        detail: truncateText(s.text, 180),
        tag: orchestrationSubtleTag(s.heading),
        meta: s.meta,
      }));
  }, [workflowSteps, metricsEntries]);

  const canSend = useMemo(() => input.trim().length > 0 && !busy, [input, busy]);

  const suggestedPrompts = useMemo(
    () => [
      { short: "Business assistance", full: "I’m a small business owner in NJ and I need business assistance." },
      { short: "Funding", full: "I’m a startup founder looking for funding options (grants/loans) in NJ." },
      { short: "Procurement", full: "I’m a vendor—how do I find procurement opportunities in NJ?" },
      { short: "Innovation & tech", full: "I’m a tech startup and I need innovation & technology support (R&D, programs, incentives)." },
      { short: "Tax credits & incentives", full: "I’m looking for incentives/tax credits for creating jobs or investing in NJ." },
    ],
    [],
  );

  const fabRef = useRef<HTMLDivElement | null>(null);

  function onFabHandlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const root = fabRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    root.style.right = "auto";
    root.style.bottom = "auto";
    root.style.left = `${Math.max(0, Math.min(window.innerWidth - rect.width, rect.left))}px`;
    root.style.top = `${Math.max(0, Math.min(window.innerHeight - rect.height, rect.top))}px`;
    let px = e.clientX;
    let py = e.clientY;
    const onMove = (ev: PointerEvent) => {
      ev.preventDefault();
      const dx = ev.clientX - px;
      const dy = ev.clientY - py;
      px = ev.clientX;
      py = ev.clientY;
      const l = root.offsetLeft + dx;
      const t = root.offsetTop + dy;
      const nl = Math.max(0, Math.min(window.innerWidth - root.offsetWidth, l));
      const nt = Math.max(0, Math.min(window.innerHeight - root.offsetHeight, t));
      root.style.left = `${nl}px`;
      root.style.top = `${nt}px`;
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
    document.addEventListener("pointermove", onMove, { passive: false });
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  function formatContextBits(profile: ApiResponse["userProfile"] | null): string[] {
    const contextBits: string[] = [];
    if (profile?.persona) contextBits.push(`persona=${profile.persona}`);
    if (profile?.needs?.length) contextBits.push(`needs=${profile.needs.join(",")}`);
    if (profile?.stage) contextBits.push(`stage=${profile.stage}`);
    if (profile?.location) contextBits.push(`location=${profile.location}`);
    if (profile?.industry?.length && profile.industry[0] !== "Unknown") {
      contextBits.push(`industry=${profile.industry.join(",")}`);
    }
    return contextBits;
  }

  function buildAssistantMessage(
    body: string,
    isFirstTurn: boolean,
    opts?: { discoveryBatchComplete?: boolean },
  ): string {
    const contextBits = formatContextBits(userProfile);
    const firstTurnGuidance = isFirstTurn
      ? [
          "Conversation policy for this session:",
          "- On the first response, ask 2–3 targeted follow-up questions based on the user's query.",
          "- Do NOT ask for persona/need/stage/location if the user already stated them in the query.",
          "- Do NOT recommend programs until after the user answers the follow-up questions.",
          "- Keep follow-up questions non-redundant and specific (e.g., amount, timeline, county, eligibility constraint).",
        ].join("\n")
      : "";
    const phaseBHint =
      opts?.discoveryBatchComplete === true
        ? "\n\nThe user finished the guided tap-to-answer discovery for this turn. Merge their answers into userProfile and respond with Phase B JSON only: exactly 3 items in recommendations, followUps must be an empty array []."
        : "";
    return [
      body,
      firstTurnGuidance ? `\n\n${firstTurnGuidance}` : "",
      phaseBHint,
      contextBits.length > 0 ? `\n\nContext (already provided): ${contextBits.join(" | ")}` : "",
    ]
      .join("")
      .trim();
  }

  function applyChatResponse(data: ApiResponse) {
    if (!data.ok && data.error) {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: `I hit an issue calling the advisor service: ${data.error}`,
        },
      ]);
      return;
    }

    if (process.env.NODE_ENV === "development" && data.diagnostics) {
      console.info("[Program Advisor] /api/chat diagnostics:", data.diagnostics);
    }

    let assistantText =
      typeof data.assistantText === "string" ? extractPlainAssistantFromBlob(data.assistantText) : "";

    if (assistantText.trim().startsWith("{")) {
      try {
        const j = JSON.parse(assistantText) as { assistantText?: string; assistant_text?: string };
        const inner = j.assistantText ?? j.assistant_text;
        if (typeof inner === "string" && inner.trim()) {
          assistantText = extractPlainAssistantFromBlob(inner);
        }
      } catch {
        /* ignore */
      }
    }
    if (assistantText.trim().startsWith("{") || looksLikeAdvisorJsonBlob(assistantText)) {
      assistantText = "";
    }

    if (data.followUps?.length) {
      followUpPendingRef.current = [];
      const mapped = data.followUps
        .slice(0, 3)
        .map((q, i) => mapFollowUpStringToStructured(q, i, { assistantProse: assistantText }));
      const introOnly = stripNumberedQuestionnaireSuffix(assistantText);
      const fallbackIntro =
        "To tailor recommendations, I have a few quick questions.";
      const firstPrompt = mapped[0]?.prompt?.trim() ?? "";
      const introTrim = introOnly.trim();
      const introForUi = looksLikeAdvisorJsonBlob(introTrim) ? fallbackIntro : introTrim;

      setMessages((m) => {
        const additions: ChatMessage[] = [];
        if (firstPrompt && assistantIntroAlreadyContainsFirstQuestion(introForUi, firstPrompt)) {
          additions.push({
            role: "assistant",
            content: introForUi.length > 0 ? introForUi : firstPrompt,
          });
        } else if (firstPrompt) {
          additions.push({ role: "assistant", content: introForUi || fallbackIntro });
          additions.push({ role: "assistant", content: firstPrompt });
        } else {
          additions.push({ role: "assistant", content: introForUi || fallbackIntro });
        }
        return [...m, ...additions];
      });
      setStructuredFollowUps(mapped);
      setStructuredIdx(0);
    } else if (assistantText.trim().length > 0) {
      setMessages((m) => [...m, { role: "assistant", content: assistantText }]);
    } else {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: "Here are the best-matching NJEDA programs I found based on what you shared.",
        },
      ]);
    }

    if (data.userProfile) {
      setUserProfile(data.userProfile);
    }

    if (!data.followUps?.length) {
      setStructuredFollowUps(null);
      setStructuredIdx(0);
      followUpPendingRef.current = [];
    }

    if (data.recommendations?.length) {
      setRecs(data.recommendations.slice(0, 3));
    }
  }

  function resetAgentPipelineVisuals() {
    setPipeline((p) => ({
      understand: { done: false, active: true },
      retrieve: { ...p.retrieve, done: false, active: false },
      rank: { ...p.rank, done: false, active: false },
      followups: { ...p.followups, done: false, active: false },
      format: { ...p.format, done: false, active: false },
    }));
    setLastMetric(null);
    setMetricsEntries([]);
    metricIdRef.current = 0;
    setOrchestrationExpanded(true);
  }

  async function sendMessage(payload?: { backendText?: string; displayText?: string }) {
    const raw = (payload?.backendText ?? input).trim();
    if (!raw || busy) return;
    const content = payload?.displayText ?? raw;
    const isFirstTurn = messages.filter((m) => m.role === "user").length === 0;
    setInput("");
    setBusy(true);
    setSlow(false);
    setRecs(null);
    setStructuredFollowUps(null);
    setStructuredIdx(0);
    followUpPendingRef.current = [];
    resetAgentPipelineVisuals();
    setMessages((m) => [...m, { role: "user", content }]);

    try {
      const t = window.setTimeout(() => setSlow(true), 1200);
      const messageToSend = buildAssistantMessage(content, isFirstTurn);
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: messageToSend, sessionId }),
      });
      const data = (await res.json()) as ApiResponse;
      window.clearTimeout(t);
      applyChatResponse(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `Something went wrong: ${msg}` },
      ]);
    } finally {
      setBusy(false);
      setSlow(false);
      setPipeline((p) => ({
        understand: { ...p.understand, active: false },
        retrieve: { ...p.retrieve, active: false },
        rank: { ...p.rank, active: false },
        followups: { ...p.followups, active: false },
        format: { ...p.format, active: false },
      }));
    }
  }

  async function submitFollowUpCompletion(sendAsLines: string[]) {
    if (busy || sendAsLines.length === 0) return;
    setBusy(true);
    setSlow(false);
    setRecs(null);
    resetAgentPipelineVisuals();

    try {
      const t = window.setTimeout(() => setSlow(true), 1200);
      const messageToSend = buildAssistantMessage(sendAsLines.join("\n\n"), false, {
        discoveryBatchComplete: true,
      });
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: messageToSend, sessionId }),
      });
      const data = (await res.json()) as ApiResponse;
      window.clearTimeout(t);
      applyChatResponse(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `Something went wrong: ${msg}` },
      ]);
    } finally {
      setBusy(false);
      setSlow(false);
      setPipeline((p) => ({
        understand: { ...p.understand, active: false },
        retrieve: { ...p.retrieve, active: false },
        rank: { ...p.rank, active: false },
        followups: { ...p.followups, active: false },
        format: { ...p.format, active: false },
      }));
    }
  }

  async function send(override?: string) {
    const raw = (override ?? input).trim();
    return await sendMessage({ backendText: raw, displayText: raw });
  }

  return (
    <>
      {variant === "floating" ? (
        <div
          ref={fabRef}
          className="fixed bottom-6 right-6 z-50 flex items-center gap-1.5"
        >
          <div
            role="button"
            tabIndex={0}
            aria-label="Drag Program Advisor"
            title="Drag"
            onPointerDown={onFabHandlePointerDown}
            className="flex h-11 w-6 cursor-grab select-none items-center justify-center rounded-xl bg-[#0F7C8C]/35 text-xs font-bold tracking-tighter text-white shadow-md active:cursor-grabbing"
          >
            ⋮⋮
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-full bg-[#0F7C8C] text-white shadow-lg hover:bg-[#0d6a78] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#0F7C8C]"
          >
            <span className="flex items-center gap-2 px-4 py-3 text-sm font-semibold">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/15">
                <span className="text-base leading-none">💬</span>
              </span>
              Program Advisor
            </span>
          </button>
        </div>
      ) : null}

      {open ? (
        <div
          className={cn(
            "fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center",
            variant === "panel" && "bg-transparent p-0 sm:p-0",
          )}
          role="dialog"
          aria-modal="true"
        >
          <div
            className={cn(
              "flex w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl",
              variant === "panel"
                ? "h-[100dvh] max-h-[100dvh] max-w-none rounded-none shadow-none"
                : "h-[min(85dvh,820px)] max-h-[min(92dvh,880px)]",
            )}
          >
            <div className="flex shrink-0 items-center justify-between border-b px-5 py-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Program Advisor</div>
                <div className="text-xs text-slate-500">
                  Program recommendations grounded to NJEDA.gov
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setMessages([]);
                    setRecs(null);
                    setStructuredFollowUps(null);
                    setStructuredIdx(0);
                    followUpPendingRef.current = [];
                    setUserProfile(null);
                    setSessionId(newSessionId());
                  }}
                  className="rounded-lg border px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  New session
                </button>
                {variant === "floating" ? (
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-lg border px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Close
                  </button>
                ) : null}
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {messages.filter((m) => m.role === "user").length === 0 ? (
                  <div className="max-h-[38vh] shrink-0 overflow-y-auto border-b bg-gradient-to-b from-slate-50 to-white px-4 py-3 md:max-h-none">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Start with a topic
                    </p>
                    <div className="mt-3 flex flex-col gap-2">
                      {suggestedPrompts.map((p) => (
                        <button
                          key={p.full}
                          type="button"
                          onClick={() => void sendMessage({ backendText: p.full, displayText: p.full })}
                          className="w-full rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 text-left text-sm font-medium text-slate-800 shadow-sm transition hover:border-[#0F7C8C]/40 hover:bg-cyan-50/90 focus:outline-none focus:ring-2 focus:ring-[#0F7C8C]/30 disabled:opacity-50"
                          disabled={busy}
                        >
                          <span className="text-xs font-semibold text-[#0F7C8C]">{p.short}</span>
                          <span className="mt-0.5 block text-xs font-normal leading-snug text-slate-600">
                            {p.full}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-white p-4">
                  <div className="space-y-3">
                    {messages.map((m, idx) => {
                      const lastIdx = messages.length - 1;
                      const showOrchestrationBeforeAssistant =
                        m.role === "assistant" &&
                        idx === lastIdx &&
                        (busy || metricsEntries.length > 0);

                      return (
                        <Fragment key={idx}>
                          {showOrchestrationBeforeAssistant ? (
                            <AgentOrchestrationPanel
                              orchestrationDone={orchestrationDone}
                              slow={slow}
                              orchestrationExpanded={orchestrationExpanded}
                              onToggleExpanded={() => setOrchestrationExpanded((v) => !v)}
                              steps={orchestrationDisplaySteps}
                              activeHeading={activeWorkflowHeading}
                              sessionId={sessionId}
                            />
                          ) : null}
                          <div
                            className={cn(
                              "flex",
                              m.role === "user" ? "justify-end" : "justify-start",
                            )}
                          >
                            <div
                              className={cn(
                                "max-w-[92%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm leading-6",
                                m.role === "user"
                                  ? "bg-[#0B2E4D] text-white"
                                  : "bg-slate-100 text-slate-900",
                              )}
                            >
                              {m.role === "assistant" ? safeUiAssistantLine(m.content) : m.content}
                            </div>
                          </div>
                        </Fragment>
                      );
                    })}

                    {busy &&
                    messages.length > 0 &&
                    messages[messages.length - 1]?.role === "user" ? (
                      <AgentOrchestrationPanel
                        orchestrationDone={orchestrationDone}
                        slow={slow}
                        orchestrationExpanded={orchestrationExpanded}
                        onToggleExpanded={() => setOrchestrationExpanded((v) => !v)}
                        steps={orchestrationDisplaySteps}
                        activeHeading={activeWorkflowHeading}
                        sessionId={sessionId}
                      />
                    ) : null}

                    {structuredFollowUps?.length ? (
                      <div className="rounded-2xl border bg-white p-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Quick questions
                        </div>
                        <div className="mt-3">
                          <div className="text-sm font-semibold text-slate-900">
                            {safeUiFollowUpPrompt(
                              structuredFollowUps[Math.min(structuredIdx, structuredFollowUps.length - 1)]
                                ?.prompt ?? "",
                            )}
                          </div>
                          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {structuredFollowUps[
                              Math.min(structuredIdx, structuredFollowUps.length - 1)
                            ]?.choices.map((c) => (
                              <button
                                key={`${structuredIdx}-${c.value}`}
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  if (busy) return;
                                  const batch = structuredFollowUps;
                                  if (!batch?.length) return;
                                  const idx = Math.min(structuredIdx, batch.length - 1);
                                  const isLast = idx >= batch.length - 1;
                                  const nextLines = [...followUpPendingRef.current, c.sendAs];
                                  setMessages((m) => {
                                    const next: ChatMessage[] = [
                                      ...m,
                                      { role: "user", content: c.label },
                                    ];
                                    if (!isLast) {
                                  const nextPrompt = safeUiFollowUpPrompt(
                                    batch[idx + 1]?.prompt?.trim() ?? "",
                                  );
                                  if (nextPrompt) {
                                    next.push({ role: "assistant", content: nextPrompt });
                                  }
                                    }
                                    return next;
                                  });
                                  if (!isLast) {
                                    followUpPendingRef.current = nextLines;
                                    setStructuredIdx(idx + 1);
                                    return;
                                  }
                                  followUpPendingRef.current = [];
                                  setStructuredFollowUps(null);
                                  setStructuredIdx(0);
                                  void submitFollowUpCompletion(nextLines);
                                }}
                                className="w-full rounded-xl border border-slate-200/90 bg-white px-3 py-2.5 text-left text-sm font-medium leading-snug text-slate-800 shadow-sm transition hover:border-[#0F7C8C]/50 hover:bg-cyan-50/80 focus:outline-none focus:ring-2 focus:ring-[#0F7C8C]/30 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {c.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {recs?.length && !structuredFollowUps?.length ? (
                      <div className="flex justify-start">
                        <div className="w-full max-w-full rounded-2xl border border-slate-200/80 bg-slate-50/50 p-3">
                          <ProgramRecCards recs={recs} />
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="shrink-0 border-t p-3">
                  <div className="flex gap-2">
                    <textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          send();
                        }
                      }}
                      placeholder="Ask about programs, eligibility, funding…"
                      rows={1}
                      className="flex-1 resize-none rounded-xl border bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-[#0B2E4D]/30 disabled:bg-slate-50"
                      disabled={busy}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        void send();
                      }}
                      disabled={!canSend}
                      className={cn(
                        "rounded-xl px-4 py-2 text-sm font-semibold text-white",
                        canSend ? "bg-[#0B2E4D] hover:bg-[#0a2741]" : "bg-slate-300",
                      )}
                    >
                      Send
                    </button>
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    Tip: include business type, NJ location, stage, and what you need. (Shift+Enter for a new line.)
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

