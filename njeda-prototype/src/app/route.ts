import { NextResponse } from "next/server";

export const runtime = "nodejs";

const UPSTREAM = "https://www.njeda.gov/";

function injectBaseTag(html: string): string {
  if (/<base\s/i.test(html)) return html;
  return html.replace(/<head(\s[^>]*)?>/i, (m) => `${m}<base href="${UPSTREAM}">`);
}

function injectAdvisorScript(html: string): string {
  // NOTE: We inject a small bootstrapper that loads from the current origin.
  // This avoids `<base href="https://www.njeda.gov/">` causing the browser to
  // resolve the script URL against njeda.gov instead of localhost.
  const bootstrapper = [
    "<script>",
    "(function(){",
    "try{",
    "var s=document.createElement('script');",
    // Cache-bust to avoid the browser holding onto older embed versions.
    "s.src=(window.location.origin||'')+'/advisor-embed.js?v='+(Date.now());",
    "s.defer=true;",
    "document.body.appendChild(s);",
    "}catch(e){}",
    "})();",
    "</script>",
  ].join("");

  if (html.includes("advisor-embed.js")) return html;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${bootstrapper}</body>`);
  return `${html}${bootstrapper}`;
}

export async function GET() {
  const upstream = await fetch(UPSTREAM, {
    headers: {
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

