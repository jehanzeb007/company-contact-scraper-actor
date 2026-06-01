import { ABOUT_SECTION_HINTS } from './aboutInfo.js';
import {
  mergeAdditionalInfo,
  norm,
  normalizeAdditionalInfo,
  sanitizePlaceDescription,
} from './textHeuristics.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evaluateWithTimeout(page, pageFunction, arg, timeoutMs = 8000) {
  const task = arg === undefined
    ? page.evaluate(pageFunction)
    : page.evaluate(pageFunction, arg);
  return Promise.race([
    task,
    sleep(timeoutMs).then(() => { throw new Error(`page.evaluate timed out after ${timeoutMs}ms`); }),
  ]);
}

async function clickOverviewTab(page) {
  return clickMapsTab(page, ['overview', 'información', 'informacion', 'aperçu', 'apercu', 'übersicht']);
}

export function normalizeMediaUrl(url) {
  if (!url || typeof url !== 'string') return null;
  let u = url.replace(/\\u003d/g, '=').replace(/\\u0026/g, '&').trim();
  if (u.startsWith('//')) u = `https:${u}`;
  try {
    const parsed = new URL(u, 'https://www.google.com');
    if (!/^https?:$/i.test(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function isProfilePhotoUrl(url) {
  const u = String(url || '');
  if (/s44-p-k-no-ns-nd\/photo\.jpg/i.test(u)) return true;
  if (/\/AAAAAAAAAAI\/AAAAAAAAAAA\//i.test(u) && /=w\d{1,2}(-h\d{1,2})?-/i.test(u)) return true;
  if (/\/photo\.jpg/i.test(u) && /=w\d{1,2}(-h\d{1,2})?-/i.test(u) && !/=w\d{3,}/i.test(u)) return true;
  return false;
}

export function isPhotoMediaUrl(url) {
  const u = normalizeMediaUrl(url);
  if (!u) return false;
  if (isProfilePhotoUrl(u)) return false;
  if (/\.(mp4|webm|m3u8)(\?|$)/i.test(u)) return false;
  return /googleusercontent\.com|ggpht\.com|gstatic\.com\/images/i.test(u)
    && !/\/favicon|\/images\/branding\//i.test(u);
}

export function filterGalleryImageUrls(urls) {
  const out = [];
  const seen = new Set();
  for (const raw of urls || []) {
    const n = normalizeMediaUrl(raw);
    if (!n || !isPhotoMediaUrl(n)) continue;
    const key = n.replace(/=w\d+-h\d+/, '=w').replace(/=s\d+-/, '=s');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

export function isVideoMediaUrl(url) {
  const u = normalizeMediaUrl(url);
  if (!u) return false;
  return /\.(mp4|webm|m3u8)(\?|$)/i.test(u)
    || (/googleusercontent\.com|ggpht\.com/i.test(u) && /video|videoplayback/i.test(u));
}

export async function clickMapsTab(page, keywords = []) {
  const matchers = keywords.map((k) => norm(k).toLowerCase()).filter(Boolean);
  if (!matchers.length) return false;

  return evaluateWithTimeout(page, (keys) => {
    const n = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const matches = (el) => {
      const text = n(el.textContent);
      const aria = n(el.getAttribute('aria-label') || '');
      return keys.some((k) => text === k || text.includes(k) || aria === k || aria.includes(k));
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
      const hit = tabs.find(matches);
      if (hit) return clickEl(hit);
    }

    const fallback = [...document.querySelectorAll('[role="tab"], button')].find(matches);
    return clickEl(fallback);
  }, matchers, 8000).catch(() => false);
}

function collectMediaUrlsFromDom() {
  const photoUrls = new Set();
  const videoUrls = new Set();
  const pushUrl = (raw) => {
    const u = String(raw || '').replace(/\\u003d/g, '=').replace(/\\u0026/g, '&');
    if (!u || u.startsWith('data:')) return;
    const normalized = u.startsWith('//') ? `https:${u}` : u;
    if (/\.(mp4|webm|m3u8)(\?|$)/i.test(normalized) || /video/i.test(normalized)) {
      if (/googleusercontent|ggpht|gstatic/i.test(normalized)) videoUrls.add(normalized);
    } else if (/googleusercontent|ggpht/i.test(normalized)) {
      photoUrls.add(normalized);
    }
  };

  document.querySelectorAll('img[src],img[data-src],img[data-iurl],img[data-deferred-src]').forEach((img) => {
    pushUrl(img.getAttribute('src'));
    pushUrl(img.getAttribute('data-src'));
    pushUrl(img.getAttribute('data-iurl'));
    pushUrl(img.getAttribute('data-deferred-src'));
  });

  document.querySelectorAll('button[style*="background-image"],div[style*="background-image"],a[style*="background-image"]').forEach((el) => {
    const style = el.getAttribute('style') || '';
    const m = style.match(/url\(\s*["']?([^"')]+)/i);
    if (m) pushUrl(m[1]);
  });

  document.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') || '';
    if (/googleusercontent|ggpht|\.mp4|videoplayback/i.test(href)) pushUrl(href);
  });

  return { photoUrls: [...photoUrls], videoUrls: [...videoUrls] };
}

async function scrollGallery(page) {
  return page.evaluate(() => {
    const main = document.querySelector('[role="main"]');
    if (!main) return false;
    const scrollables = [
      main.querySelector('[role="region"]'),
      main.querySelector('[role="feed"]'),
      ...main.querySelectorAll('div[style*="overflow"]'),
      main,
    ].filter(Boolean);

    for (const el of scrollables) {
      const before = el.scrollTop;
      el.scrollTop = el.scrollTop + Math.max(el.clientHeight, 400);
      if (el.scrollTop !== before) return true;
    }
    return false;
  }).catch(() => false);
}

async function openPhotosPanel(page) {
  await clickOverviewTab(page).catch(() => { });
  await sleep(700);

  const opened = await evaluateWithTimeout(page, () => {
    const n = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const clickEl = (el) => {
      if (!el) return false;
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      el.click();
      return true;
    };

    const tablist = document.querySelector('[role="tablist"]');
    if (tablist) {
      const tabs = [...tablist.querySelectorAll('[role="tab"], button')];
      const photoTab = tabs.find((el) => {
        const text = n(el.textContent);
        const aria = n(el.getAttribute('aria-label') || '');
        return (text.includes('photos') || text.includes('fotos') || aria.includes('photos'))
          && !text.includes('profile') && !aria.includes('profile');
      });
      if (photoTab) return clickEl(photoTab);
    }

    const selectors = [
      'button[jsaction*="pane.heroHeaderImage"]',
      'button[jsaction*="pane.photo"]',
      'button[jsaction*="pane.wf"]',
      'button[aria-label*="Photos" i]',
      'button[aria-label*="Photo" i]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const label = n(el?.getAttribute('aria-label') || el?.textContent || '');
      if (el && label.includes('photo') && !label.includes('profile')) return clickEl(el);
    }
    return false;
  }, undefined, 8000).catch(() => false);

  if (opened) {
    console.log('[panels] Opened Photos & videos panel.');
    await sleep(1800);
  }
  return opened;
}

export async function extractPhotosFromAppState(page) {
  const urls = await page.evaluate(() => {
    const decode = (s) => String(s || '').replace(/\\u003d/g, '=').replace(/\\u0026/g, '&');
    const out = new Set();
    const data = window.APP_INITIALIZATION_STATE;
    if (!data) return [];
    const stack = [data];
    const seen = new Set();
    while (stack.length) {
      const cur = stack.pop();
      if (!cur || typeof cur !== 'object' || seen.has(cur)) continue;
      seen.add(cur);
      if (typeof cur === 'string' && /googleusercontent\.com|ggpht\.com/i.test(cur)) {
        const u = decode(cur);
        if (/^https?:\/\//i.test(u) || u.startsWith('//')) out.add(u.startsWith('//') ? `https:${u}` : u);
      }
      if (Array.isArray(cur)) {
        for (const v of cur) stack.push(v);
      } else {
        for (const v of Object.values(cur)) stack.push(v);
      }
    }
    return [...out];
  }).catch(() => []);

  return filterGalleryImageUrls(urls);
}

export async function extractPhotosFromOverview(page) {
  await clickOverviewTab(page).catch(() => { });
  await sleep(600);

  const raw = await page.evaluate(collectMediaUrlsFromDom).catch(() => ({ photoUrls: [], videoUrls: [] }));
  const imageUrls = filterGalleryImageUrls(raw.photoUrls || []);
  const videoUrls = (raw.videoUrls || [])
    .map((u) => normalizeMediaUrl(u))
    .filter((u) => u && isVideoMediaUrl(u));
  return { imageUrls, videoUrls };
}

export async function extractPhotosAndVideos(page, { maxScrolls = 15, maxPhotos = null } = {}) {
  const photoSet = new Set();
  const videoSet = new Set();
  const photoLimit = maxPhotos != null ? Math.max(1, Number(maxPhotos) || 10) : null;

  const fromState = await extractPhotosFromAppState(page);
  for (const u of fromState) photoSet.add(u);

  const overviewBatch = await extractPhotosFromOverview(page);
  for (const u of overviewBatch.imageUrls) photoSet.add(u);
  for (const u of overviewBatch.videoUrls) videoSet.add(u);

  const opened = await openPhotosPanel(page);
  if (!opened) {
    console.log('[panels] Photos & videos panel not opened — using overview/state URLs only.');
  } else if (!photoLimit || photoSet.size < photoLimit) {
    for (let i = 0; i < maxScrolls; i++) {
      const batch = await page.evaluate(collectMediaUrlsFromDom).catch(() => ({ photoUrls: [], videoUrls: [] }));
      for (const u of batch.photoUrls || []) {
        const n = normalizeMediaUrl(u);
        if (n && isPhotoMediaUrl(n)) photoSet.add(n);
      }
      for (const u of batch.videoUrls || []) {
        const n = normalizeMediaUrl(u);
        if (n && isVideoMediaUrl(n)) videoSet.add(n);
      }

      if (photoLimit && photoSet.size >= photoLimit) break;

      const scrolled = await scrollGallery(page);
      if (!scrolled) break;
      await sleep(500);
    }

    const afterTab = await extractPhotosFromAppState(page);
    for (const u of afterTab) photoSet.add(u);
  }

  let imageUrls = filterGalleryImageUrls([...photoSet]);
  if (photoLimit) imageUrls = imageUrls.slice(0, photoLimit);
  const videoUrls = [...new Set([...videoSet].map((u) => normalizeMediaUrl(u)).filter(Boolean))];
  const images = imageUrls.map((imageUrl) => ({
    imageUrl,
    authorName: null,
    authorUrl: null,
    uploadedAt: null,
  }));

  console.log(`[panels] Collected ${imageUrls.length} photo URL(s), ${videoUrls.length} video URL(s).`);
  return { imageUrls, videoUrls, images };
}

export function galleryScrollsForImageLimit(maxImages) {
  const n = Math.max(1, Number(maxImages) || 10);
  return Math.min(15, Math.max(2, Math.ceil(n / 4)));
}

export function clearPlaceImages(place) {
  if (!place) return place;
  place.imageUrl = null;
  place.imageUrls = [];
  place.images = [];
  place.videoUrls = [];
  return place;
}

export function capPlaceImages(place, maxImages = 10) {
  if (!place) return place;
  const merged = filterGalleryImageUrls([
    place?.imageUrl,
    ...(Array.isArray(place?.imageUrls) ? place.imageUrls : []),
  ]);
  const capped = merged.slice(0, Math.max(1, Number(maxImages) || 10));
  if (!capped.length) {
    clearPlaceImages(place);
    return place;
  }
  place.imageUrls = capped;
  place.images = capped.map((imageUrl) => ({
    imageUrl,
    authorName: null,
    authorUrl: null,
    uploadedAt: null,
  }));
  place.imageUrl = capped[0];
  return place;
}

function mergePhotosIntoPlace(place, photos) {
  if (!photos) return place;
  const merged = filterGalleryImageUrls([
    ...(Array.isArray(place?.imageUrls) ? place.imageUrls : []),
    ...(photos.imageUrls || []),
    place?.imageUrl,
  ]);
  if (merged.length) {
    place.imageUrls = merged;
    place.images = merged.map((imageUrl) => ({
      imageUrl,
      authorName: null,
      authorUrl: null,
      uploadedAt: null,
    }));
    const hero = normalizeMediaUrl(place.imageUrl);
    place.imageUrl = (hero && isPhotoMediaUrl(hero)) ? hero : merged[0];
  }
  if (photos.videoUrls?.length) {
    place.videoUrls = [...new Set([...(place.videoUrls || []), ...photos.videoUrls])];
  }
  return place;
}

async function scrollAboutPanel(page) {
  await evaluateWithTimeout(page, () => {
    const pane = document.querySelector('[jsaction*="pane.attributes"]')
      || document.querySelector('[role="main"]');
    if (!pane) return;
    const step = Math.max(280, Math.floor(pane.clientHeight * 0.85) || 320);
    pane.scrollTop = 0;
    for (let i = 0; i < 12; i++) {
      pane.scrollTop += step;
    }
    pane.scrollTop = 0;
    for (let i = 0; i < 12; i++) {
      pane.scrollTop += step;
    }
  }, undefined, 6000).catch(() => { });
}

function parseAboutDom(sectionHints) {
  const n = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const stripIcons = (s) => n(String(s || '').replace(/[\uE000-\uF8FF\u200B-\u200F]/g, ''));

  const main = document.querySelector('[jsaction*="pane.attributes"]')
    || document.querySelector('[role="main"]');
  if (!main) return { description: null, additionalInfo: {} };

  const headerLookup = new Map(sectionHints.map((h) => [h.toLowerCase(), h]));
  const resolveSection = (text) => {
    const t = stripIcons(text);
    if (!t || t.length > 80) return null;
    const lower = t.toLowerCase();
    if (headerLookup.has(lower)) return headerLookup.get(lower);
    if (/service options|dining options|popular for|health and safety/i.test(t) && t.length < 50) {
      return headerLookup.get(lower) || t;
    }
    return null;
  };

  const isItemLabel = (text, sectionTitle) => {
    const t = stripIcons(text);
    if (!t || t.length < 2 || t.length > 120) return null;
    if (/^\/[a-z0-9_./-]+$/i.test(t)) return null;
    if (/^has\s+/i.test(t)) return null;
    if (sectionTitle && t.toLowerCase() === sectionTitle.toLowerCase()) return null;
    return t;
  };

  const additionalInfo = {};
  const addItem = (section, item) => {
    if (!additionalInfo[section]) additionalInfo[section] = new Set();
    additionalInfo[section].add(item);
  };

  let currentSection = null;
  const nodes = main.querySelectorAll(
    'h2,h3,[role="heading"],div.fontTitleSmall,div.qrShPb,div.fontTitleMedium,li,button[aria-label],span[aria-label],div[aria-label]',
  );

  for (const el of nodes) {
    const raw = el.getAttribute?.('aria-label') || el.textContent;
    const text = stripIcons(raw);
    if (!text) continue;

    const section = resolveSection(text);
    if (section) {
      currentSection = section;
      continue;
    }

    if (!currentSection) continue;
    const item = isItemLabel(text, currentSection);
    if (!item) continue;
    if (el.children?.length > 0 && el.querySelector('li,span[aria-label],div[aria-label]')) continue;
    addItem(currentSection, item);
  }

  const headings = [...main.querySelectorAll('h2,h3,[role="heading"],div.fontTitleSmall,div.qrShPb,div.fontTitleMedium')];
  for (const heading of headings) {
    const title = resolveSection(heading.textContent);
    if (!title) continue;

    const items = additionalInfo[title] || new Set();
    let node = heading.nextElementSibling;
    let steps = 0;
    while (node && steps < 24) {
      const nextTitle = resolveSection(node.textContent);
      if (nextTitle && nextTitle !== title) break;

      [...node.querySelectorAll('span,li,div[aria-label],button[aria-label]')].forEach((el) => {
        const item = isItemLabel(el.getAttribute('aria-label') || el.textContent, title);
        if (item) items.add(item);
      });
      node = node.nextElementSibling;
      steps++;
    }
    if (items.size) additionalInfo[title] = items;
  }

  const out = {};
  for (const [key, set] of Object.entries(additionalInfo)) {
    if (set.size) out[key] = [...set];
  }
  return { description: null, additionalInfo: out };
}

export async function extractAboutFromOverview(page) {
  await clickOverviewTab(page).catch(() => { });
  await sleep(800);

  const opened = await evaluateWithTimeout(page, () => {
    const n = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const candidates = [...document.querySelectorAll(
      'button[jsaction*="pane.attributes"],button[jsaction*="about"],button[aria-label*="About" i],button[aria-label*="Acerca" i]',
    )];
    const hit = candidates.find((el) => {
      const text = n(el.textContent);
      const aria = n(el.getAttribute('aria-label') || '');
      return text === 'about' || aria.includes('about') || aria.includes('acerca')
        || /pane\.attributes/i.test(el.getAttribute('jsaction') || '');
    });
    if (hit) {
      hit.scrollIntoView({ block: 'center' });
      hit.click();
      return true;
    }
    return false;
  }, undefined, 6000).catch(() => false);

  if (opened) {
    console.log('[panels] Opened About section from Overview.');
    await sleep(1200);
  }

  await scrollAboutPanel(page);
  await sleep(400);

  const data = await page.evaluate(parseAboutDom, ABOUT_SECTION_HINTS).catch(() => ({
    description: null,
    additionalInfo: {},
  }));
  return {
    ...data,
    additionalInfo: normalizeAdditionalInfo(data.additionalInfo),
  };
}

export async function extractAboutTab(page) {
  const clicked = await clickMapsTab(page, [
    'about',
    'acerca',
    'über',
    'información',
    'informacion',
    'a propos',
    'apropos',
  ]);

  if (!clicked) {
    console.log('[panels] About tab not found.');
    return { description: null, additionalInfo: {} };
  }

  console.log('[panels] Opened About tab.');
  await sleep(2000);

  await scrollAboutPanel(page);
  await sleep(400);

  const data = await page.evaluate(parseAboutDom, ABOUT_SECTION_HINTS).catch(() => ({
    description: null,
    additionalInfo: {},
  }));

  const normalized = {
    ...data,
    additionalInfo: normalizeAdditionalInfo(data.additionalInfo),
  };
  const sectionCount = Object.keys(normalized.additionalInfo || {}).length;
  console.log(`[panels] About: description=${normalized.description ? 'yes' : 'no'}, sections=${sectionCount}`);
  return normalized;
}

const WEB_RESULTS_LABELS = [
  'web results',
  'resultados web',
  'résultats web',
  'resultats web',
  'resultados da web',
  'web-ergebnisse',
  'risultati web',
  'resultaten op het web',
];

export function parseWebResultsDom() {
  const n = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  const unwrapUrl = (href) => {
    try {
      const u = new URL(href, 'https://www.google.com');
      if (u.hostname.endsWith('google.com') && u.pathname === '/url') {
        const target = u.searchParams.get('q') || u.searchParams.get('url');
        if (target) return target;
      }
      return u.toString();
    } catch {
      return href;
    }
  };

  const isExternal = (url) => {
    if (!url || !/^https?:\/\//i.test(url)) return false;
    const lower = url.toLowerCase();
    if (/google\.com\/maps|maps\.google\.|goo\.gl\/maps|maps\.app\.goo/i.test(lower)) return false;
    if (/googleusercontent|gstatic\.com|ggpht\.com/i.test(lower)) return false;
    if (/accounts\.google|support\.google|policies\.google/i.test(lower)) return false;
    return true;
  };

  const main = document.querySelector('[role="main"]');
  if (!main) return [];

  let sectionRoot = main.querySelector('[data-section-id="webresults"],[data-section-id="web_results"]');
  let startNode = null;

  if (!sectionRoot) {
    for (const el of main.querySelectorAll('h2,h3,[role="heading"],div.fontTitleMedium,div.fontHeadlineSmall')) {
      const label = n(el.textContent).toLowerCase();
      if (WEB_RESULTS_LABELS.some((l) => label === l || label.startsWith(`${l} `))) {
        sectionRoot = el.closest('[role="region"],div[jsaction],div.m6QErb') || el.parentElement;
        startNode = el;
        break;
      }
    }
  }

  if (!sectionRoot) {
    const jsHit = main.querySelector('[jsaction*="webresult"],[jsaction*="webResult"],[jsaction*="wf.wb"]');
    if (jsHit) sectionRoot = jsHit.closest('[role="region"]') || jsHit.parentElement;
  }

  if (!sectionRoot && !startNode) return [];

  const root = sectionRoot || main;
  const scoped = sectionRoot && sectionRoot !== main;
  const results = [];
  const seen = new Set();

  const inWebSection = (el) => {
    if (scoped) return root.contains(el);
    if (startNode) {
      const pos = startNode.compareDocumentPosition(el);
      return (pos & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    }
    return false;
  };

  root.querySelectorAll('a[href^="http"],a[href^="https"]').forEach((a) => {
    if (!inWebSection(a)) return;
    const url = unwrapUrl(a.href);
    if (!isExternal(url)) return;

    const title = n(a.getAttribute('aria-label') || a.textContent);
    if (!title || title.length < 2 || title.length > 300) return;
    if (/^(open|visit|website|menu|directions|call|order)\b/i.test(title)) return;

    let description = null;
    const card = a.closest('div[jsaction],div.Nv2PK,div.m6QErb,div[role="article"]') || a.parentElement;
    if (card) {
      const snippets = [...card.querySelectorAll('span,div')]
        .map((node) => n(node.textContent))
        .filter((t) => t && t !== title && t.length > 15 && t.length < 500 && !/^https?:\/\//i.test(t));
      description = snippets.find((t) => !WEB_RESULTS_LABELS.some((l) => t.toLowerCase() === l)) || null;
    }

    let displayedUrl = null;
    try {
      displayedUrl = new URL(url).hostname.replace(/^www\./i, '');
    } catch { /* ignore */ }

    const key = url.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ title, url, displayedUrl, description });
  });

  return results.slice(0, 30);
}

async function scrollToWebResultsSection(page) {
  await clickOverviewTab(page).catch(() => { });
  await sleep(600);

  for (let i = 0; i < 14; i++) {
    const found = await page.evaluate((labels) => {
      const n = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const main = document.querySelector('[role="main"]');
      if (!main) return false;

      const hit = [...main.querySelectorAll('h2,h3,[role="heading"],div.fontTitleMedium,div.fontHeadlineSmall')]
        .find((el) => labels.some((l) => {
          const t = n(el.textContent);
          return t === l || t.startsWith(`${l} `);
        }));

      if (hit) {
        hit.scrollIntoView({ block: 'start', behavior: 'instant' });
        return true;
      }

      const section = main.querySelector('[data-section-id="webresults"],[data-section-id="web_results"]');
      if (section) {
        section.scrollIntoView({ block: 'start', behavior: 'instant' });
        return true;
      }

      const before = main.scrollTop;
      main.scrollTop = Math.min(main.scrollTop + Math.max(main.clientHeight, 500), main.scrollHeight);
      return main.scrollTop !== before;
    }, WEB_RESULTS_LABELS).catch(() => false);

    if (found) {
      await sleep(800);
      return true;
    }
    await sleep(350);
  }
  return false;
}

export async function extractWebResults(page) {
  await scrollToWebResultsSection(page);
  let results = await page.evaluate(parseWebResultsDom).catch(() => []);

  if (!results.length) {
    results = await page.evaluate(() => {
      const n = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const unwrap = (href) => {
        try {
          const u = new URL(href, 'https://www.google.com');
          if (u.hostname.endsWith('google.com') && u.pathname === '/url') {
            return u.searchParams.get('q') || u.searchParams.get('url') || href;
          }
          return u.toString();
        } catch {
          return href;
        }
      };
      const isExternal = (url) => url && /^https?:\/\//i.test(url)
        && !/google\.com\/maps|maps\.google/i.test(url)
        && !/googleusercontent|gstatic|ggpht/i.test(url);

      const main = document.querySelector('[role="main"]');
      if (!main) return [];
      const out = [];
      const seen = new Set();
      main.querySelectorAll('a[href^="http"]').forEach((a) => {
        const url = unwrap(a.href);
        if (!isExternal(url)) return;
        const title = n(a.textContent || a.getAttribute('aria-label'));
        if (!title || title.length < 4 || title.length > 200) return;
        const key = url.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        let displayedUrl = null;
        try { displayedUrl = new URL(url).hostname.replace(/^www\./i, ''); } catch { /* ignore */ }
        out.push({ title, url, displayedUrl, description: null });
      });
      return out.slice(0, 15);
    }).catch(() => []);
  }

  console.log(`[panels] Web results: ${results.length} link(s).`);
  return Array.isArray(results) ? results : [];
}

function mergeWebResultsIntoPlace(place, webResults) {
  if (!Array.isArray(webResults) || !webResults.length) return place;
  const existing = Array.isArray(place.webResults) ? place.webResults : [];
  const seen = new Set(existing.map((r) => String(r?.url || '').toLowerCase()).filter(Boolean));
  for (const item of webResults) {
    const key = String(item?.url || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    existing.push(item);
  }
  place.webResults = existing;
  return place;
}

function mergeAboutIntoPlace(place, about) {
  if (!about) return place;
  const aboutDesc = sanitizePlaceDescription(about.description);
  if (aboutDesc && !place.description) {
    place.description = aboutDesc;
  }
  if (about.additionalInfo && Object.keys(about.additionalInfo).length) {
    place.additionalInfo = mergeAdditionalInfo(place.additionalInfo, about.additionalInfo);
  }
  return place;
}

export async function enrichPhotosAndAbout(page, place, {
  includeImages = false,
  maxImages = 10,
  enrichPanels = true,
} = {}) {
  const parts = [];
  if (includeImages) parts.push(`up to ${maxImages} images`);
  if (enrichPanels) parts.push('web results & about');
  console.log(`[panels] Exploring${parts.length ? ` ${parts.join(', ')}` : ' panels'}...`);

  await clickOverviewTab(page).catch(() => { });
  await sleep(includeImages ? 800 : 400);

  if (includeImages) {
    mergePhotosIntoPlace(place, await extractPhotosFromOverview(page));
    mergePhotosIntoPlace(place, {
      imageUrls: await extractPhotosFromAppState(page),
      videoUrls: [],
    });
    capPlaceImages(place, maxImages);
  }

  if (enrichPanels) {
    const webResults = await extractWebResults(page);
    mergeWebResultsIntoPlace(place, webResults);

    const overviewAbout = await extractAboutFromOverview(page);
    mergeAboutIntoPlace(place, overviewAbout);

    await clickOverviewTab(page).catch(() => { });
    await sleep(400);

    const tabAbout = await extractAboutTab(page);
    mergeAboutIntoPlace(place, tabAbout);

    await clickOverviewTab(page).catch(() => { });
    await sleep(400);
  }

  if (includeImages) {
    const current = filterGalleryImageUrls([
      place?.imageUrl,
      ...(Array.isArray(place?.imageUrls) ? place.imageUrls : []),
    ]).length;
    if (current < maxImages) {
      mergePhotosIntoPlace(place, await extractPhotosAndVideos(page, {
        maxScrolls: galleryScrollsForImageLimit(maxImages),
        maxPhotos: maxImages,
      }));
    }
    capPlaceImages(place, maxImages);
  }

  await clickOverviewTab(page).catch(() => { });
  await sleep(300);

  return place;
}
