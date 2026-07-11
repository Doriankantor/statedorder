// ============================================================================
// scrape-portfolio.mjs — Kantor Consulting / "The Stated Order"
// ----------------------------------------------------------------------------
// Crawls the Kantor site (Briefing Room + Portfolio), extracts each article's
// title, link and date, scans the text for country + external-actor mentions,
// and writes  publications.generated.js  — the data file the map reads.
//
// Add a new article on the site, re-run this script, and new map lines appear.
//
// REQUIREMENTS: Node.js 18 or newer (uses the built-in fetch — no npm installs).
//
// RUN:
//   node scrape-portfolio.mjs                 # writes ./publications.generated.js
//   node scrape-portfolio.mjs --out data.js   # custom output path
//   node scrape-portfolio.mjs --limit 40      # cap number of articles fetched
//   node scrape-portfolio.mjs --dry           # print to console, don't write
//
// Then drop publications.generated.js next to "The Stated Order.html" and the
// map picks it up automatically (the HTML already loads it if present).
// ============================================================================

import { writeFile } from 'node:fs/promises';

// ---------------------------------------------------------------------------
// 1. WHERE TO LOOK. Index/listing pages the crawler reads to discover article
//    links. Add or remove URLs freely.
// ---------------------------------------------------------------------------
const INDEX_PAGES = [
  'https://www.kantor-consulting.com/briefingroom',
  'https://portfolio.kantor-consulting.com',
  'https://www.kantor-consulting.com/',
];

// A link is treated as an article if its URL matches ANY of these patterns.
const ARTICLE_URL_PATTERNS = [
  /\/briefingroom\/[a-z0-9-]+/i,
  /portfolio\.kantor-consulting\.com\/[a-z0-9-]+/i,
];

// Don't fetch these (listing roots, tag pages, etc.)
const SKIP_URL_PATTERNS = [
  /\/briefingroom\/?$/i,
  /\/(cart|contact|team|services|media|newsletter|areas-of-analysis)/i,
  /\?/,
];

// ---------------------------------------------------------------------------
// 2. DICTIONARIES. Keys on the left MUST match the country names the map uses
//    (the world-atlas TopoJSON names). Values are lowercase search terms —
//    add demonyms, capitals, leaders, anything that signals the topic.
// ---------------------------------------------------------------------------
const COUNTRY_TERMS = {
  'Colombia':                 ['colombia', 'colombian', 'bogot', 'de la espriella', 'petro', 'cepeda', 'eln', 'farc'],
  'Venezuela':                ['venezuela', 'venezuelan', 'caracas', 'maduro', 'chavist', 'pdvsa'],
  'Mexico':                   ['mexico', 'mexican', 'sheinbaum', 'cartel', 'sinaloa'],
  'Brazil':                   ['brazil', 'brazilian', 'lula', 'brasilia', 'bolsonaro'],
  'Argentina':                ['argentina', 'argentine', 'milei', 'buenos aires'],
  'Chile':                    ['chile', 'chilean', 'santiago', 'boric'],
  'Peru':                     ['peru', 'peruvian', 'lima'],
  'Ecuador':                  ['ecuador', 'ecuadorian', 'noboa', 'quito'],
  'Bolivia':                  ['bolivia', 'bolivian', 'la paz'],
  'Cuba':                     ['cuba', 'cuban', 'havana'],
  'Nicaragua':                ['nicaragua', 'nicaraguan', 'ortega', 'managua'],
  'Panama':                   ['panama', 'panamanian', 'panama canal'],
  'United States of America': ['united states', 'u.s.', 'us ', 'american', 'washington', 'trump', 'white house', 'pentagon'],
  'Canada':                   ['canada', 'canadian', 'ottawa'],
  'Ukraine':                  ['ukraine', 'ukrainian', 'kyiv', 'zelensky'],
  'Germany':                  ['germany', 'german', 'berlin'],
  'France':                   ['france', 'french', 'paris'],
  'Spain':                    ['spain', 'spanish', 'madrid'],
  'Hungary':                  ['hungary', 'hungarian', 'orban', 'budapest'],
  'Iran':                     ['iran', 'iranian', 'tehran', 'hormuz'],
  'China':                    ['china', 'chinese', 'beijing', 'xi jinping'],
  'Russia':                   ['russia', 'russian', 'moscow', 'putin', 'kremlin'],
};

// External-actor lenses. These drive the connection LINES on the map.
const ACTOR_TERMS = {
  US:     ['united states', 'u.s.', 'washington', 'trump', 'white house', 'pentagon', 'american'],
  EU:     ['european union', ' eu ', 'brussels', 'european', 'ukraine', 'nato'],
  China:  ['china', 'chinese', 'beijing'],
  Iran:   ['iran', 'iranian', 'tehran'],
  Russia: ['russia', 'russian', 'moscow', 'kremlin'],
};

