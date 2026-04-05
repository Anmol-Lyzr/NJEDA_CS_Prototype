import { NextResponse } from "next/server";
import { shapeAdvisorResponse, type LyzrChatRequest } from "@/lib/lyzr";

export const runtime = "nodejs";

function advisorDiagnostics(
  shaped: ReturnType<typeof shapeAdvisorResponse>,
): { followUpCount: number; assistantTextChars: number; note?: string } {
  const fu = shaped.followUps?.length ?? 0;
  const len = shaped.assistantText?.length ?? 0;
  let note: string | undefined;
  if (fu === 0 && len > 500) {
    note =
      "Long assistantText but no followUps array — ensure the agent returns JSON with followUps per kb/00_agent_instructions.md (or check Lyzr response nesting).";
  } else if (fu > 0 && len > 600) {
    note =
      "Large assistantText alongside followUps — intro may be trimmed client-side; prefer short assistantText in agent JSON.";
  }
  return { followUpCount: fu, assistantTextChars: len, note };
}

type ClientChatBody = {
  message: string;
  sessionId: string;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export async function POST(req: Request) {
  try {
    const { message, sessionId } = (await req.json()) as Partial<ClientChatBody>;
    if (!message || !sessionId) {
      return NextResponse.json(
        { error: "Missing message or sessionId" },
        { status: 400 },
      );
    }

    const apiKey = requireEnv("LYZR_API_KEY");
    const agentId = requireEnv("LYZR_AGENT_ID");
    const userId = process.env.LYZR_USER_ID ?? "demo@njeda.prototype";

    const payload: LyzrChatRequest = {
      user_id: userId,
      agent_id: agentId,
      session_id: sessionId,
      message,
    };

    const upstream = await fetch("https://agent-prod.studio.lyzr.ai/v3/inference/chat/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(payload),
    });

    const raw = await upstream.json().catch(async () => ({ text: await upstream.text() }));
    const shaped = shapeAdvisorResponse(raw);

    const isDev = process.env.NODE_ENV === "development";

    return NextResponse.json(
      {
        ok: upstream.ok,
        status: upstream.status,
        ...shaped,
        ...(isDev ? { diagnostics: advisorDiagnostics(shaped) } : {}),
      },
      { status: 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

