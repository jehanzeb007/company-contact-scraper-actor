import { Actor } from 'apify';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { scrapeGoogleMapsPlace } from './scraper.js';
import { buildGoogleMapsCidUrl, searchAndClickMapsPreview, extractCompleteMapUrl } from './discovery.js';
import { buildPuppeteerLaunchOptions } from './browser.js';

puppeteer.use(StealthPlugin());

/** Reflects how the place was resolved — url/cid/placeId beat searchQuery. */
function buildRunSearchString({ url, cid, placeId, searchQuery, targetUrl }) {
  if (url) return url;
  if (cid) return String(cid);
  if (placeId) return placeId;
  if (searchQuery) return searchQuery;
  return targetUrl || null;
}

await Actor.init();
console.log('[browser] Chrome resolver v2 (Apify system Chrome + cache fallback)');

// ── Input ─────────────────────────────────────────────────────────────────────
let input = await Actor.getInput() || {};

const CLI_STRING_KEYS = new Set([
  'url',
  'searchQuery',
  'website',
  'placeId',
  'cid',
  'language',
]);

function parseCliValue(key, valueStr) {
  if (CLI_STRING_KEYS.has(key)) return valueStr;
  if (valueStr.toLowerCase() === 'true') return true;
  if (valueStr.toLowerCase() === 'false') return false;
  if (!Number.isNaN(Number(valueStr)) && valueStr.trim() !== '') return Number(valueStr);
  return valueStr;
}

for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg.startsWith('--')) {
    const [key, ...valueParts] = arg.slice(2).split('=');
    const valueStr = valueParts.join('=');
    if (key && valueStr !== undefined) {
      input[key] = parseCliValue(key, valueStr);
    }
  }
}

if (!input?.url && !input?.searchQuery && !input?.placeId && !input?.cid) {
  throw new Error('Input error: You must provide either a "url", a "searchQuery", a "placeId", or a "cid" via INPUT.json or CLI.');
}

const {
  url,
  searchQuery,
  placeId,
  cid,
  website,
  proxyConfig: proxyInput = { useApifyProxy: false },
  blockAssets = true,
  language = 'en',
  headless = true,
  apiOnly = false,
} = input;

// ── Proxy ─────────────────────────────────────────────────────────────────────
const proxyConfiguration = await Actor.createProxyConfiguration(proxyInput);
const proxyUrl = proxyConfiguration ? await proxyConfiguration.newUrl() : null;

if (proxyUrl) {
  console.log('[proxy] Using Apify proxy pool.');
} else {
  console.log('[proxy] Proxies disabled.');
}

const dataset = await Actor.openDataset();
const kvStore = await Actor.openKeyValueStore();

// ── Browser ───────────────────────────────────────────────────────────────────
const launchArgs = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--lang=en-US,en',
  '--disable-blink-features=AutomationControlled',
];
if (proxyUrl) {
  const parsed = new URL(proxyUrl);
  launchArgs.push(`--proxy-server=${parsed.host}`);
}

const isHeadless = headless === 'shell' ? 'shell' : headless === false || headless === 'false' ? false : true;

const launchOptions = buildPuppeteerLaunchOptions({
  headless: isHeadless,
  args: launchArgs,
  defaultViewport: { width: 1280, height: 900 },
});
console.log(`[browser] Launching Chrome: ${launchOptions.executablePath}`);

const browser = await puppeteer.launch(launchOptions);

let targetUrl = url;
let placeOutput = null;

if (!targetUrl && cid) {
  targetUrl = buildGoogleMapsCidUrl(cid);
  console.log(`[cid] Constructed direct CID URL: ${targetUrl}`);
}

if (!targetUrl && placeId) {
  targetUrl = `https://www.google.com/maps/search/?api=1&query=Place&query_place_id=${placeId}`;
  console.log(`[placeId] Constructed direct Place ID URL: ${targetUrl}`);
}

try {
  const page = await browser.newPage();

  if (proxyUrl) {
    const parsed = new URL(proxyUrl);
    if (parsed.username && parsed.password) {
      await page.authenticate({ username: parsed.username, password: parsed.password });
    }
  }

  await page.setExtraHTTPHeaders({ 'Accept-Language': `${language},en-US;q=0.9,en;q=0.8` });
  await page.setDefaultTimeout(90_000);
  await page.setDefaultNavigationTimeout(90_000);
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  );
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  if (blockAssets) {
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const t = req.resourceType();
      const u = req.url();
      // Allow place photo/video CDN so Photos & videos tab can render
      if ((t === 'image' || t === 'media') && /googleusercontent\.com|ggpht\.com/i.test(u)) return req.continue();
      if (t === 'image' || t === 'media' || t === 'font') return req.abort();
      req.continue();
    });
  }

  // ── Discovery ───────────────────────────────────────────────────────────────
  if (!targetUrl && (placeId || cid)) {
    // URLs built above
  } else if (!targetUrl && searchQuery) {
    console.log(`\n[discovery] Initiating discovery for: "${searchQuery}"`);
    const discoveredUrl = await searchAndClickMapsPreview(page, searchQuery, website);
    if (!discoveredUrl) {
      throw new Error(`Failed to discover place "${searchQuery}"${website ? ` matching website "${website}"` : ''} on Google Maps.`);
    }
    const needsPlaceUrl = !discoveredUrl.includes('/place/') && !discoveredUrl.includes('cid=');
    const finalUrl = needsPlaceUrl ? await extractCompleteMapUrl(page) : discoveredUrl;
    targetUrl = finalUrl || discoveredUrl;
    console.log(`[discovery] Locked onto Maps URL: ${targetUrl}\n`);
  }

  const runSearchString = buildRunSearchString({ url, cid, placeId, searchQuery, targetUrl });
  const usedDiscovery = !url && !cid && !placeId && Boolean(searchQuery);
  const effectiveSearchQuery = usedDiscovery ? searchQuery : null;

  // ── Scrape company / place details ──────────────────────────────────────────
  placeOutput = await scrapeGoogleMapsPlace(page, {
    url: targetUrl,
    language,
    placeId: placeId || null,
    searchString: runSearchString,
    searchQuery: effectiveSearchQuery,
    apiOnly,
    skipWarmUp: usedDiscovery,
  });

  if (usedDiscovery && effectiveSearchQuery && placeOutput?.title) {
    const q = effectiveSearchQuery.toLowerCase();
    const t = String(placeOutput.title).toLowerCase();
    const lead = q.split(/\s+/).find((w) => w.length > 3);
    if (lead && !t.includes(lead)) {
      console.warn(`[validate] Scraped "${placeOutput.title}" may not match searchQuery "${effectiveSearchQuery}"`);
    }
  }

  await dataset.pushData(placeOutput);
  await Actor.setStatusMessage(`Extracted details for "${placeOutput.title || 'Unknown'}"`);

  console.log(`\n✅ Done. Place: ${placeOutput.title}`);
  console.log(`   Rating: ${placeOutput.totalScore} (${placeOutput.reviewsCount} reviews)`);
  console.log(`   Distribution: ${JSON.stringify(placeOutput.reviewsDistribution)}`);

} catch (err) {
  console.error(`💥 Actor failed: ${err.message}`);
  await Actor.fail(err.message);
} finally {
  await browser.close();
}

await kvStore.setValue('OUTPUT_METADATA', {
  place: placeOutput,
  sourceUrl: targetUrl,
  scrapedAt: new Date().toISOString(),
});

await Actor.exit();
