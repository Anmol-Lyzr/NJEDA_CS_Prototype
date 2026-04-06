export type LyzrChatRequest = {
  user_id: string;
  agent_id: string;
  session_id: string;
  message: string;
};

export type ProgramRecommendation = {
  title: string;
  program_url: string;
  summary?: string;
  who_its_for?: string;
  benefit_type?: string;
  tags?: string[];
  eligibility_bullets?: string[];
  why_fit?: string;
  cta_label?: string;
};

export type UserProfile = {
  persona?: string;
  industry?: string[];
  location?: string;
  stage?: string;
  needs?: string[];
  timeline?: string;
  constraints?: string[];
};

export type AdvisorResponse = {
  assistantText?: string;
  recommendations?: ProgramRecommendation[];
  followUps?: string[];
  userProfile?: UserProfile;
  raw?: unknown;
};

function pickFirstString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const v of value) {
      const s = pickFirstString(v);
      if (s) return s;
    }
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const candidates = [
      obj.assistantText,
      obj.assistant_text,
      obj.message,
      obj.response,
      obj.output,
      obj.answer,
      obj.text,
      obj.content,
      obj.result,
      obj.data,
    ];
    for (const c of candidates) {
      const s = pickFirstString(c);
      if (s) return s;
    }

    // Some upstream payloads nest the assistant string under non-standard keys
    // (e.g. `bot_response`, `final`, `completion`, `choices[0].message.content`).
    // As a last resort, scan object values to find the first plausible string.
    const ignoreKeys = new Set([
      "agent_id",
      "session_id",
      "sessionId",
      "user_id",
      "userId",
      "status",
      "ok",
      "success",
      "timestamp",
      "created_at",
      "updated_at",
    ]);
    const keys = Object.keys(obj).filter((k) => !ignoreKeys.has(k)).slice(0, 60);
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === "string") {
        const t = v.trim();
        if (t) return t;
      }
    }
    for (const k of keys) {
      const s = pickFirstString(obj[k]);
      if (s) return s;
    }
  }
  return undefined;
}

function extractJsonObject(text: string): unknown | undefined {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  let candidate = fenced?.[1] ?? text;
  // Handle unterminated code fences like:
  // ```json
  // { ... }
  // (missing trailing ``` due to model or transport truncation)
  const trimmed = candidate.trimStart();
  if (/^```(?:json)?\s*/i.test(trimmed) && !fenced) {
    candidate = trimmed.replace(/^```(?:json)?\s*/i, "");
  }
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return;
  const jsonText = candidate.slice(firstBrace, lastBrace + 1).trim();
  try {
    return JSON.parse(jsonText);
  } catch {
    return;
  }
}

function tryParseJsonLenient(text: string): unknown | undefined {
  const t = text.trim();
  if (!t) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return extractJsonObject(t);
  }
}

