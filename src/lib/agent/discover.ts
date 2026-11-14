import type { AgentSource } from "@/generated/prisma/client";
import type { RawItem } from "./schema";

// Stage 1 — Discover (AG-1, AG-3). Polite fetch: identifies itself, honors robots.txt,
// and spaces requests per domain.

const USER_AGENT = "RiseLocalScout/0.1 (+https://riselocal.app/scout)";
const MIN_DOMAIN_INTERVAL_MS = 2_000;
const lastHit = new Map<string, number>();

async function politeFetch(url: string) {
  const host = new URL(url).host;
  const wait = (lastHit.get(host) ?? 0) + MIN_DOMAIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(host, Date.now());
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Fetch ${url} → ${res.status}`);
  return res;
}

export async function isAllowedByRobots(url: string): Promise<boolean> {
  const u = new URL(url);
  try {
    const res = await fetch(`${u.origin}/robots.txt`, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return true;
    const lines = (await res.text()).split("\n").map((l) => l.trim());
    let applies = false;
    for (const line of lines) {
      const [k, ...rest] = line.split(":");
      const v = rest.join(":").trim();
      if (/^user-agent$/i.test(k)) applies = v === "*" || /riselocal/i.test(v);
      else if (applies && /^disallow$/i.test(k) && v && u.pathname.startsWith(v)) return false;
    }
    return true;
  } catch {
    return true;
  }
}

const stripTags = (html: string) =>
  html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const getPath = (obj: unknown, path?: string) =>
  (path ?? "").split(".").filter(Boolean).reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);

export async function discover(source: Pick<AgentSource, "type" | "url" | "hints">): Promise<RawItem[]> {
  if (!(await isAllowedByRobots(source.url))) throw new Error(`robots.txt disallows ${source.url}`);
  const hints = (source.hints ?? {}) as { itemsPath?: string; urlField?: string };
  const res = await politeFetch(source.url);

  switch (source.type) {
    case "json_api": {
      const data = await res.json();
      const items = (getPath(data, hints.itemsPath) ?? data) as Record<string, unknown>[];
      if (!Array.isArray(items)) throw new Error("json_api source did not return an array (check hints.itemsPath)");
      return items.map((fields) => ({ url: String(fields[hints.urlField ?? "url"] ?? source.url), fields }));
    }
    case "rss": {
      const xml = await res.text();
      const tag = (block: string, name: string) =>
        block.match(new RegExp(`<${name}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`, "i"))?.[1]?.trim();
      return [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].map(([block]) => ({
        url: tag(block, "link") ?? source.url,
        text: stripTags(`${tag(block, "title") ?? ""}\n${tag(block, "description") ?? ""}`),
        fields: { title: tag(block, "title") },
      }));
    }
    case "html":
    default:
      // A careers page → one blob of text; the extractor splits it into job drafts.
      // TODO(P4): use Playwright for JS-rendered sources (hints.render === "js").
      return [{ url: source.url, text: stripTags(await res.text()).slice(0, 50_000) }];
  }
}
