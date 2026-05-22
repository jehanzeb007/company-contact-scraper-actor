// ── Helpers ───────────────────────────────────────────────────────────────────
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
export const jitter = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

const NAV_TIMEOUT = 90_000;
const MAPS_GOTO_WAIT = 'domcontentloaded';
const SEARCH_READY_MS = 12_000;
const PANEL_READY_MS = 4_000;
const WEBSITE_LINK_MS = 2_500;
const POLL_MS = 150;
const STABILIZE_MS = 150;
/** When a website is given, stop after the first domain match (no full-list scoring pass). */
const MAX_RESULTS_WITH_WEBSITE = 6;
const MAX_RESULTS_NO_WEBSITE = 4;

async function waitForMapsSearchReady(page, timeoutMs = SEARCH_READY_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      if (document.querySelector('[role="main"] h1.DUwDvf,[role="main"] h1,h1.DUwDvf')) return 'place';
      if (document.querySelector('a[href*="/maps/place/"],a.hfpxzc,div.Nv2PK,div[data-result-index]')) return 'list';
      if (document.querySelector('[role="region"],[role="main"]')) return 'partial';
      return null;
    }).catch(() => null);
    if (state === 'place' || state === 'list') return state;
    await sleep(POLL_MS);
  }
  return null;
}

async function isPlacePanelReady(page) {
  return page.evaluate(() => {
    const main = document.querySelector('[role="main"]');
    if (!main) return false;
    return (
      !!main.querySelector('h1.DUwDvf,h1') ||
      !!main.querySelector('a[data-item-id="authority"]') ||
      !!main.querySelector('a[aria-label^="Website"]') ||
      !!main.querySelector('button[data-item-id="address"]')
    );
  }).catch(() => false);
}

async function waitForPlacePanelReady(page, timeoutMs = PANEL_READY_MS) {
  if (await isPlacePanelReady(page)) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPlacePanelReady(page)) return true;
    await sleep(POLL_MS);
  }
  return false;
}

async function waitForWebsiteLink(page, timeoutMs = WEBSITE_LINK_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await page.evaluate(() => {
      const selectors = [
        'a[data-item-id="authority"]',
        'a[aria-label^="Website"]',
        'a[aria-label="Open website"]',
      ];
      if (selectors.some((sel) => document.querySelector(sel))) return true;
      const main = document.querySelector('[role="main"]');
      if (!main) return false;
      return [...main.querySelectorAll('a[href^="http"]')].some(
        (a) => !a.href.includes('google.com') && !a.href.includes('goo.gl'),
      );
    }).catch(() => false);
    if (found) return true;
    await sleep(POLL_MS);
  }
  return false;
}

/** Pull a canonical /place/ or ?cid= URL from the open panel without tab-click polling. */
export async function resolvePlaceUrlFromPanel(page) {
  const fromDom = await page.evaluate(() => {
    const canonical = document.querySelector('link[rel="canonical"]')?.href;
    if (canonical && (canonical.includes('/place/') || canonical.includes('cid='))) return canonical;
    const og = document.querySelector('meta[property="og:url"]')?.content;
    if (og && (og.includes('/place/') || og.includes('cid='))) return og;
    const placeLink = document.querySelector('a[href*="/maps/place/"]');
    if (placeLink?.href) return placeLink.href;
    return null;
  }).catch(() => null);
  if (fromDom) return fromDom;

  const current = page.url();
  if (current.includes('/place/') || current.includes('cid=')) return current;
  return null;
}

// ── Domain matching helpers ───────────────────────────────────────────────────
export function cleanDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

export function doDomainsMatch(domainA, domainB) {
  if (!domainA || !domainB) return false;
  return (
    domainA === domainB ||
    domainA.includes(domainB) ||
    domainB.includes(domainA)
  );
}

