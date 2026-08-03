import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../auth.js';

const importRequestSchema = z.object({
  url: z.string().url(),
});

const MAX_HTML_CHARS = 550_000;
const MAX_TEXT_CHARS = 45_000;

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '127.0.0.1' || host === '0.0.0.0' || host === '::1') return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  return false;
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function cleanText(value: string): string {
  return decodeBasicEntities(value)
    .replace(/\r/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function htmlToText(html: string): string {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ');

  const withBreaks = withoutScripts
    .replace(/<\/(p|div|section|article|li|tr|h1|h2|h3|h4|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  return cleanText(withBreaks).slice(0, MAX_TEXT_CHARS);
}

function extractTitle(html: string): string | null {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (!title) return null;
  return cleanText(title).slice(0, 140) || null;
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function extractEmails(text: string): string[] {
  return unique(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).slice(0, 10);
}

function extractPhones(text: string): string[] {
  const matches = text.match(/(?:\+?420\s*)?(?:\d[\s.-]?){9,12}/g) ?? [];
  return unique(
    matches
      .map((item) => item.replace(/\s+/g, ' ').trim())
      .filter((item) => item.replace(/\D/g, '').length >= 9)
  ).slice(0, 10);
}

function extractPrices(text: string): string[] {
  const matches = text.match(/(?:od\s*)?\d{2,6}(?:[\s.]*\d{3})?\s*(?:Kč|CZK|,-)/gi) ?? [];
  return unique(matches.map((item) => cleanText(item))).slice(0, 30);
}

function extractOpeningHours(text: string): string[] {
  const lines = text.split('\n').map((line) => cleanText(line)).filter(Boolean);
  const keywords = /(otevírací|otevřeno|provozní|pondělí|úterý|středa|čtvrtek|pátek|sobota|neděle|po\b|út\b|st\b|čt\b|pá\b|so\b|ne\b|zavřeno)/i;
  const timePattern = /\b\d{1,2}[:.]\d{2}\b|\b\d{1,2}\s*[–-]\s*\d{1,2}\b/;
  return unique(lines.filter((line) => keywords.test(line) && timePattern.test(line)).slice(0, 20));
}

function extractAddressCandidates(text: string): string[] {
  const lines = text.split('\n').map((line) => cleanText(line)).filter(Boolean);
  const pattern = /(praha|brno|ostrava|plzeň|liberec|olomouc|české budějovice|ulice|náměstí|třída|č\.p\.|psč|\d{3}\s?\d{2})/i;
  return unique(lines.filter((line) => pattern.test(line) && line.length <= 180).slice(0, 12));
}

function extractServiceCandidates(text: string, prices: string[]): Array<{ name: string; evidence: string; price?: string }> {
  const lines = text.split('\n').map((line) => cleanText(line)).filter((line) => line.length >= 4 && line.length <= 170);
  const serviceKeywords = /(masáž|kosmet|ošetření|barvení|střih|účes|obočí|neht|manik|pedik|čištění|konzultace|servis|diagnostika|terapie|kurz|lekce|balíček)/i;
  const candidates: Array<{ name: string; evidence: string; price?: string }> = [];

  for (const line of lines) {
    const hasServiceWord = serviceKeywords.test(line);
    const price = prices.find((candidate) => line.includes(candidate));
    if (!hasServiceWord && !price) continue;
    const name = line.replace(/\s{2,}/g, ' ').slice(0, 90);
    if (!candidates.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
      candidates.push({ name, evidence: line, price });
    }
    if (candidates.length >= 18) break;
  }

  return candidates;
}

function extractMetaDescription(html: string): string | null {
  const match = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i);
  return match?.[1] ? cleanText(match[1]).slice(0, 260) : null;
}

async function fetchWebsite(url: string): Promise<{ finalUrl: string; html: string; status: number; contentType: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'PragueAIVoiceWebsiteImport/2.1 (+https://prague-ai-voice.local)',
        accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5',
      },
    });
    const contentType = response.headers.get('content-type');
    const raw = await response.text();
    return {
      finalUrl: response.url,
      html: raw.slice(0, MAX_HTML_CHARS),
      status: response.status,
      contentType,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function websiteImportRoute(app: FastifyInstance): Promise<void> {
  app.post('/api/import/website', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;

    const parsed = importRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'invalid_url' });
    }

    const target = new URL(parsed.data.url);
    if (!['http:', 'https:'].includes(target.protocol) || isBlockedHost(target.hostname)) {
      return reply.code(400).send({ ok: false, error: 'blocked_url' });
    }

    try {
      const fetched = await fetchWebsite(target.toString());
      const text = htmlToText(fetched.html);
      const title = extractTitle(fetched.html);
      const metaDescription = extractMetaDescription(fetched.html);
      const emails = extractEmails(text);
      const phones = extractPhones(text);
      const prices = extractPrices(text);
      const openingHours = extractOpeningHours(text);
      const addressCandidates = extractAddressCandidates(text);
      const services = extractServiceCandidates(text, prices);

      const warnings: string[] = [];
      if (!emails.length) warnings.push('Nebyl nalezen žádný e-mail.');
      if (!phones.length) warnings.push('Nebyl nalezen žádný telefon.');
      if (!openingHours.length) warnings.push('Otevírací doba nebyla nalezena spolehlivě.');
      if (!services.length) warnings.push('Služby/ceník nebyly nalezeny spolehlivě.');

      return {
        ok: true,
        mode: 'suggestion_only',
        message: 'Import je pouze návrh. Nic se automaticky neukládá do profilu firmy.',
        source: {
          requestedUrl: target.toString(),
          finalUrl: fetched.finalUrl,
          status: fetched.status,
          contentType: fetched.contentType,
        },
        suggested: {
          title,
          description: metaDescription,
          emails,
          phones,
          prices,
          openingHours,
          addressCandidates,
          services,
        },
        extractedTextPreview: text.slice(0, 1800),
        warnings,
      };
    } catch (error) {
      request.log.warn({ error }, 'website_import_failed');
      return reply.code(502).send({
        ok: false,
        error: 'website_import_failed',
        message: 'Web se nepodařilo načíst nebo zpracovat.',
      });
    }
  });
}