/** Prose before `{`, markdown fences, or minified JSON starting mid-string. */
function normalizeLeadingAdvisorPayload(text: string): string {
  let t = text.replace(/^\uFEFF/, "").trim();
  const fenceFull = t.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/im);
  if (fenceFull?.[1]) t = fenceFull[1].trim();
  // Unterminated fence (common failure mode) — strip just the leading fence marker.
  if (/^```(?:json)?\s*/i.test(t) && !t.includes("```", 3)) {
    t = t.replace(/^```(?:json)?\s*/i, "").trim();
  }
  if (!t.startsWith("{")) {
    const looksLikeAdvisorEnvelope =
      (t.includes('"assistantText"') || t.includes('"assistant_text"')) &&
      (t.includes('"userProfile"') ||
        t.includes('"followUps"') ||
        t.includes('"recommendations"'));
    if (looksLikeAdvisorEnvelope) {
      const fb = t.indexOf("{");
      const lb = t.lastIndexOf("}");
      if (fb >= 0 && lb > fb) t = t.slice(fb, lb + 1);
    }
  }
  return t;
}

function advisorJsonLooksShaped(o: Record<string, unknown>): boolean {
  return (
    "userProfile" in o ||
    "followUps" in o ||
    Array.isArray(o.recommendations)
  );
}

/** Normalize common model typos that break JSON.parse (smart quotes, BOM). */
function normalizeJsonishQuotes(text: string): string {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2018\u2019\u2032]/g, "'");
}

/** Remove trailing commas before } or ] so lenient parses succeed more often. */
function stripTrailingCommasInJsonSlice(jsonSlice: string): string {
  return jsonSlice.replace(/,(\s*[}\]])/g, "$1");
}

function tryParseAdvisorRecord(text: string): Record<string, unknown> | undefined {
  const normalized = normalizeJsonishQuotes(text).trim();
  const attempts = [normalized, stripTrailingCommasInJsonSlice(normalized)];
  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* try next */
    }
  }
  const fb = normalized.indexOf("{");
  const lb = normalized.lastIndexOf("}");
  if (fb < 0 || lb <= fb) return undefined;
  const slice = normalized.slice(fb, lb + 1);
  const sliceAttempts = [slice, stripTrailingCommasInJsonSlice(slice)];
  for (const s of sliceAttempts) {
    try {
      const parsed = JSON.parse(s) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* try next */
    }
  }
  return undefined;
}

/**
 * Detect a serialized Program Advisor envelope (for UI fallbacks).
 * Kept slightly broader than advisorJsonLooksShaped so we never show this blob to users.
 */
export function looksLikeAdvisorJsonBlob(s: string): boolean {
  const t0 = s.trim();
  // Treat fenced JSON blobs as advisor envelopes too (even if fence is unterminated).
  const t = /^```/m.test(t0) ? normalizeLeadingAdvisorPayload(t0) : t0;
  if (t.includes('"userProfile"') && (t.includes('"assistantText"') || t.includes('"assistant_text"'))) return true;
  if (!t.startsWith("{")) {
    // Some transports prepend non-JSON prose before `{` — still treat as advisor JSON if it smells shaped.
    if (
      (t.includes('"assistantText"') || t.includes('"assistant_text"')) &&
      (t.includes('"followUps"') || t.includes('"userProfile"') || t.includes('"recommendations"'))
    ) {
      return true;
    }
    return false;
  }
  return (
    t.includes('"assistantText"') ||
    t.includes('"followUps"') ||
    t.includes('"userProfile"') ||
    t.includes('"recommendations"')
  );
}

/**
 * Recover a single user-facing question line from a string that may be a full advisor JSON blob.
 * Used by follow-up mapping when strict unwrap paths fail.
 */
export function extractFollowUpQuestionLoose(text: string): string | undefined {
  let o = tryParseAdvisorRecord(text);
  if (!o) {
    const j = extractJsonObject(normalizeJsonishQuotes(text));
    if (j && typeof j === "object" && !Array.isArray(j)) o = j as Record<string, unknown>;
  }
  if (!o) return undefined;
  const fu = normalizeFollowUps(o);
  if (fu?.length && typeof fu[0] === "string" && fu[0].trim()) return fu[0].trim();
  const at = o.assistantText ?? o.assistant_text;
  if (typeof at === "string" && at.trim()) return at.trim();
  return undefined;
}

function tryExtractAssistantTextLoose(text: string): string | undefined {
  return extractFollowUpQuestionLoose(text);
}

/**
 * If the model returned a JSON envelope as the assistant string, peel until we get plain prose.
 * Handles BOM, strict parse failures, and brace slicing for messy upstream payloads.
 */
export function stripAdvisorJsonEnvelope(text: string): string {
  let t = normalizeLeadingAdvisorPayload(normalizeJsonishQuotes(text));
  for (let i = 0; i < 10; i++) {
    if (!t.startsWith("{") && !t.startsWith("[")) break;

    let parsed: unknown = tryParseJsonLenient(t);
    if (parsed === undefined || parsed === null) {
      const fb = t.indexOf("{");
      const lb = t.lastIndexOf("}");
      if (fb >= 0 && lb > fb) {
        const slice = stripTrailingCommasInJsonSlice(t.slice(fb, lb + 1));
        try {
          parsed = JSON.parse(slice);
        } catch {
          break;
        }
      } else {
        break;
      }
    }

    if (parsed === undefined || parsed === null) break;

    if (Array.isArray(parsed) && parsed.length > 0) {
      const first = parsed[0];
      if (first && typeof first === "object") {
        const o = first as Record<string, unknown>;
        const inner =
          (typeof o.assistantText === "string" && o.assistantText.trim()) ||
          (typeof o.assistant_text === "string" && o.assistant_text.trim());
        if (inner && inner !== t) {
          t = inner;
          continue;
        }
      }
      break;
    }

    if (typeof parsed !== "object") break;
    const o = parsed as Record<string, unknown>;
    const inner =
      (typeof o.assistantText === "string" && o.assistantText.trim()) ||
      (typeof o.assistant_text === "string" && o.assistant_text.trim());
    if (!inner) break;
    if (inner === t) break;
    t = inner;
  }

  if (t.startsWith("{")) {
    const parsed = tryParseJsonLenient(t);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const o = parsed as Record<string, unknown>;
      if (advisorJsonLooksShaped(o)) {
        const inner =
          (typeof o.assistantText === "string" && o.assistantText.trim()) ||
          (typeof o.assistant_text === "string" && o.assistant_text.trim());
        if (inner) {
          if (inner !== t && !inner.startsWith("{")) return inner;
          if (inner !== t && inner.startsWith("{")) return stripAdvisorJsonEnvelope(inner);
        }
        const fu = normalizeFollowUps(o);
        if (fu?.length && typeof fu[0] === "string" && fu[0].trim()) {
          return fu[0].trim();
        }
        return "";
      }
    }
  }
  if (looksLikeAdvisorJsonBlob(t)) {
    const recovered = tryExtractAssistantTextLoose(t);
    if (recovered) return recovered;
    return "";
  }
  return t;
}

