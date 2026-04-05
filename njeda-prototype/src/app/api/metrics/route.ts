import { NextResponse } from "next/server";
import WebSocket from "ws";

export const runtime = "nodejs";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function sseLine(line: string): Uint8Array {
  return new TextEncoder().encode(`${line}\n`);
}

function sseEvent(data: string): Uint8Array {
  // Default SSE event type is "message" (browser uses `onmessage`).
  return new TextEncoder().encode(`data: ${data}\n\n`);
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get("sessionId")?.trim();
    if (!sessionId) {
      return NextResponse.json({ ok: false, error: "Missing sessionId" }, { status: 400 });
    }

    // We reuse the same API key already configured for /api/chat.
    // Do NOT expose it to the browser.
    const apiKey = requireEnv("LYZR_API_KEY");
    const upstreamUrl = `wss://metrics.studio.lyzr.ai/ws/${encodeURIComponent(sessionId)}?x-api-key=${encodeURIComponent(apiKey)}`;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;

        const safeClose = () => {
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
            /* ignore */
          }
        };

        // Initial SSE message (helps debug connectivity).
        controller.enqueue(sseEvent(JSON.stringify({ type: "open", ok: true })));

        const ws = new WebSocket(upstreamUrl);

        const onAbort = () => {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          safeClose();
        };

        // If the client disconnects, stop everything.
        req.signal.addEventListener("abort", onAbort);

        ws.on("open", () => {
          controller.enqueue(sseEvent(JSON.stringify({ type: "ws_open", sessionId })));
        });

        ws.on("message", (data: WebSocket.RawData) => {
          const raw =
            typeof data === "string"
              ? data
              : Buffer.isBuffer(data)
                ? data.toString("utf8")
                : String(data);
          // Forward raw payload as-is; client can parse if it's JSON.
          controller.enqueue(sseEvent(raw));
        });

        ws.on("error", (err: Error) => {
          controller.enqueue(sseEvent(JSON.stringify({ type: "error", error: "Upstream metrics socket error" })));
          controller.enqueue(sseEvent(JSON.stringify({ type: "error_detail", message: String(err) })));
        });

        ws.on("close", () => {
          controller.enqueue(sseEvent(JSON.stringify({ type: "ws_close", sessionId })));
          safeClose();
        });
      },
    });

    return new NextResponse(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