function normalizeSearchName(value) {
  return norm(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(private|pvt|limited|ltd|inc|llc|corp|corporation|company|co)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function requiredLegalTokens(value) {
  const raw = norm(value).toLowerCase();
  return {
    ltd: /\b(ltd|limited)\b/.test(raw),
    pvt: /\b(pvt|private)\b/.test(raw),
  };
}

function scoreDiscoveryCandidate(candidate, query) {
  const targetName = normalizeSearchName(query);
  const titleName = normalizeSearchName(candidate?.title);
  const titleRaw = norm(candidate?.title).toLowerCase();
  const legal = requiredLegalTokens(query);
  let score = 0;

  if (targetName && titleName) {
    if (titleName === targetName) score += 100;
    else if (titleName.includes(targetName) || targetName.includes(titleName)) score += 65;

    const targetTokens = new Set(targetName.split(' ').filter(Boolean));
    const titleTokens = new Set(titleName.split(' ').filter(Boolean));
    const overlap = [...targetTokens].filter((token) => titleTokens.has(token)).length;
    score += overlap * 12;
  }

  if (legal.ltd && !/\b(ltd|limited)\b/.test(titleRaw)) score -= 30;
  if (legal.pvt && !/\b(pvt|private)\b/.test(titleRaw)) score -= 20;

  const reviews = Number(candidate?.totalReviews);
  if (Number.isFinite(reviews)) {
    if (reviews <= 1) score -= 35;
    else if (reviews < 10) score -= 10;
    else if (reviews >= 1000) score += 55;
    else if (reviews >= 500) score += 45;
    else if (reviews >= 100) score += 35;
    else if (reviews >= 10) score += 20;
  }

  return score;
}

async function extractPlacePanelSummary(page) {
  return page.evaluate(() => {
    const n = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const title = n(document.querySelector('h1.DUwDvf,h1')?.textContent) || null;
    const totalReviews = (() => {
      const f7 = document.querySelector('div.F7nice,span.jANrlb');
      if (f7) {
        const m = f7.textContent.replace(/,/g, '').match(/\((\d{1,9})\)/);
        if (m) return Number(m[1]);
      }
      const btn = document.querySelector('button[jsaction="pane.rating.moreReviews"],[jsaction*="moreReviews"]');
      if (btn) {
        const m = (btn.getAttribute('aria-label') || btn.textContent || '').replace(/,/g, '').match(/(\d{1,9})/);
        if (m) return Number(m[1]);
      }
      return null;
    })();
    return { title, totalReviews };
  }).catch(() => ({ title: null, totalReviews: null }));
}

export function normalizeGoogleMapsCid(value) {
  const raw = norm(value);
  if (!raw) return null;

  try {
    const u = new URL(raw);
    const directCid = u.searchParams.get('cid') || u.searchParams.get('ludocid');
    if (directCid && /^\d+$/.test(directCid)) return directCid;
  } catch { /* Not a URL; fall through to string parsing. */ }

  const labelled = raw.match(/\b(?:cid|ludocid)\s*[:=]\s*(\d+)\b/i);
  if (labelled?.[1]) return labelled[1];
  if (/^\d+$/.test(raw)) return raw;

  try {
    const hexMatches = [...raw.matchAll(/:0x([0-9a-fA-F]{8,})/g)];
    if (hexMatches.length) return BigInt(`0x${hexMatches.at(-1)[1]}`).toString(10);
  } catch { /* Ignore malformed hex values. */ }

  return null;
}

export function buildGoogleMapsCidUrl(cid) {
  const normalized = normalizeGoogleMapsCid(cid);
  if (!normalized) throw new Error(`Invalid Google Maps CID: ${cid}`);
  return `https://www.google.com/maps?cid=${normalized}`;
}

async function hasOpenPlacePanel(page) {
  return isPlacePanelReady(page);
}

async function getMapsPageState(page) {
  return page.evaluate(() => {
    const n = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const bodyText = n(document.body?.innerText || '').slice(0, 240);
    return {
      title: document.title || null,
      bodyText,
      hasMain: !!document.querySelector('[role="main"]'),
      hasSearchBox: !!document.querySelector('input[aria-label*="Search" i],#searchboxinput'),
      hasCaptcha: /captcha|unusual traffic|not a robot/i.test(bodyText),
      hasConsent: /accept all|i agree|before you continue/i.test(bodyText),
      placeLinks: [...document.querySelectorAll('a[href*="/maps/place/"]')].length,
      resultCards: [...document.querySelectorAll('div.Nv2PK,div[role="article"],div[data-result-index],a.hfpxzc')].length,
    };
  }).catch((error) => ({ error: error.message }));
}

async function finalizeDiscoveryUrl(page, fallbackUrl) {
  const resolved = await resolvePlaceUrlFromPanel(page);
  if (resolved) return resolved;
  const current = page.url();
  if (current.includes('/place/') || current.includes('cid=')) return current;
  return fallbackUrl;
}

// ── Extract website link from the currently open Maps place panel ─────────────
export async function extractWebsiteFromMapsPage(page) {
  try {
    return await readPanelWebsite(page);
  } catch (error) {
    console.log(`  [extract] Error extracting website: ${error.message}`);
    return null;
  }
}

// ── Extract and force the full /place/ URL ────────────────────────────────────
export async function extractCompleteMapUrl(page) {
  try {
    let currentUrl = page.url();
    if (currentUrl.includes('/place/') || currentUrl.includes('cid=')) {
      return currentUrl;
    }

    const resolved = await resolvePlaceUrlFromPanel(page);
    if (resolved) {
      console.log('  [maps] Resolved /place/ URL from panel (no tab polling).');
      return resolved;
    }

    await waitForPlacePanelReady(page, 2_500);
    currentUrl = page.url();
    if (currentUrl.includes('/place/') || currentUrl.includes('cid=')) {
      return currentUrl;
    }

    const afterPanel = await resolvePlaceUrlFromPanel(page);
    if (afterPanel) {
      console.log('  [maps] Resolved /place/ URL after brief panel wait.');
      return afterPanel;
    }

    console.log(`  [maps] URL does not look like a /place/ page: ${currentUrl}. Nudging URL...`);

    await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('button[role="tab"]'));
      const targetTab =
        tabs.find((t) => /review|reseña/i.test(t.textContent || '')) ||
        tabs.find((t) => /about|acerca/i.test(t.textContent || '')) ||
        tabs[0];
      if (targetTab) targetTab.click();
    });

    for (let i = 0; i < 6; i++) {
      await sleep(200);
      currentUrl = page.url();
      if (currentUrl.includes('/place/') || currentUrl.includes('cid=')) {
        console.log('  [maps] URL successfully updated to full place URL.');
        return currentUrl;
      }
      const linked = await resolvePlaceUrlFromPanel(page);
      if (linked) {
        console.log('  [maps] URL resolved from panel link after tab nudge.');
        return linked;
      }
    }

    console.log('  [maps] URL did not update after tab nudge. Using search URL as fallback.');
    return currentUrl;
  } catch (error) {
    console.log(`  [maps] Error extracting URL: ${error.message}`);
    return null;
  }
}