/**
 * Last-resort display string: never show a raw advisor JSON blob in the UI.
 */
export function extractPlainAssistantFromBlob(text: string): string {
  return stripAdvisorJsonEnvelope(text);
}

/** Chat bubble line: never surface a full advisor JSON envelope to the user. */
export function safeUiAssistantLine(raw: string): string {
  const cleaned = extractPlainAssistantFromBlob(raw);
  if (looksLikeAdvisorJsonBlob(cleaned) || looksLikeAdvisorJsonBlob(raw)) {
    return "Use the quick questions below to continue.";
  }
  return cleaned || raw;
}

/** Quick-questions heading: never show stringified JSON above the choice buttons. */
export function safeUiFollowUpPrompt(raw: string): string {
  const cleaned = extractPlainAssistantFromBlob(raw);
  if (looksLikeAdvisorJsonBlob(cleaned) || looksLikeAdvisorJsonBlob(raw)) {
    return "Quick question";
  }
  return cleaned.trim() || "Quick question";
}

/**
 * A followUps[] entry sometimes contains the entire advisor JSON object — extract the first real question.
 * Uses the same lenient parsing as stripAdvisorJsonEnvelope so we do not return "" when JSON has trailing commas etc.
 */
export function unwrapFollowUpListItem(s: string): string {
  let t = s.replace(/^\uFEFF/, "").trim();
  if (!t.startsWith("{") && t.includes("{")) {
    t = normalizeLeadingAdvisorPayload(t);
  }
  if (!t.startsWith("{")) return s;

  const o = tryParseAdvisorRecord(t);
  if (o) {
    const fu = normalizeFollowUps(o);
    if (fu?.length && typeof fu[0] === "string" && fu[0].trim()) {
      return fu[0].trim();
    }
    const at =
      (typeof o.assistantText === "string" && o.assistantText.trim()) ||
      (typeof o.assistant_text === "string" && o.assistant_text.trim());
    if (at) return at;
  }
  const loose = extractFollowUpQuestionLoose(t);
  return loose ?? "";
}

