import { parseAddressParts } from './addressParts.js';
import { scrapePlaceViaPreviewApi } from './placeApi.js';
import {
  capPlaceImages,
  clearPlaceImages,
  enrichPhotosAndAbout,
  filterGalleryImageUrls,
} from './placePanels.js';
import {
  inferNameFromStreetAddress,
  isWeakStructuralPlaceName,
  parseMapsPageTitle,
  sanitizePlaceDescription,
} from './textHeuristics.js';

export { parseAddressParts };

// ── Utilities ─────────────────────────────────────────────────────────────────
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

export async function evaluateWithTimeout(page, pageFunction, arg, timeoutMs = 8000) {
  const task = arg === undefined
    ? page.evaluate(pageFunction)
    : page.evaluate(pageFunction, arg);
  return Promise.race([
    task,
    sleep(timeoutMs).then(() => { throw new Error(`page.evaluate timed out after ${timeoutMs}ms`); }),
  ]);
}

export function enforceLanguage(url, lang = 'en') {
  try {
    const u = new URL(url);
    u.searchParams.set('hl', lang || 'en');
    return u.toString();
  } catch {
    return url;
  }
}

export async function dismissSignInPromptSafe(page) {
  try {
    const dismissTexts = [
      'no thanks', 'stay signed out', 'use maps without an account', 'dismiss',
      'stay signed-out', 'no, thanks', 'use maps without', 'use without',
    ];
    const clickedMain = await page.evaluate((texts) => {
      const n = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const elements = [...document.querySelectorAll('button, [role="button"], a')];
      const btn = elements.find((el) => {
        const text = n(el.textContent);
        const aria = n(el.getAttribute('aria-label') || '');
        return texts.some((d) => text.includes(d) || aria.includes(d));
      });
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    }, dismissTexts);
    if (clickedMain) {
      console.log('[maps] Dismissed Google Sign-in prompt.');
      await sleep(1000);
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

export const dismissSignInPrompt = dismissSignInPromptSafe;

export async function hasTabbedLayout(page) {
  try {
    return await page.evaluate(() => {
      const tablist = document.querySelector('[role="tablist"]');
      if (tablist) return true;
      return document.querySelectorAll('button[role="tab"]').length > 0;
    });
  } catch {
    return false;
  }
}

export async function buildCanonicalPlaceUrl(page) {
  try {
    return await page.evaluate(() => {
      const canonical = document.querySelector('link[rel="canonical"]');
      if (canonical?.href) return canonical.href;
      const ogUrl = document.querySelector('meta[property="og:url"]');
      if (ogUrl?.content) return ogUrl.content;
      return window.location.href;
    });
  } catch {
    return page.url();
  }
}

export async function clickOverviewTab(page) {
  try {
    return await evaluateWithTimeout(page, () => {
      const n = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const overviewTexts = [
        'overview', 'información', 'informacion', 'aperçu', 'apercu', 'übersicht', 'ubersicht',
        'panoramica', 'overblick', 'overzicht', 'visión general', 'vision general', 'resumo',
      ];
      const matchesOverview = (el) => {
        const text = n(el.textContent);
        const aria = n(el.getAttribute('aria-label') || '');
        return overviewTexts.some((t) => text === t || aria === t || text.includes(t) || aria.includes(t));
      };
      const clickEl = (el) => {
        if (!el) return false;
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        el.click();
        return true;
      };
      const tablist = document.querySelector('[role="tablist"]');
      if (tablist) {
        const tabs = [...tablist.querySelectorAll('[role="tab"], button')];
        const overviewTab = tabs.find(matchesOverview);
        if (overviewTab) return clickEl(overviewTab);
        if (tabs[0]) return clickEl(tabs[0]);
      }
      const elements = [...document.querySelectorAll('[role="tab"], button, [role="button"]')];
      return clickEl(elements.find(matchesOverview));
    }, undefined, 6000);
  } catch {
    return false;
  }
}

export async function nudgeToOverviewTab(page) {
  try {
    const needsNudge = await evaluateWithTimeout(page, () => {
      const n = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const selected = document.querySelector('[role="tab"][aria-selected="true"]');
      if (!selected) return true;
      const label = n(selected.getAttribute('aria-label') || selected.textContent || '');
      if (label.includes('about') || label.includes('acerca') || label.includes('à propos') || label.includes('uber ') || label.includes('información')) {
        return true;
      }
      const hasRating = !!(
        document.querySelector('button[jsaction*="pane.rating.moreReviews"]') ||
        document.querySelector('button[jsaction*="pane.reviewChart.moreReviews"]') ||
        document.querySelector('span[aria-label*="star" i]') ||
        document.querySelector('div.F7nice')
      );
      return !hasRating;
    }, undefined, 6000);
    if (!needsNudge) return false;
    const clicked = await clickOverviewTab(page);
    if (clicked) await sleep(700);
    return clicked;
  } catch {
    return false;
  }
}

export async function checkAndRecoverFromDetour(page) {
  try {
    const didRecover = await page.evaluate(() => {
      const hasTabList = !!document.querySelector('[role="tablist"]');
      if (hasTabList) return false;
      const backButtons = [...document.querySelectorAll(
        'button[jsaction*="back"], button[aria-label*="Back" i], button.Hk41od',
      )];
      const hasReviewFeed = !!(document.querySelector('[data-review-id]') || document.querySelector('div.jftiEf'));
      const feed = document.querySelector('[role="feed"]');
      const isPostsFeed = !!(feed && !hasReviewFeed && !hasTabList);
      const shouldRecover = isPostsFeed || (backButtons.length > 0 && !hasTabList);
      if (!shouldRecover) return false;
      const visibleBackBtn = backButtons.find((b) => b.offsetWidth > 0 && b.offsetHeight > 0);
      if (visibleBackBtn) {
        visibleBackBtn.click();
        return true;
      }
      if (isPostsFeed) {
        window.history.back();
        return true;
      }
      return false;
    });
    if (didRecover) {
      console.log('[maps] Recovered from detour view.');
      await sleep(1500);
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

export async function ensureTabbedLayout(page, options = {}) {
  const { lang = 'en', fast = false } = options;
  const maxAttempts = options.maxAttempts ?? (fast ? 1 : 2);
  const delays = fast
    ? { overview: 400, recover: 600, navigate: 1000 }
    : { overview: 800, recover: 1000, navigate: 1500 };
  console.log(`[maps] Running ensureTabbedLayout${fast ? ' (fast)' : ''}...`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await dismissSignInPromptSafe(page).catch(() => { });
    if (await hasTabbedLayout(page)) {
      console.log('[maps] Tabbed layout detected.');
      return true;
    }

    const clickedOverview = await clickOverviewTab(page).catch(() => false);
    if (clickedOverview) {
      await sleep(delays.overview);
      if (await hasTabbedLayout(page)) return true;
    }

    const didRecoverDetour = await checkAndRecoverFromDetour(page).catch(() => false);
    if (didRecoverDetour) {
      await sleep(delays.recover);
      if (await hasTabbedLayout(page)) return true;
    }

    if (fast) break;

    const canonicalUrl = await buildCanonicalPlaceUrl(page).catch(() => null);
    if (canonicalUrl && canonicalUrl !== page.url()) {
      await page.goto(enforceLanguage(canonicalUrl, lang), { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => { });
      await sleep(delays.navigate);
    } else if (attempt < maxAttempts) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => { });
      await sleep(delays.navigate);
    }
  }

  const finalCheck = await hasTabbedLayout(page);
  if (!finalCheck) console.warn('[maps] Warning: Could not ensure tabbed layout. Proceeding anyway.');
  return finalCheck;
}

export async function warmUpGoogleMaps(page, language = 'en') {
  console.log('[warmup] Warming up Google Maps session...');
  await page.goto(enforceLanguage('https://www.google.com/maps', language), { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await sleep(1500);
  try {
    await page.evaluate(() => {
      const want = ['accept all', 'accept', 'i agree', 'consent', 'agree'];
      const n = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const btn = [...document.querySelectorAll('button,[role="button"]')].find((b) => want.some((w) => n(b.textContent).includes(w)));
      if (btn) btn.click();
    });
    await sleep(400);
  } catch { /* ignore */ }
  await dismissSignInPromptSafe(page).catch(() => { });
  console.log('[warmup] Session warm-up complete.');
}

function readHydrationStatus() {
  const n = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const hasReviewWord = (txt) => /\breviews?\b/.test(n(txt)) || n(txt).includes('reseñ') || n(txt).includes('avis');
  const h1 = document.querySelector('h1.DUwDvf') || document.querySelector('[role="main"] h1') || document.querySelector('h1');
  const hasTitle = !!(h1 && h1.textContent.trim());
  const hasRating = !!(
    document.querySelector('button[jsaction*="pane.rating.moreReviews"]') ||
    document.querySelector('button[jsaction*="pane.reviewChart.moreReviews"]') ||
    document.querySelector('span[aria-label*="star" i]') ||
    document.querySelector('div.F7nice')
  );
  const tablist = document.querySelector('[role="tablist"]');
  const tabs = document.querySelectorAll('[role="tab"]');
  const hasTabs = !!(tablist || tabs.length > 0);
  const allButtons = [...document.querySelectorAll('button, [role="tab"], [role="button"]')];
  const hasReviewsBtn = allButtons.some((b) => {
    if (b.closest('[class*="post" i], [class*="update" i], [class*="photo" i]')) return false;
    const aria = b.getAttribute('aria-label') || '';
    const text = b.textContent || '';
    return hasReviewWord(aria) || hasReviewWord(text);
  });
  const selectedTab = document.querySelector('[role="tab"][aria-selected="true"]');
  const selectedTabLabel = selectedTab
    ? n(selectedTab.getAttribute('aria-label') || selectedTab.textContent || '')
    : null;
  return {
    hasTitle,
    hasRating,
    hasTabs,
    hasReviewsBtn,
    selectedTabLabel,
    ready: hasTabs && hasReviewsBtn && (hasTitle || hasRating),
  };
}

export async function verifyPageHydrated(page, maxWaitMs = 15_000) {
  console.log('[hydration] Waiting for business profile to hydrate...');
  const start = Date.now();
  let lastLogAt = 0;
  let nudgeCount = 0;

  await nudgeToOverviewTab(page).catch(() => { });

  while (Date.now() - start < maxWaitMs) {
    const status = await evaluateWithTimeout(page, readHydrationStatus, undefined, 8000).catch(() => ({ ready: false }));
    if (status.ready) {
      console.log(`[hydration] Profile hydrated: ${JSON.stringify(status)}`);
      return true;
    }
    const elapsed = Date.now() - start;
    if (elapsed - lastLogAt >= 3000) {
      lastLogAt = elapsed;
      console.log(`[hydration] Still waiting (${Math.round(elapsed / 1000)}s): ${JSON.stringify(status)}`);
    }
    if (nudgeCount < 4 && (!status.hasRating || status.selectedTabLabel?.includes('about'))) {
      nudgeCount++;
      await nudgeToOverviewTab(page).catch(() => { });
    }
    await dismissSignInPromptSafe(page).catch(() => { });
    await sleep(500);
  }

  console.warn('[hydration] Hydration verification timed out.');
  await nudgeToOverviewTab(page).catch(() => { });
  return false;
}

export function cidFromUrl(url) {
  try {
    const u = new URL(String(url));
    const directCid = u.searchParams.get('cid') || u.searchParams.get('ludocid');
    if (directCid && /^\d+$/.test(directCid)) return directCid;
  } catch { /* not a URL */ }

  try {
    const directMatch = String(url || '').match(/[?&](?:cid|ludocid)=(\d+)/i);
    if (directMatch?.[1]) return directMatch[1];
    const m = [...String(url).matchAll(/:0x([0-9a-fA-F]{8,})/g)];
    return m.length ? BigInt(`0x${m.at(-1)[1]}`).toString(10) : null;
  } catch {
    return null;
  }
}

export function fidFromUrl(url) {
  try {
    const m = String(url || '').match(/(0x[0-9a-fA-F]+:0x[0-9a-fA-F]+)/);
    return m?.[1] || null;
  } catch {
    return null;
  }
}

export function kgmidFromUrl(url) {
  try {
    const decoded = decodeURIComponent(String(url || ''));
    const m = decoded.match(/!16s(\/g\/[^!?&/]+|\/m\/[^!?&/]+)/);
    return m?.[1] || null;
  } catch {
    return null;
  }
}

export function extractCoordsFromUrl(url) {
  const coordsM = String(url || '').match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (!coordsM) return null;
  return { lat: Number(coordsM[1]), lng: Number(coordsM[2]) };
}

export function unformatPhone(phone) {
  if (!phone) return null;
  const cleaned = String(phone).replace(/[^\d+]/g, '');
  if (!cleaned) return null;
  if (cleaned.startsWith('+')) return cleaned;
  if (cleaned.length === 10) return `+1${cleaned}`;
  if (cleaned.length === 11 && cleaned.startsWith('1')) return `+${cleaned}`;
  return cleaned;
}

function mergePlaceFields(place, patch) {
  if (!patch) return;
  for (const [key, value] of Object.entries(patch)) {
    if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) continue;
    if (place[key] == null || place[key] === '') place[key] = value;
  }
}

async function clickFirstSearchResult(page) {
  return page.evaluate(() => {
    const click = (el) => {
      if (!el) return false;
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      el.click();
      return true;
    };
    const anchors = [...document.querySelectorAll('a[href]')]
      .filter((a) => (a.getAttribute('href') || '').includes('/maps/place/'));
    if (anchors.length) return click(anchors[0]);
    const cards = [...document.querySelectorAll('div.Nv2PK,div[role="article"]')];
    for (const card of cards) {
      const link = card.querySelector('a[href]');
      if (link && click(link)) return true;
      if (click(card)) return true;
    }
    return false;
  }).catch(() => false);
}

async function recoverPlaceSelection(page, sourceUrl) {
  try {
    const u = new URL(sourceUrl);
    const cid = u.searchParams.get('cid') || u.searchParams.get('ludocid');
    if (cid && /^\d+$/.test(cid)) {
      for (const cidUrl of [`https://maps.google.com/?cid=${cid}`, `https://www.google.com/maps?cid=${cid}`]) {
        console.log(`[maps] Recovering place from CID URL: ${cidUrl}`);
        await page.goto(enforceLanguage(cidUrl, 'en'), { waitUntil: 'domcontentloaded', timeout: 90_000 });
        await dismissSignInPromptSafe(page).catch(() => { });
        for (let i = 0; i < 30; i++) {
          const ok = await page.evaluate(() => !!(
            document.querySelector('h1.DUwDvf,h1') ||
            document.querySelector('[role="tab"][aria-label*="review" i]')
          )).catch(() => false);
          if (ok) return true;
          await sleep(350);
        }
      }
      return false;
    }

    const queryParam = u.searchParams.get('query') || u.searchParams.get('q');
    let query = null;
    if (queryParam) {
      query = norm(decodeURIComponent(queryParam.replace(/\+/g, ' ')));
    } else {
      const m = u.pathname.match(/\/maps\/place\/([^/]+)/i);
      if (m?.[1]) query = norm(decodeURIComponent(m[1].replace(/\+/g, ' ')));
    }
    if (!query) return false;

    const encoded = encodeURIComponent(query).replace(/%20/g, '+');
    await page.goto(`https://www.google.com/maps/search/${encoded}?hl=en`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await sleep(2000);
    if (!await clickFirstSearchResult(page)) return false;
    for (let i = 0; i < 30; i++) {
      const ok = await page.evaluate(() => !!document.querySelector('h1.DUwDvf,h1')).catch(() => false);
      if (ok) return true;
      await sleep(350);
    }
  } catch { /* ignore */ }
  return false;
}

// ── Place info extraction ─────────────────────────────────────────────────────
export async function extractPlaceInfo(page) {
  await dismissSignInPromptSafe(page).catch(() => { });
  const onReviews = await page.evaluate(() => !!(
    document.querySelector('[role="feed"]') || document.querySelector('[data-review-id]')
  ) && !document.querySelector('h1.DUwDvf,h1'));
  if (onReviews) {
    await page.evaluate(() => {
      const n = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const tab = [...document.querySelectorAll('[role="tab"],button')].find((el) => n(el.textContent) === 'overview');
      if (tab) tab.click();
    });
    await sleep(1500);
  }

  try {
    await page.waitForFunction(
      () => Boolean(document.querySelector('h1.DUwDvf,h1')?.textContent?.trim()),
      { timeout: 8000 },
    );
  } catch { /* proceed */ }

  const info = await page.evaluate(() => {
    const n = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const $ = (sel) => { const el = document.querySelector(sel); return el ? n(el.textContent) : null; };

    const overallRating = (() => {
      const read = (txt) => {
        const text = n(txt).replace(',', '.');
        let m = text.match(/(\d+\.\d+)\s*(?:stars?|out of)/i);
        if (m) {
          const v = Number(m[1]);
          return Number.isFinite(v) && v > 0 && v <= 5 ? v : null;
        }
        if (/\b[1-5]\s*stars?\b/i.test(text) && !/\d+\.\d+/.test(text)) return null;
        m = text.match(/(\d+(?:\.\d+)?)/);
        const v = m ? Number(m[1]) : NaN;
        return Number.isFinite(v) && v > 0 && v <= 5 ? v : null;
      };
      const fromF7 = read(document.querySelector('div.F7nice')?.textContent || '');
      if (fromF7 != null) return fromF7;
      for (const el of document.querySelectorAll('span[aria-label*="star" i],span[role="img"][aria-label*="star" i]')) {
        const got = read(el.getAttribute('aria-label') || '');
        if (got != null) return got;
      }
      return null;
    })();

    const totalReviews = (() => {
      const f7 = document.querySelector('div.F7nice,span.jANrlb');
      if (f7) { const m = f7.textContent.replace(/,/g, '').match(/\((\d{1,9})\)/); if (m) return Number(m[1]); }
      const btn = document.querySelector('button[jsaction="pane.rating.moreReviews"],[jsaction*="moreReviews"]');
      if (btn) {
        const m = (btn.getAttribute('aria-label') || btn.textContent || '').replace(/,/g, '').match(/(\d{1,9})/);
        if (m) return Number(m[1]);
      }
      return null;
    })();

    const address = (() => {
      const el = document.querySelector('button[data-item-id="address"],[data-item-id="address"]');
      const a = n(el?.getAttribute('aria-label') || '');
      return a.toLowerCase().startsWith('address:') ? a.slice(8).trim() : n(el?.textContent) || null;
    })();

    const phone = (() => {
      const el = document.querySelector('button[data-item-id^="phone"],[data-item-id^="phone"]');
      const a = n(el?.getAttribute('aria-label') || '');
      if (a.toLowerCase().startsWith('phone:')) return a.slice(6).trim();
      const fromId = el?.getAttribute('data-item-id') || '';
      const tel = fromId.match(/phone:tel:([^;]+)/i);
      if (tel?.[1]) return decodeURIComponent(tel[1]);
      return n(el?.textContent) || null;
    })();

    const website = (() => {
      const selectors = [
        'a[data-item-id="authority"]',
        'a[aria-label^="Website"]',
        'a[aria-label="Open website"]',
        'a[data-tooltip="Open website"]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el?.href && !el.href.includes('google.com')) return el.href;
      }
      const main = document.querySelector('[role="main"]');
      if (main) {
        const external = [...main.querySelectorAll('a[href^="http"]')].find(
          (a) => !a.href.includes('google.com') && !a.href.includes('goo.gl'),
        );
        if (external) return external.href;
      }
      return null;
    })();

    const menu = (() => {
      const selectors = [
        'a[data-item-id="menu"]',
        'a[aria-label*="Menu" i][href^="http"]',
        'a[aria-label*="Order online" i][href^="http"]',
        'a[aria-label*="Order food" i][href^="http"]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el?.href && !el.href.includes('google.com')) return el.href;
      }
      return null;
    })();

    const price = (() => {
      const text = n(document.querySelector('[aria-label*="Price" i],span[aria-label*="$"]')?.getAttribute('aria-label') || '');
      const priceText = text || [...document.querySelectorAll('span,div')]
        .map((el) => n(el.textContent))
        .find((t) => /^\${1,4}(?:\s*[–-]\s*\${1,4})?$/.test(t) || /^\$\d+/.test(t));
      return priceText || null;
    })();

    const plusCode = (() => {
      const el = document.querySelector('[data-item-id="oloc"],button[aria-label*="Plus code" i]');
      const label = n(el?.getAttribute('aria-label') || '');
      return label.toLowerCase().startsWith('plus code:') ? label.slice(10).trim() : n(el?.textContent) || null;
    })();

    const openingHours = (() => {
      const hoursButton = document.querySelector('[data-item-id="oh"],button[aria-label*="Hours" i]');
      const label = n(hoursButton?.getAttribute('aria-label') || '');
      const raw = label || n(hoursButton?.textContent);
      if (!raw) return [];
      const cleaned = raw.replace(/^hours:\s*/i, '');
      const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      const out = [];
      for (const day of days) {
        const re = new RegExp(`${day}\\s+([^.;]+)`, 'i');
        const m = cleaned.match(re);
        if (m) out.push({ day, hours: n(m[1]) });
      }
      return out;
    })();

    const locatedIn = (() => {
      const el = [...document.querySelectorAll('button,a,div')].find((node) => {
        const label = n(node.getAttribute('aria-label') || '');
        return /^located in:/i.test(label);
      });
      if (!el) return null;
      return n(el.getAttribute('aria-label')).replace(/^located in:\s*/i, '');
    })();

    const subTitle = (() => {
      const h1Text = n(document.querySelector('h1.DUwDvf,h1')?.textContent);
      const categoryBtn = document.querySelector('button.DkEaL,button[jsaction*="pane.rating.category"]');
      const line = n(categoryBtn?.parentElement?.textContent || categoryBtn?.textContent);
      if (!line) return null;
      const parts = line.split(/\s*[·•]\s*/).map((p) => n(p)).filter(Boolean);
      if (parts.length < 2) return null;
      const parent = parts[parts.length - 1];
      if (!parent || parent.toLowerCase() === h1Text.toLowerCase()) return null;
      return parent;
    })();

    return {
      name: $('h1.DUwDvf,h1'),
      subTitle,
      locatedIn,
      documentTitle: document.title || '',
      overallRating,
      totalReviews,
      category: $('button.DkEaL,button[jsaction*="pane.rating.category"]'),
      address,
      phone,
      website,
      menu,
      imageUrl: document.querySelector('button[jsaction*="pane.heroHeaderImage"] img, img[src*="googleusercontent.com/p/"], img[src*="lh5.googleusercontent.com"]')?.getAttribute('src') || null,
      price,
      plusCode,
      openingHours,
      additionalInfo: {},
    };
  });

  const merged = {
    ...info,
    pageTitleName: parseMapsPageTitle(info?.documentTitle),
    ...parseAddressParts(info?.address),
  };
  delete merged.documentTitle;
  return merged;
}

function applyResolvedDisplayName(place, candidates, { structuralLabel = null } = {}) {
  const weak = structuralLabel || place?.name;
  const types = place?.categories?.length ? place.categories : (place?.category ? [place.category] : []);
  if (!isWeakStructuralPlaceName(weak, types)) return false;

  for (const raw of candidates) {
    const name = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!name || isWeakStructuralPlaceName(name, [])) continue;
    if (name.toLowerCase() === String(weak || '').toLowerCase()) continue;
    place.subTitle = weak;
    place.name = name;
    return true;
  }
  return false;
}

/** Replace floor/level titles with the parent venue name when Maps exposes one. */
export async function resolvePlaceDisplayName(page, place) {
  if (!place?.name) return place;

  const types = place.categories?.length ? place.categories : (place.category ? [place.category] : []);
  if (!isWeakStructuralPlaceName(place.name, types)) return place;

  if (applyResolvedDisplayName(place, [
    place.locatedIn,
    place.subTitle,
    inferNameFromStreetAddress(place.address),
  ])) {
    return place;
  }

  const dom = await extractPlaceInfo(page).catch(() => null);
  if (dom && applyResolvedDisplayName(place, [
    dom.locatedIn,
    dom.subTitle,
    dom.pageTitleName,
    inferNameFromStreetAddress(place.address),
  ])) {
    if (dom.locatedIn) place.locatedIn = dom.locatedIn;
    return place;
  }

  return place;
}

// ── Review distribution ───────────────────────────────────────────────────────
const EMPTY_DISTRIBUTION = { oneStar: 0, twoStar: 0, threeStar: 0, fourStar: 0, fiveStar: 0 };

export function normalizeReviewsDistribution(dist) {
  if (!dist || typeof dist !== 'object') return { ...EMPTY_DISTRIBUTION };
  if ('fiveStar' in dist || 'oneStar' in dist) return { ...EMPTY_DISTRIBUTION, ...dist };
  return {
    oneStar: Number(dist['1_star'] || dist.oneStar || 0),
    twoStar: Number(dist['2_star'] || dist.twoStar || 0),
    threeStar: Number(dist['3_star'] || dist.threeStar || 0),
    fourStar: Number(dist['4_star'] || dist.fourStar || 0),
    fiveStar: Number(dist['5_star'] || dist.fiveStar || 0),
  };
}

export function isPlausibleReviewDistribution(dist) {
  const d = normalizeReviewsDistribution(dist);
  const counts = [d.oneStar, d.twoStar, d.threeStar, d.fourStar, d.fiveStar].map((n) => Number(n) || 0);
  const sum = counts.reduce((a, b) => a + b, 0);
  if (sum <= 0) return false;
  if (counts.some((c) => c < 0 || c > sum)) return false;
  const nonZero = counts.filter((c) => c > 0).length;
  if (nonZero < 2) return false;
  const max = Math.max(...counts);
  if (max === sum && sum > 50) return false;
  return true;
}

export function ratingFromReviewDistribution(dist) {
  const d = normalizeReviewsDistribution(dist);
  const counts = [d.oneStar, d.twoStar, d.threeStar, d.fourStar, d.fiveStar].map((n) => Number(n) || 0);
  const sum = counts.reduce((a, b) => a + b, 0);
  if (sum <= 0) return null;
  const weighted = counts.reduce((acc, c, i) => acc + c * (i + 1), 0) / sum;
  return Math.round(weighted * 10) / 10;
}

/** Derive total reviews + weighted average rating from star distribution. */
export function finalizePlaceReviewStats(place) {
  const dist = normalizeReviewsDistribution(place?.reviewsDistribution);
  place.reviewsDistribution = dist;
  if (!isPlausibleReviewDistribution(dist)) return place;

  const counts = [dist.oneStar, dist.twoStar, dist.threeStar, dist.fourStar, dist.fiveStar]
    .map((n) => Number(n) || 0);
  const sum = counts.reduce((a, b) => a + b, 0);
  place.totalReviews = sum;
  const fromDist = ratingFromReviewDistribution(dist);
  if (fromDist != null) place.overallRating = fromDist;
  return place;
}

function hasReviewDistribution(place) {
  return Object.values(normalizeReviewsDistribution(place?.reviewsDistribution))
    .some((v) => Number(v) > 0);
}

export function placeCoreDataComplete(place) {
  return Boolean(
    place?.name?.trim()
    && place?.address?.trim()
    && (place?.phone || place?.website)
    && place.overallRating != null
    && place.totalReviews != null
    && hasReviewDistribution(place),
  );
}

export function shouldSkipHybridDomEnrichment(place, { includeImages = false } = {}) {
  if (includeImages) return false;
  return placeCoreDataComplete(place);
}

export async function extractReviewDistributionAPI(page) {
  const raw = await page.evaluate(() => {
    try {
      const data = window.APP_INITIALIZATION_STATE;
      if (!data) return {};
      const stack = [data];
      const seen = new Set();
      while (stack.length) {
        const cur = stack.pop();
        if (!cur || typeof cur !== 'object' || seen.has(cur)) continue;
        seen.add(cur);
        if (Array.isArray(cur) && cur.length === 5) {
          let isHistogram = true;
          for (let i = 0; i < 5; i++) {
            if (!Array.isArray(cur[i]) || typeof cur[i][0] !== 'number' || cur[i][0] < 1 || cur[i][0] > 5) {
              isHistogram = false;
              break;
            }
          }
          if (isHistogram) {
            const stars = cur.map((x) => x[0]).sort();
            if (stars.join(',') === '1,2,3,4,5') {
              const dist = {};
              for (const item of cur) dist[`${item[0]}_star`] = Number(item[1]) || 0;
              return dist;
            }
          }
        }
        if (Array.isArray(cur)) {
          for (const v of cur) if (v && typeof v === 'object') stack.push(v);
        } else {
          for (const v of Object.values(cur)) if (v && typeof v === 'object') stack.push(v);
        }
      }
    } catch { /* ignore */ }
    return {};
  }).catch(() => ({}));

  return normalizeReviewsDistribution(raw);
}

export async function clickReviewsTab(page) {
  try {
    return await evaluateWithTimeout(page, () => {
      const n = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const reviewTexts = ['reviews', 'reseñas', 'avis', 'rezensionen', 'recensioni', 'opiniones'];
      const tablist = document.querySelector('[role="tablist"]');
      if (tablist) {
        const tabs = [...tablist.querySelectorAll('[role="tab"], button')];
        const reviewTab = tabs.find((el) => {
          const text = n(el.textContent);
          const aria = n(el.getAttribute('aria-label') || '');
          return reviewTexts.some((t) => text === t || aria === t || text.includes(t) || aria.includes(t));
        });
        if (reviewTab) {
          reviewTab.click();
          return true;
        }
      }
      return false;
    }, undefined, 6000);
  } catch {
    return false;
  }
}

export async function extractReviewDistributionDOM(page) {
  const raw = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tr[aria-label*="star"], tr[aria-label*="estrella"], tr[aria-label*="étoile"]'));
    const dist = {};
    for (const row of rows) {
      const label = row.getAttribute('aria-label') || '';
      const match = label.match(/(\d)\s*(?:star|estrella|étoile|stern)[^,]*,\s*([\d,.]+)/i);
      if (match) dist[`${match[1]}_star`] = parseInt(match[2].replace(/[^\d]/g, ''), 10);
    }
    return dist;
  }).catch(() => ({}));

  return normalizeReviewsDistribution(raw);
}

export async function extractReviewDistribution(page) {
  let dist = await extractReviewDistributionAPI(page);
  if (isPlausibleReviewDistribution(dist)) {
    console.log('[maps] Review distribution from APP_INITIALIZATION_STATE.');
    return dist;
  }

  console.log('[maps] Review distribution missing or invalid — opening Reviews tab for DOM fallback.');
  await openReviewsPanel(page);
  await sleep(2000);
  dist = await extractReviewDistributionDOM(page);
  if (isPlausibleReviewDistribution(dist)) {
    console.log('[maps] Review distribution from DOM histogram.');
  }
  return dist;
}

/** Rating, review count, and contact fields from Overview or Reviews panel. */
export async function extractReviewSummaryFromDom(page) {
  return page.evaluate(() => {
    const n = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const readRating = (txt) => {
      const text = n(txt).replace(',', '.');
      let m = text.match(/(\d+\.\d+)\s*(?:stars?|out of)/i);
      if (m) {
        const v = Number(m[1]);
        return Number.isFinite(v) && v > 0 && v <= 5 ? v : null;
      }
      if (/\b[1-5]\s*stars?\b/i.test(text) && !/\d+\.\d+/.test(text)) return null;
      m = text.match(/(\d+(?:\.\d+)?)/);
      const v = m ? Number(m[1]) : NaN;
      return Number.isFinite(v) && v > 0 && v <= 5 ? v : null;
    };
    const readReviewCount = (txt) => {
      const m = String(txt || '').replace(/,/g, '').match(/(\d{1,9})/);
      return m ? Number(m[1]) : null;
    };

    let overallRating = null;
    let totalReviews = null;

    for (const el of document.querySelectorAll('[aria-label]')) {
      const aria = n(el.getAttribute('aria-label') || '');
      const combined = aria.match(
        /(\d+(?:\.\d+)?)\s*stars?\s*,?\s*([\d,.]+)\s*reviews?/i,
      );
      if (combined) {
        overallRating = readRating(combined[1]);
        totalReviews = readReviewCount(combined[2]);
        break;
      }
    }

    if (overallRating == null) {
      overallRating = readRating(document.querySelector('div.F7nice')?.textContent || '');
    }
    if (overallRating == null) {
      for (const el of document.querySelectorAll('span[aria-label*="star" i],span[role="img"][aria-label*="star" i]')) {
        overallRating = readRating(el.getAttribute('aria-label') || '');
        if (overallRating != null) break;
      }
    }

    const f7 = document.querySelector('div.F7nice,span.jANrlb');
    if (f7 && totalReviews == null) {
      const m = f7.textContent.replace(/,/g, '').match(/\((\d{1,9})\)/);
      if (m) totalReviews = Number(m[1]);
      if (overallRating == null) overallRating = readRating(f7.textContent);
    }
    if (totalReviews == null) {
      const btn = document.querySelector('button[jsaction*="pane.rating.moreReviews"],button[jsaction*="moreReviews"]');
      if (btn) {
        const m = (btn.getAttribute('aria-label') || btn.textContent || '').replace(/,/g, '').match(/(\d{1,9})/);
        if (m) totalReviews = Number(m[1]);
      }
    }

    const phoneEl = document.querySelector('button[data-item-id^="phone"],[data-item-id^="phone"]');
    const phoneLabel = n(phoneEl?.getAttribute('aria-label') || '');
    const phone = phoneLabel.toLowerCase().startsWith('phone:')
      ? phoneLabel.slice(6).trim()
      : n(phoneEl?.textContent) || null;

    const website = document.querySelector('a[data-item-id="authority"],a[aria-label^="Website"]')?.href || null;
    const menu = document.querySelector('a[data-item-id="menu"],a[aria-label*="Menu" i][href^="http"]')?.href || null;

    return { overallRating, totalReviews, phone, website, menu };
  }).catch(() => ({
    overallRating: null,
    totalReviews: null,
    phone: null,
    website: null,
    menu: null,
  }));
}

/** Phone, website, menu, hours from Overview panel (after leaving Reviews tab). */
export async function extractContactFieldsFromDom(page) {
  await clickOverviewTab(page).catch(() => { });
  await nudgeToOverviewTab(page).catch(() => { });
  await sleep(1200);

  const contact = await page.evaluate(() => {
    const n = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const readLabel = (el, prefix) => {
      const a = n(el?.getAttribute('aria-label') || '');
      return a.toLowerCase().startsWith(prefix) ? a.slice(prefix.length).trim() : null;
    };

    const phoneEl = document.querySelector('button[data-item-id^="phone"],[data-item-id^="phone"]');
    let phone = readLabel(phoneEl, 'phone:');
    if (!phone && phoneEl) {
      const tel = (phoneEl.getAttribute('data-item-id') || '').match(/phone:tel:([^;]+)/i);
      if (tel?.[1]) phone = decodeURIComponent(tel[1]);
      else phone = n(phoneEl.textContent) || null;
    }

    const pickLink = (selectors) => {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el?.href && !/google\.|goo\.gl|gstatic/i.test(el.href)) return el.href;
      }
      return null;
    };

    const website = pickLink([
      'a[data-item-id="authority"]',
      'a[aria-label^="Website"]',
      'a[aria-label="Open website"]',
    ]);

    const menu = pickLink([
      'a[data-item-id="menu"]',
      'a[aria-label*="Menu" i][href^="http"]',
      'a[aria-label*="Order online" i][href^="http"]',
      'a[aria-label*="Order food" i][href^="http"]',
    ]);

    const addressEl = document.querySelector('button[data-item-id="address"],[data-item-id="address"]');
    const address = readLabel(addressEl, 'address:') || n(addressEl?.textContent) || null;

    const hoursButton = document.querySelector('[data-item-id="oh"],button[aria-label*="Hours" i]');
    const hoursLabel = n(hoursButton?.getAttribute('aria-label') || '') || n(hoursButton?.textContent);
    const openingHours = [];
    if (hoursLabel) {
      const cleaned = hoursLabel.replace(/^hours:\s*/i, '');
      for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
        const re = new RegExp(`${day}\\s+([^.;]+)`, 'i');
        const m = cleaned.match(re);
        if (m) openingHours.push({ day, hours: n(m[1]) });
      }
    }

    const plusCodeEl = document.querySelector('[data-item-id="oloc"],button[aria-label*="Plus code" i]');
    const plusLabel = n(plusCodeEl?.getAttribute('aria-label') || '');
    const plusCode = plusLabel.toLowerCase().startsWith('plus code:')
      ? plusLabel.slice(10).trim()
      : n(plusCodeEl?.textContent) || null;

    return { phone, website, menu, address, openingHours, plusCode };
  }).catch(() => ({}));

  return contact;
}

function needsContactEnrichment(place) {
  return !place?.phone || !place?.website;
}

async function enrichContactFromPage(page, place, { language = 'en' } = {}) {
  if (place?.phone && place?.website) {
    if (place.address) mergePlaceFields(place, parseAddressParts(place.address));
    console.log('[hybrid] Contact complete from API — skipping DOM contact enrichment.');
    return place;
  }

  console.log('[hybrid] Enriching missing contact fields from Maps UI...');
  await dismissSignInPromptSafe(page).catch(() => { });
  await checkAndRecoverFromDetour(page).catch(() => { });
  await ensureTabbedLayout(page, { lang: language, fast: true });
  await enrichContactFromPage_extract(page, place);
  return place;
}

async function enrichContactFromPage_extract(page, place) {
  const contact = await extractContactFieldsFromDom(page);
  mergePlaceFields(place, contact);

  if (needsContactEnrichment(place) || !place.openingHours?.length) {
    const domInfo = await extractPlaceInfo(page);
    mergePlaceFields(place, {
      phone: domInfo.phone,
      website: domInfo.website,
      menu: domInfo.menu,
      plusCode: domInfo.plusCode,
      address: domInfo.address,
      openingHours: domInfo.openingHours,
    });
  }

  if (place.address) {
    mergePlaceFields(place, parseAddressParts(place.address));
  }

  console.log(`[hybrid] Contact: phone=${place.phone || '-'} website=${place.website || '-'} menu=${place.menu || '-'} state=${place.state || '-'}`);
}

async function openReviewsPanel(page) {
  const opened = await clickReviewsTab(page);
  if (opened) return true;

  return page.evaluate(() => {
    const n = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const candidates = [...document.querySelectorAll('button,[role="button"],[role="tab"]')];
    const target = candidates.find((el) => {
      const js = n(el.getAttribute('jsaction') || '');
      const aria = n(el.getAttribute('aria-label') || '');
      const text = n(el.textContent || '');
      return js.includes('morereviews') || js.includes('reviewchart')
        || aria.includes('review') || text === 'reviews';
    });
    if (target) {
      target.click();
      return true;
    }
    return false;
  }).catch(() => false);
}

function needsReviewEnrichment(place) {
  return place?.overallRating == null
    || place?.totalReviews == null
    || !hasReviewDistribution(place);
}

/** API place details + DOM/page-state for ratings, distribution, and contact fields. */
export async function enrichPlaceWithHybridData(page, place, {
  language = 'en',
  includeImages = false,
  maxImages = 10,
} = {}) {
  if (shouldSkipHybridDomEnrichment(place, { includeImages })) {
    console.log('[hybrid] API data sufficient — skipping DOM enrichment.');
    await resolvePlaceDisplayName(page, place);
    if (place.address && (!place.street || !place.city)) {
      mergePlaceFields(place, parseAddressParts(place.address));
    }
    finalizePlaceReviewStats(place);
    return place;
  }

  await resolvePlaceDisplayName(page, place);

  const needsReviews = needsReviewEnrichment(place);

  if (needsReviews) {
    console.log('[hybrid] Enriching missing review fields from Maps UI...');
  }
  if (needsReviews) {
    await dismissSignInPromptSafe(page).catch(() => { });
    await ensureTabbedLayout(page, { lang: language, fast: true });
    await nudgeToOverviewTab(page).catch(() => { });
    await sleep(600);

    const dom = await extractReviewSummaryFromDom(page);
    if (place.overallRating == null && dom.overallRating != null) place.overallRating = dom.overallRating;
    if (place.totalReviews == null && dom.totalReviews != null) place.totalReviews = dom.totalReviews;
    mergePlaceFields(place, { phone: dom.phone, website: dom.website, menu: dom.menu });

    const dist = await extractReviewDistribution(page);
    if (Object.values(dist).some((v) => v > 0)) {
      place.reviewsDistribution = dist;
    }

    const reviewsDom = await extractReviewSummaryFromDom(page);
    if (place.overallRating == null && reviewsDom.overallRating != null) place.overallRating = reviewsDom.overallRating;
    if (place.totalReviews == null && reviewsDom.totalReviews != null) place.totalReviews = reviewsDom.totalReviews;
    mergePlaceFields(place, { phone: reviewsDom.phone, website: reviewsDom.website, menu: reviewsDom.menu });

    if (place.overallRating == null || place.totalReviews == null) {
      const domInfo = await extractPlaceInfo(page);
      if (place.overallRating == null && domInfo.overallRating != null) place.overallRating = domInfo.overallRating;
      if (place.totalReviews == null && domInfo.totalReviews != null) place.totalReviews = domInfo.totalReviews;
      mergePlaceFields(place, domInfo);
    }

    finalizePlaceReviewStats(place);
    console.log(`[hybrid] Reviews: ${place.overallRating ?? '?'} stars, ${place.totalReviews ?? '?'} count, distribution=${JSON.stringify(place.reviewsDistribution)}`);
  }

  await enrichContactFromPage(page, place, { language });

  if (includeImages) {
    await enrichPhotosAndAbout(page, place, { maxImages });
  }

  if (includeImages) capPlaceImages(place, maxImages);
  else clearPlaceImages(place);
  finalizePlaceReviewStats(place);
  return place;
}

// ── Output schema ─────────────────────────────────────────────────────────────
export function formatPlaceToOutputSchema(place, searchString = null) {
  finalizePlaceReviewStats(place);

  const pageUrl = place?.pageUrl || null;
  const location = place?.location || extractCoordsFromUrl(pageUrl);
  const categoryName = place?.category || place?.categoryName || null;
  const categories = Array.isArray(place?.categories) && place.categories.length
    ? place.categories
    : (categoryName ? [categoryName] : []);
  const imageUrls = filterGalleryImageUrls([
    place?.imageUrl,
    ...(Array.isArray(place?.imageUrls) ? place.imageUrls : []),
  ]);
  const videoUrls = [...new Set(Array.isArray(place?.videoUrls) ? place.videoUrls : [])];
  const images = imageUrls.map((imageUrl) => ({
    imageUrl,
    authorName: null,
    authorUrl: null,
    uploadedAt: null,
  }));
  const imageUrl = imageUrls[0] || null;
  const reviewsDistribution = normalizeReviewsDistribution(place?.reviewsDistribution);

  return {
    searchString: searchString || null,
    rank: null,
    searchPageUrl: null,
    searchPageLoadedUrl: null,
    isAdvertisement: false,
    title: place?.name || null,
    subTitle: place?.subTitle || null,
    description: sanitizePlaceDescription(place?.description),
    price: place?.price || null,
    categoryName,
    address: place?.address || null,
    neighborhood: place?.neighborhood || null,
    street: place?.street || null,
    city: place?.city || null,
    postalCode: place?.postalCode || null,
    state: place?.state || null,
    countryCode: place?.countryCode || null,
    website: place?.website || null,
    phone: place?.phone || null,
    phoneUnformatted: unformatPhone(place?.phone),
    claimThisBusiness: false,
    location,
    locatedIn: place?.locatedIn || null,
    plusCode: place?.plusCode || null,
    menu: place?.menu || null,
    servicesLink: null,
    totalScore: place?.overallRating || null,
    permanentlyClosed: Boolean(place?.permanentlyClosed),
    temporarilyClosed: Boolean(place?.temporarilyClosed),
    placeId: place?.placeId || null,
    categories,
    fid: place?.fid || fidFromUrl(pageUrl),
    cid: place?.cid || cidFromUrl(pageUrl),
    reviewsCount: place?.totalReviews ?? null,
    reviewsDistribution,
    imagesCount: imageUrls.length,
    imageCategories: imageUrls.length ? ['All'] : [],
    scrapedAt: place?.scrapedAt || new Date().toISOString(),
    reserveTableUrl: null,
    googleFoodUrl: null,
    hotelStars: null,
    hotelDescription: null,
    checkInDate: null,
    checkOutDate: null,
    similarHotelsNearby: null,
    hotelReviewSummary: null,
    hotelAds: [],
    openingHours: Array.isArray(place?.openingHours) ? place.openingHours : [],
    peopleAlsoSearch: [],
    reviewsTags: [],
    additionalInfo: place?.additionalInfo && typeof place.additionalInfo === 'object' ? place.additionalInfo : {},
    videoUrls,
    gasPrices: [],
    questionsAndAnswers: [],
    updatesFromCustomers: null,
    ownerUpdates: [],
    url: pageUrl,
    imageUrl,
    kgmid: place?.kgmid || kgmidFromUrl(pageUrl),
    webResults: Array.isArray(place?.webResults) ? place.webResults : [],
    parentPlaceUrl: null,
    tableReservationLinks: [],
    bookingLinks: [],
    images,
    imageUrls,
    reviews: [],
    userPlaceNote: null,
    restaurantData: {},
  };
}

// ── DOM fallback scrape ───────────────────────────────────────────────────────
async function scrapeGoogleMapsPlaceDom(page, { url, language = 'en', placeId = null }) {
  console.log('[maps] Using DOM fallback for place details...');

  await ensureTabbedLayout(page, { lang: language });
  await nudgeToOverviewTab(page).catch(() => { });
  await verifyPageHydrated(page);
  await sleep(800);

  let place = await extractPlaceInfo(page);
  for (let i = 0; i < 4 && (!place?.name || place?.totalReviews == null); i++) {
    await sleep(1200 + i * 400);
    place = await extractPlaceInfo(page);
  }

  if (!place?.name) {
    const recovered = await recoverPlaceSelection(page, url).catch(() => false);
    if (recovered) {
      for (let i = 0; i < 5 && (!place?.name || place?.totalReviews == null); i++) {
        await sleep(800 + i * 250);
        place = await extractPlaceInfo(page);
      }
    }
  }

  if (!place?.name) throw new Error('Could not resolve place details or name from DOM.');

  place.pageUrl = page.url();
  place.cid = cidFromUrl(page.url());
  place.fid = fidFromUrl(page.url());
  place.kgmid = kgmidFromUrl(page.url());
  place.location = extractCoordsFromUrl(page.url());
  place.placeId = placeId || null;
  place.scrapedAt = new Date().toISOString();
  place.reviewsDistribution = await extractReviewDistribution(page);
  return place;
}

// ── Main scrape orchestrator (API-first) ──────────────────────────────────────
export async function scrapeGoogleMapsPlace(page, {
  url,
  language = 'en',
  placeId = null,
  searchString = null,
  searchQuery = null,
  skipHybridEnrich = false,
  skipWarmUp = true,
  includeImages = false,
  maxImages = 10,
}) {
  if (!skipWarmUp) {
    await warmUpGoogleMaps(page, language);
  } else {
    console.log('[maps] Skipping warm-up (already on place page from discovery).');
  }

  if (skipWarmUp && fidFromUrl(url) && page.url().includes(fidFromUrl(url))) {
    console.log(`[maps] Already on target place page: ${page.url()}`);
  } else {
    console.log(`[maps] Navigating to target place URL: ${url}`);
    await page.goto(enforceLanguage(url, language), { waitUntil: 'domcontentloaded', timeout: 90_000 });
  }

  try {
    await page.waitForFunction(
      () => !!(document.querySelector('#QA0Szd,[role="main"]') || document.querySelector('h1.DUwDvf,h1')),
      { timeout: 30_000 },
    );
  } catch { /* proceed */ }

  try {
    await page.evaluate(() => {
      const want = ['accept all', 'accept', 'i agree'];
      const n = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const btn = [...document.querySelectorAll('button,[role="button"]')].find((b) => want.some((w) => n(b.textContent).includes(w)));
      if (btn) btn.click();
    });
    await sleep(500);
  } catch { /* ignore */ }

  await dismissSignInPromptSafe(page).catch(() => { });

  let currentUrl = page.url();
  if (currentUrl.includes('/maps/search/')) {
    console.log(`[maps] On search page — waiting for redirect...`);
    for (let i = 0; i < 15; i++) {
      await sleep(300);
      currentUrl = page.url();
      if (currentUrl.includes('/maps/place/') || currentUrl.includes('/place/') || currentUrl.includes('cid=')) break;
    }
  }

  currentUrl = page.url();
  if (currentUrl.includes('/maps/search/')) {
    console.log('[maps] No redirect — clicking first search result...');
    const clicked = await clickFirstSearchResult(page);
    if (clicked) {
      for (let i = 0; i < 20; i++) {
        await sleep(250);
        currentUrl = page.url();
        if (currentUrl.includes('/maps/place/') || currentUrl.includes('/place/') || currentUrl.includes('cid=')) break;
      }
    }
  }

  const pageUrl = page.url();
  const fid = fidFromUrl(pageUrl) || fidFromUrl(url);
  let place = null;

  // ── API path: always fetch preview/place for the final Maps URL feature id ───
  try {
    if (fid) {
      console.log(`[api] Fetching preview/place for feature id ${fid}`);
      ({ place } = await scrapePlaceViaPreviewApi(page, {
        pageUrl,
        language,
        placeId,
        searchQuery,
      }));
    } else {
      console.warn('[api] No feature id in final URL — cannot call preview/place.');
    }
  } catch (apiErr) {
    console.warn(`[api] preview/place failed: ${apiErr.message}`);
  }

  if (!place?.name) {
    place = await scrapeGoogleMapsPlaceDom(page, { url, language, placeId });
  }

  if (!place?.name) throw new Error('Could not resolve place details from API or DOM.');

  if (!skipHybridEnrich) {
    await enrichPlaceWithHybridData(page, place, { language, includeImages, maxImages });
  } else {
    applyResolvedDisplayName(place, [
      place.subTitle,
      inferNameFromStreetAddress(place.address),
    ]);
    finalizePlaceReviewStats(place);
  }

  if (includeImages) capPlaceImages(place, maxImages);
  else clearPlaceImages(place);

  place.pageUrl = place.pageUrl || pageUrl;
  place.cid = place.cid || cidFromUrl(pageUrl);
  place.fid = place.fid || fidFromUrl(pageUrl);
  place.kgmid = place.kgmid || kgmidFromUrl(pageUrl);
  place.location = place.location || extractCoordsFromUrl(pageUrl);
  place.placeId = placeId || null;
  place.scrapedAt = place.scrapedAt || new Date().toISOString();

  console.log(`📍 ${place.name}  ⭐ ${place.overallRating}  📊 ${place.totalReviews ?? '?'} reviews`);
  console.log(`🔗 URL: ${place.pageUrl}`);

  return formatPlaceToOutputSchema(place, searchString);
}