async function findResultSelector(page) {
  const selectors = [
    'a[href*="/maps/place/"]',
    'a.hfpxzc',
    'div.Nv2PK',
    'div[data-result-index]',
    'article,div[role="article"]',
  ];
  for (const sel of selectors) {
    const count = await page.$$eval(sel, (els) => els.length).catch(() => 0);
    if (count > 0) return { selector: sel, count };
  }
  return { selector: null, count: 0 };
}

async function readPanelWebsite(page) {
  await waitForWebsiteLink(page, WEBSITE_LINK_MS);
  return page.evaluate(() => {
    const selectors = [
      'a[data-item-id="authority"]',
      'a[aria-label^="Website"]',
      'a[aria-label="Open website"]',
      'a[data-tooltip="Open website"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el?.href) return el.href;
    }
    const external = [...document.querySelectorAll('a[href^="http"]')].find(
      (a) =>
        !a.href.includes('google.com') &&
        !a.href.includes('goo.gl') &&
        a.closest('[role="main"]'),
    );
    return external?.href || null;
  }).catch(() => null);
}

async function panelWebsiteMatches(page, targetDomain) {
  const panelWebsite = await readPanelWebsite(page);
  if (!panelWebsite) return { matched: false, website: null, domain: null };
  const panelDomain = cleanDomain(panelWebsite);
  return {
    matched: doDomainsMatch(panelDomain, targetDomain),
    website: panelWebsite,
    domain: panelDomain,
  };
}