/** When Lyzr nests JSON in data/response/message fields, recover the advisor object. */
function tryAdvisorJsonFromRaw(raw: unknown): unknown | undefined {
  if (!raw) return undefined;
  if (typeof raw === "string") return extractJsonObject(raw);
  if (typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  if (
    Array.isArray(obj.followUps) ||
    Array.isArray(obj.recommendations) ||
    typeof obj.assistantText === "string" ||
    typeof obj.assistant_text === "string"
  ) {
    return obj;
  }

  // Fast-path common nesting keys first.
  for (const k of ["data", "result", "output", "response", "answer", "message", "content", "completion"]) {
    const v = obj[k];
    if (typeof v === "string") {
      const j = extractJsonObject(v);
      if (j && typeof j === "object") return j;
    }
    if (v && typeof v === "object") {
      const inner = v as Record<string, unknown>;
      if (
        Array.isArray(inner.followUps) ||
        Array.isArray(inner.recommendations) ||
        typeof inner.assistantText === "string" ||
        typeof inner.assistant_text === "string"
      ) {
        return inner;
      }
    }
  }

  // Deep-scan: upstream payloads vary (arrays, nested objects, JSON strings).
  // Find the first plausible advisor envelope (bounded depth/size).
  const seen = new Set<unknown>();
  const looksLikeEnvelope = (o: Record<string, unknown>): boolean => {
    return (
      Array.isArray(o.followUps) ||
      Array.isArray(o.recommendations) ||
      typeof o.assistantText === "string" ||
      typeof o.assistant_text === "string" ||
      typeof o.follow_ups === "string" ||
      typeof o.followups === "string"
    );
  };

  function scan(node: unknown, depth: number): unknown | undefined {
    if (!node || depth > 10) return undefined;
    if (seen.has(node)) return undefined;
    if (typeof node === "object") seen.add(node);

    if (typeof node === "string") {
      const t = node.trim();
      if (t.length === 0 || t.length > 200_000) return undefined;
      const j = extractJsonObject(t);
      if (j && typeof j === "object" && !Array.isArray(j)) {
        const o = j as Record<string, unknown>;
        if (looksLikeEnvelope(o)) return o;
      }
      return undefined;
    }

    if (Array.isArray(node)) {
      for (let i = 0; i < Math.min(node.length, 40); i++) {
        const found = scan(node[i], depth + 1);
        if (found) return found;
      }
      return undefined;
    }

    if (typeof node !== "object") return undefined;
    const o = node as Record<string, unknown>;
    if (looksLikeEnvelope(o)) return o;

    // Prefer scanning likely payload keys first, then the rest.
    const preferredKeys = [
      "data",
      "result",
      "output",
      "response",
      "answer",
      "message",
      "content",
      "completion",
      "choices",
      "payload",
      "body",
    ];
    const keys = [
      ...preferredKeys.filter((k) => k in o),
      ...Object.keys(o).filter((k) => !preferredKeys.includes(k)).slice(0, 80),
    ];
    for (const k of keys) {
      const found = scan(o[k], depth + 1);
      if (found) return found;
    }
    return undefined;
  }

  return scan(raw, 0);
}

/**
 * Split one assistant blob that contains multiple "question + numbered options" blocks (agent error / prose mode).
 */
export function splitBundledFollowUpProse(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let buf: string[] = [];

  function countNumbered(ls: string[]) {
    return ls.filter(
      (l) => /^\s*\d+\.[\s\t]/.test(l) || /^\s*\d+[\).]\s/.test(l),
    ).length;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isOpt = /^\s*\d+\.[\s\t]/.test(line) || /^\s*\d+[\).]\s/.test(line);
    if (isOpt) {
      buf.push(line);
      continue;
    }
    if (line.trim() === "") {
      buf.push(line);
      continue;
    }
    if (buf.length && countNumbered(buf) >= 2) {
      blocks.push(buf.join("\n").trim());
      buf = [line];
    } else {
      buf.push(line);
    }
  }
  if (buf.length) blocks.push(buf.join("\n").trim());
  return blocks
    .filter((b) => countNumbered(b.split("\n")) >= 2)
    .slice(0, 10);
}

/**
 * Avoid duplicating full follow-up prose in the chat bubble when structured buttons exist.
 */
export function assistantTextForDiscoveryUi(assistantText: string, followUps: string[]): string {
  const t = assistantText.trim();
  if (!t || followUps.length === 0) return t;
  const firstQ = followUps[0]?.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";
  if (firstQ.length > 12 && t.includes(firstQ)) {
    const idx = t.indexOf(firstQ);
    if (idx > 8) return t.slice(0, idx).trim().replace(/[\s:–\-]+$/u, "");
  }
  if (t.length > 420) {
    const firstPara = t.split(/\n\n+/)[0]?.trim() ?? t;
    if (firstPara.length > 0 && firstPara.length < t.length) return firstPara;
    const cut = t.slice(0, 380);
    const lastPeriod = cut.lastIndexOf(".");
    if (lastPeriod > 80) return `${cut.slice(0, lastPeriod + 1)}`;
    return `${cut.trim()}…`;
  }
  return t;
}

function pickPreferredAssistantText(maybeJson: unknown): string | undefined {
  if (!maybeJson || typeof maybeJson !== "object") return;
  const obj = maybeJson as Record<string, unknown>;
  const candidates: unknown[] = [
    obj.assistantText,
    obj.assistant_text,
    obj.suggested_response,
    obj.message,
    obj.response,
    obj.answer,
    obj.summary,
    obj.text,
    obj.content,
  ];
  return pickFirstString(candidates);
}