// ---------------------------------------------------------------------------
// 3. Crawl + parse. (Below here you normally don't need to edit.)
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const OUT = argVal('--out') || 'publications.generated.js';
const LIMIT = parseInt(argVal('--limit') || '60', 10);
const DRY = args.includes('--dry');

function argVal(flag) { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; }

async function getHtml(url) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'KantorMapScraper/1.0' } });
    if (!res.ok) { console.error(`  ! ${res.status} ${url}`); return ''; }
    return await res.text();
  } catch (e) { console.error(`  ! fetch failed ${url}: ${e.message}`); return ''; }
}

function absolutize(href, base) {
  try { return new URL(href, base).href.split('#')[0]; } catch { return null; }
}

function isArticle(url) {
  if (SKIP_URL_PATTERNS.some((r) => r.test(url))) return false;
  return ARTICLE_URL_PATTERNS.some((r) => r.test(url));
}

function extractLinks(html, base) {
  const out = new Set();
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const abs = absolutize(m[1], base);
    if (abs && isArticle(abs)) out.add(abs);
  }
  return [...out];
}

function meta(html, prop) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i');
  const m = html.match(re);
  return m ? decodeEntities(m[1]) : null;
}

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&#39;/g, '\u2019').replace(/&rsquo;/g, '\u2019')
          .replace(/&lsquo;/g, '\u2018').replace(/&quot;/g, '"').replace(/&mdash;/g, '\u2014')
          .replace(/&nbsp;/g, ' ').replace(/&#8217;/g, '\u2019').replace(/&#8212;/g, '\u2014').trim();
}

function stripTags(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
             .replace(/<style[\s\S]*?<\/style>/gi, ' ')
             .replace(/<[^>]+>/g, ' ')
             .replace(/\s+/g, ' ');
}

function findDate(html) {
  const iso = meta(html, 'article:published_time');
  if (iso) { const d = new Date(iso); if (!isNaN(d)) return fmtDate(d); }
  const text = stripTags(html);
  const m = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/);
  if (m) { const d = new Date(m[0]); if (!isNaN(d)) return fmtDate(d); }
  return '';
}

function fmtDate(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function detect(dict, haystack) {
  const found = [];
  for (const key of Object.keys(dict)) {
    if (dict[key].some((term) => haystack.includes(term))) found.push(key);
  }
  return found;
}

async function main() {
  console.error('The Stated Order — portfolio scraper\n');

  // Discover article links across all index pages.
  const links = new Set();
  for (const idx of INDEX_PAGES) {
    console.error(`Reading index: ${idx}`);
    const html = await getHtml(idx);
    extractLinks(html, idx).forEach((l) => links.add(l));
  }
  const list = [...links].slice(0, LIMIT);
  console.error(`\nFound ${links.size} article links; fetching ${list.length}.\n`);

  const byCountry = {};   // country -> [ {title,url,date,mentions} ]
  const seen = new Set();

  for (const url of list) {
    const html = await getHtml(url);
    if (!html) continue;
    const title = meta(html, 'og:title') || (html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? '').trim();
    if (!title) continue;
    const dedupeKey = title.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const date = findDate(html);
    const hay = (title + ' ' + stripTags(html)).toLowerCase();
    const countries = detect(COUNTRY_TERMS, hay);
    const mentions = detect(ACTOR_TERMS, hay);

    // Attach the article to every country it clearly discusses.
    const homeCountries = countries.filter((c) => c !== 'United States of America') .length
      ? countries : countries; // keep US too if it's the only one
    for (const c of homeCountries) {
      (byCountry[c] ||= []).push({ title: decodeEntities(title), url, date, mentions });
    }
    console.error(`  \u2713 ${title}  [${countries.join(', ') || 'no country'}]  actors:{${mentions.join(',')}}`);
  }

  // Sort each country's publications newest-first (best-effort by parsed date).
  for (const c of Object.keys(byCountry)) {
    byCountry[c].sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  const banner = `// AUTO-GENERATED by scrape-portfolio.mjs on ${new Date().toISOString()}\n// Do not edit by hand — re-run the scraper instead.\n`;
  const body = `window.KANTOR_PUBLICATIONS = ${JSON.stringify(byCountry, null, 2)};\n`;
  const output = banner + body;

  if (DRY) { console.log('\n' + output); return; }
  await writeFile(OUT, output, 'utf8');
  console.error(`\nWrote ${OUT} — ${Object.keys(byCountry).length} countries, ${Object.values(byCountry).flat().length} publications.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
