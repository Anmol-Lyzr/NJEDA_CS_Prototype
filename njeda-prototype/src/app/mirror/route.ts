import { NextResponse } from "next/server";

export const runtime = "nodejs";

const UPSTREAM = "https://www.njeda.gov/";

function injectBaseTag(html: string): string {
  if (/<base\s/i.test(html)) return html;
  return html.replace(/<head(\s[^>]*)?>/i, (m) => `${m}<base href="${UPSTREAM}">`);
}

function injectAdvisorScript(html: string): string {
  const scriptTag = `<script src="/advisor-embed.js" defer></script>`;
  if (html.includes(scriptTag)) return html;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${scriptTag}</body>`);
  return `${html}${scriptTag}`;
}

export async function GET() {
  const upstream = await fetch(UPSTREAM, {
    headers: {
      // A light UA to avoid bot blocks in some environments.
      "User-Agent": "Mozilla/5.0 (compatible; NJEDA-Prototype/1.0)",
      Accept: "text/html,application/xhtml+xml",
    },
    cache: "no-store",
  });

  const html = await upstream.text();
  const transformed = injectAdvisorScript(injectBaseTag(html));

  return new NextResponse(transformed, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      "Cache-Control": "no-store",
    },
  });
}