function normalizeFollowUps(value: unknown): string[] | undefined {
  if (!value || typeof value !== "object") return;
  const obj = value as Record<string, unknown>;
  const raw =
    obj.followUps ??
    obj.follow_ups ??
    obj.followups ??
    obj.follow_up_questions ??
    obj.followUpQuestions ??
    obj.questions ??
    obj.next_questions;
  if (Array.isArray(raw)) {
    const items = raw.filter((q): q is string => typeof q === "string" && q.trim().length > 0);
    return items.length ? items : undefined;
  }
  const qSingle = obj.question ?? obj.follow_up_question;
  if (typeof qSingle === "string" && qSingle.trim()) return [qSingle.trim()];
  if (typeof obj.prompt === "string" && obj.prompt.trim()) {
    const p = obj.prompt.trim();
    if (!looksLikeAdvisorJsonBlob(p) && !p.startsWith("{")) return [p];
  }
  return undefined;
}

/**
 * Agents sometimes emit a followUps entry that is itself a stringified JSON object.
 * Expand those into real question strings so the UI never treats JSON as a "prompt".
 */
function flattenFollowUpStrings(items: string[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    let t = item.replace(/^\uFEFF/, "").trim();

    // Upstream sometimes returns followUps as individual JSON-string fragments, e.g.
    // "\"Where in NJ...?\n1. ...\","
    // Strip leading/trailing quotes and trailing commas so downstream parsers can work.
    for (let i = 0; i < 4; i++) {
      const tt = t.trim();
      const strippedTrailingComma = tt.endsWith(",") ? tt.slice(0, -1).trimEnd() : tt;
      const strippedQuotes =
        strippedTrailingComma.length >= 2 &&
        strippedTrailingComma.startsWith('"') &&
        strippedTrailingComma.endsWith('"')
          ? strippedTrailingComma.slice(1, -1)
          : strippedTrailingComma;
      if (strippedQuotes === t) break;
      t = strippedQuotes.trim();
    }

    if (!t.startsWith("{") && t.includes("{")) {
      t = normalizeLeadingAdvisorPayload(t);
    }
    if (t.startsWith("{")) {
      const j = tryParseAdvisorRecord(t);
      if (j) {
        const inner = normalizeFollowUps(j);
        if (inner?.length) {
          out.push(...inner);
          continue;
        }
        const at = pickPreferredAssistantText(j)?.trim();
        if (at) {
          out.push(at);
          continue;
        }
        const loose = extractFollowUpQuestionLoose(t);
        if (loose) {
          out.push(loose);
          continue;
        }
        continue;
      }
      const loose = extractFollowUpQuestionLoose(t);
      if (loose) {
        // If "loose" extraction still looks like an advisor JSON blob, prefer extracting
        // actual question blocks instead of feeding JSON-ish text into the follow-up UI.
        if (!looksLikeAdvisorJsonBlob(loose)) {
          out.push(loose);
          continue;
        }
      }
    }

    // Last-resort recovery: sometimes a followUp item contains a large (possibly malformed)
    // JSON-looking blob that includes one or more "question + numbered options" blocks.
    // Extract those blocks so the UI can render the agent's dynamic options.
    if ((t.includes('"followUps"') || t.includes('"follow_ups"') || t.includes("followUps")) && t.includes("\n1.")) {
      // Common case: we received only the *first* followUp string but wrapped in a JSON fragment like:
      // { ... "followUps": [ "Question?\n1. ...\n2. ..." ,
      // Extract the string content after followUps[0] opening quote.
      const firstFollowUpMatch = t.match(/"followUps"\s*:\s*\[\s*"([\s\S]*?)"\s*$/);
      if (firstFollowUpMatch?.[1]?.trim()) {
        const recovered = firstFollowUpMatch[1].trim();
        if (recovered.includes("\n1.")) {
          out.push(recovered);
          continue;
        }
      }
      const blocks = splitBundledFollowUpProse(t);
      if (blocks.length) {
        out.push(...blocks);
        continue;
      }
    }

    out.push(t);
  }
  return out.slice(0, 10);
}

/** Pull numbered questions from markdown when the agent embeds them in `message` instead of JSON arrays. */
function extractFollowUpsFromMarkdown(text: string): string[] {
  const headers: RegExp[] = [
    /(?:^|\n)\s*\*{0,2}Follow[- ]up questions?\*{0,2}\s*:/im,
    /(?:^|\n)\s*#{1,3}\s*Follow[- ]ups?\b[^\n]*\n/im,
    /(?:^|\n)\s*#{1,3}\s*Follow[- ]up\b([^\n]*)\n/im,
  ];

  for (const headerRe of headers) {
    const match = headerRe.exec(text);
    if (!match) continue;
    const after = text.slice(match.index + match[0].length);
    const block =
      after.split(/\n(?=#{1,3}\s|##\s|Score\b|\*\*Score|\*\*Profile|Note\b)/i)[0] ?? "";
    const out: string[] = [];
    for (const line of block.split("\n")) {
      const m =
        line.match(/^\s*\d+\.[\s\t]+(.+)/) ??
        line.match(/^\s*\d+[\).]\s+(.+)/);
      if (m) out.push(m[1].trim());
    }
    if (out.length) return out.slice(0, 10);
  }
  return [];
}

/** Optional "use case" bullets as quick-reply options (same UX as follow-ups). */
function extractUseCasesFromMarkdown(text: string): string[] {
  const out: string[] = [];
  const header = /(?:^|\n)\s*\*{0,2}Use cases[^:\n]*\*{0,2}\s*:/im;
  const match = header.exec(text);
  if (!match) return out;
  const after = text.slice(match.index + match[0].length);
  const block = after.split(/\n(?:\*\*|##|Note)/i)[0] ?? "";
  for (const line of block.split("\n")) {
    const m = line.match(/^\s*[-*]\s+(.+)/);
    if (m) out.push(m[1].trim());
  }
  return out;
}

function pickIntroOnly(maybeJson: unknown): string | undefined {
  if (!maybeJson || typeof maybeJson !== "object") return;
  const o = maybeJson as Record<string, unknown>;
  const candidates = [o.intro, o.short_reply, o.acknowledgement, o.ack, o.preamble];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim();
  }
  return undefined;
}

/** Remove retrieval score dumps and similar lines that should not appear in the user-facing chat. */
function stripInternalDebugFromAssistant(text: string): string {
  const lines = text.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    if (/^\s*Score:\s*[\d.eE+-]+\s*$/i.test(line)) continue;
    if (/^\s*\*?\*?Score\*?\*?\s*:\s*[\d.eE+-]+\s*$/i.test(line)) continue;
    if (/^\s*#{1,3}\s*Scores?\b/i.test(line)) continue;
    kept.push(line);
  }
  return kept.join("\n").trim();
}

function normalizeUserProfile(value: unknown): UserProfile | undefined {
  if (!value || typeof value !== "object") return;
  const obj = value as Record<string, unknown>;
  const up = obj.userProfile ?? obj.user_profile ?? obj.profile;
  if (!up || typeof up !== "object") return;
  const p = up as Record<string, unknown>;
  const industry = Array.isArray(p.industry)
    ? p.industry.filter((s): s is string => typeof s === "string")
    : undefined;
  const needs = Array.isArray(p.needs) ? p.needs.filter((s): s is string => typeof s === "string") : undefined;
  const constraints = Array.isArray(p.constraints)
    ? p.constraints.filter((s): s is string => typeof s === "string")
    : undefined;
  return {
    persona: typeof p.persona === "string" ? p.persona : undefined,
    industry,
    location: typeof p.location === "string" ? p.location : undefined,
    stage: typeof p.stage === "string" ? p.stage : undefined,
    needs,
    timeline: typeof p.timeline === "string" ? p.timeline : undefined,
    constraints,
  };
}

function normalizeRecommendations(value: unknown): ProgramRecommendation[] | undefined {
  if (!value) return;
  const obj = value as Record<string, unknown>;
  const recs = obj.recommendations ?? obj.programs ?? obj.results ?? obj.items;
  if (!Array.isArray(recs)) return;

  const normalized: ProgramRecommendation[] = [];
  for (const r of recs) {
    if (!r || typeof r !== "object") continue;
    const rr = r as Record<string, unknown>;
    const title = typeof rr.title === "string" ? rr.title : undefined;
    const program_url =
      typeof rr.program_url === "string"
        ? rr.program_url
        : typeof rr.url === "string"
          ? rr.url
          : typeof rr.link === "string"
            ? rr.link
            : undefined;
    if (!title || !program_url) continue;

    normalized.push({
      title,
      program_url,
      summary: typeof rr.summary === "string" ? rr.summary : undefined,
      who_its_for: typeof rr.who_its_for === "string" ? rr.who_its_for : undefined,
      benefit_type: typeof rr.benefit_type === "string" ? rr.benefit_type : undefined,
      why_fit: typeof rr.why_fit === "string" ? rr.why_fit : undefined,
      cta_label: typeof rr.cta_label === "string" ? rr.cta_label : undefined,
      tags: Array.isArray(rr.tags) ? rr.tags.filter((t): t is string => typeof t === "string") : undefined,
      eligibility_bullets: Array.isArray(rr.eligibility_bullets)
        ? rr.eligibility_bullets.filter((t): t is string => typeof t === "string")
        : undefined,
    });
  }

  return normalized.length ? normalized : undefined;
}

export function shapeAdvisorResponse(raw: unknown): AdvisorResponse {
  let assistantText = pickFirstString(raw);
  let maybeJson = assistantText ? extractJsonObject(assistantText) : undefined;
  if (!maybeJson) {
    const fromRaw = tryAdvisorJsonFromRaw(raw);
    if (fromRaw) maybeJson = fromRaw;
  }

  const recommendations = maybeJson ? normalizeRecommendations(maybeJson) : undefined;
  let followUps = maybeJson ? normalizeFollowUps(maybeJson) : undefined;
  if (!followUps?.length && raw && typeof raw === "object") {
    const fromTop = normalizeFollowUps(raw as Record<string, unknown>);
    if (fromTop?.length) followUps = fromTop;
  }
  const userProfile = maybeJson ? normalizeUserProfile(maybeJson) : undefined;

  // If the agent returns JSON (often serialized as a string), prefer a human-facing field.
  // Always replace assistantText when JSON parsed — never leave the unparsed JSON string in assistantText
  // (empty assistantText in JSON is valid; undefined preferred must not fall back to raw JSON).
  if (maybeJson) {
    const preferred = pickPreferredAssistantText(maybeJson);
    assistantText = typeof preferred === "string" ? preferred : "";
    if (!assistantText.trim()) {
      const intro = pickIntroOnly(maybeJson);
      if (intro) assistantText = intro;
    }
  }

  // When follow-ups live only in markdown (no JSON array), extract them for button UI.
  if (!followUps?.length && assistantText) {
    const fromMd = extractFollowUpsFromMarkdown(assistantText);
    const useCases = extractUseCasesFromMarkdown(assistantText);
    const merged = [...fromMd, ...useCases].filter((s) => s.length > 0);
    if (merged.length) {
      followUps = merged.slice(0, 10);
    } else if (assistantText.length > 200) {
      const bundled = splitBundledFollowUpProse(assistantText);
      if (bundled.length >= 2) followUps = bundled;
    }
  }

  if (followUps?.length) {
    followUps = flattenFollowUpStrings(followUps);
    if (followUps.length === 0) followUps = undefined;
  }

  // Keep assistantText during Phase A so the UI can show intro copy above follow-up buttons.
  if (assistantText) {
    assistantText = stripInternalDebugFromAssistant(assistantText);
  }

  if (followUps?.length && assistantText) {
    assistantText = assistantTextForDiscoveryUi(assistantText, followUps);
  }

  assistantText = stripAdvisorJsonEnvelope(assistantText ?? "");

  const directRecs = normalizeRecommendations(raw);
  const mergedRecs = directRecs ?? recommendations;

  // Last-resort: if shaping/JSON peeling produced no user-facing content, recover something safe.
  // This is especially important for generic/meta questions where upstream may return an empty
  // advisor envelope or a nested payload we fail to unwrap cleanly.
  if (
    (!assistantText || assistantText.trim().length === 0) &&
    (!followUps || followUps.length === 0) &&
    (!mergedRecs || mergedRecs.length === 0)
  ) {
    const rawText = pickFirstString(raw) ?? "";
    const recovered = extractPlainAssistantFromBlob(rawText).trim();
    assistantText =
      recovered ||
      "Tell me what you’re trying to accomplish and I’ll recommend NJEDA programs. You can also pick a category to get started.";
  }
  return {
    assistantText,
    recommendations: mergedRecs,
    followUps,
    userProfile,
    raw,
  };
}