// ── Main search + navigation logic (covers all 3 scenarios) ──────────────────
export async function searchAndClickMapsPreview(page, companyName, targetWebsite) {
  console.log(`\n🔍 [search] Searching on Google Maps for: "${companyName}"`);

  const targetDomain = targetWebsite ? cleanDomain(targetWebsite) : null;
  if (targetDomain) {
    console.log(`  [search] Target website domain to match: ${targetDomain}`);
  }

  try {
    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(companyName)}`;
    await page.goto(searchUrl, { waitUntil: MAPS_GOTO_WAIT, timeout: NAV_TIMEOUT });
    const searchState = await waitForMapsSearchReady(page);
    if (searchState === 'list') {
      await page.evaluate(() => {
        const sidebar = document.querySelector('[role="region"]');
        if (sidebar) sidebar.scrollTop = 0;
      }).catch(() => { });
    }

    let currentUrl = page.url();

    // ── Scenario A: Landed directly on a single place page ───────────────────
    if (currentUrl.includes('/place/')) {
      console.log('  [search] Scenario A: Landed directly on single place page');
      await waitForPlacePanelReady(page);

      if (!targetDomain) {
        console.log('  [search] No website provided for matching. Returning direct URL.');
        return await finalizeDiscoveryUrl(page, currentUrl);
      }

      const { matched, domain } = await panelWebsiteMatches(page, targetDomain);
      if (!domain) {
        console.log('  [search] Scenario A: No website found on place page');
        return null;
      }
      console.log(`  [search] Scenario A: panel=${domain} target=${targetDomain}`);
      if (matched) {
        console.log('  [search] Scenario A: Website matches ✓');
        return await finalizeDiscoveryUrl(page, currentUrl);
      }

      console.log('  [search] Scenario A: Website mismatch — falling through to result list');
      await page.goto(searchUrl, { waitUntil: MAPS_GOTO_WAIT, timeout: NAV_TIMEOUT });
      await waitForMapsSearchReady(page);
      currentUrl = page.url();
    }

    // ── Scenario B: Place panel open while URL is still /maps/search/ ─────────
    if (await hasOpenPlacePanel(page)) {
      console.log('  [search] Scenario B: Place panel already open — checking website');
      await waitForPlacePanelReady(page);

      if (!targetDomain) {
        return await finalizeDiscoveryUrl(page, page.url());
      }

      const { matched, domain } = await panelWebsiteMatches(page, targetDomain);
      if (domain) {
        console.log(`  [search] Scenario B: panel=${domain} target=${targetDomain}`);
        if (matched) {
          console.log('  [search] Scenario B: Website matches ✓');
          return await finalizeDiscoveryUrl(page, page.url());
        }
        console.log('  [search] Scenario B: First result mismatch — scanning remaining results');
      } else {
        console.log('  [search] Scenario B: No website found on pre-opened panel');
      }
    }

    // ── Scenario C: Results list ─────────────────────────────────────────────
    const { selector: resultSelector, count: resultCount } = await findResultSelector(page);
    if (!resultSelector || resultCount === 0) {
      const state = await getMapsPageState(page);
      console.log(`  [search] ⚠️ No result items found on search page. Page state: ${JSON.stringify(state)}`);
      return null;
    }

    console.log(`  [search] Found ${resultCount} result items (selector: ${resultSelector})`);

    const maxScan = targetDomain ? MAX_RESULTS_WITH_WEBSITE : MAX_RESULTS_NO_WEBSITE;
    const resultLinks = await page.$$(resultSelector);
    const scanCount = Math.min(resultLinks.length, maxScan);
    console.log(`  [search] Scenario C: Scanning up to ${scanCount} results`);
    const matchingCandidates = [];

    for (let i = 0; i < scanCount; i++) {
      try {
        const links = await page.$$(resultSelector);
        if (i >= links.length) break;

        console.log(`  [search] Checking result ${i + 1}/${scanCount}`);
        await links[i].click();
        await waitForPlacePanelReady(page);
        await sleep(STABILIZE_MS);

        if (!targetDomain) {
          return await finalizeDiscoveryUrl(page, page.url());
        }

        const { matched, domain, website: panelWebsite } = await panelWebsiteMatches(page, targetDomain);
        if (!domain) {
          console.log(`  [search] Result ${i + 1}: No website found, skipping`);
          continue;
        }

        console.log(`  [search] Result ${i + 1}: panel=${domain} target=${targetDomain}`);

        if (matched) {
          const summary = await extractPlacePanelSummary(page);
          const candidate = {
            index: i + 1,
            url: await finalizeDiscoveryUrl(page, page.url()),
            website: panelWebsite || null,
            domain,
            ...summary,
          };
          candidate.score = scoreDiscoveryCandidate(candidate, companyName);
          console.log(`  [search] Result ${i + 1}: Website matches ✓ title="${candidate.title || ''}" reviews=${candidate.totalReviews ?? 'unknown'} score=${candidate.score}`);

          // Fast path: first website match is good enough when user supplied a domain.
          if (targetDomain) {
            console.log(`  [search] Using first website match (result ${candidate.index}).`);
            return candidate.url;
          }

          matchingCandidates.push(candidate);
        }
      } catch (e) {
        console.log(`  [search] Error checking result ${i + 1}: ${e.message}`);
      }
    }

    if (matchingCandidates.length > 0) {
      matchingCandidates.sort((a, b) => b.score - a.score || (b.totalReviews || 0) - (a.totalReviews || 0) || a.index - b.index);
      const best = matchingCandidates[0];
      console.log(`  [search] Selected result ${best.index}: title="${best.title || ''}" reviews=${best.totalReviews ?? 'unknown'} score=${best.score}`);
      if (best.url && page.url() !== best.url) {
        await page.goto(best.url, { waitUntil: MAPS_GOTO_WAIT, timeout: NAV_TIMEOUT }).catch(() => { });
        await waitForPlacePanelReady(page);
      }
      return best.url;
    }

    console.log('  [search] No matching result found among scanned results');
    return null;
  } catch (error) {
    console.log(`  [search] Error: ${error.message}`);
    return null;
  }
}
