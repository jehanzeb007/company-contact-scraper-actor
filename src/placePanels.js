const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

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

export async function extractPhotosAndVideos(page, { maxScrolls = 15 } = {}) {
  const photoSet = new Set();
  const videoSet = new Set();

  const fromState = await extractPhotosFromAppState(page);
  for (const u of fromState) photoSet.add(u);

  const overviewBatch = await extractPhotosFromOverview(page);
  for (const u of overviewBatch.imageUrls) photoSet.add(u);
  for (const u of overviewBatch.videoUrls) videoSet.add(u);

  const opened = await openPhotosPanel(page);
  if (!opened) {
    console.log('[panels] Photos & videos panel not opened — using overview/state URLs only.');
  } else {
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

      const scrolled = await scrollGallery(page);
      if (!scrolled) break;
      await sleep(500);
    }

    const afterTab = await extractPhotosFromAppState(page);
    for (const u of afterTab) photoSet.add(u);
  }

  const imageUrls = filterGalleryImageUrls([...photoSet]);
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

function isCleanAboutItem(text) {
  const t = String(text || '').trim();
  if (!t || t.length < 2 || t.length > 120) return false;
  if (/^\/[a-z]/i.test(t)) return false;
  if (/^[\uE000-\uF8FF\u200B-\u200F]/.test(t)) return false;
  if (/^Has /i.test(t)) return false;
  return true;
}

function looksLikeUserReview(text) {
  const t = String(text || '');
  if (t.length < 180) return false;
  const signals = [
    /\bI\s+(was|am|had|went|looked|will|completely)\b/i,
    /\bmy\s+(trade-in|phone|device|experience)\b/i,
    /\bhighly recommend\b/i,
    /\bthis is the only\b/i,
    /\baround \d+:\d+\s*(AM|PM)\b/i,
    /\b(November|December|January|February|March|April|May|June|July|August|September|October)\s+\d{1,2}/i,
    /\bstore manager\b/i,
    /\bstars?\s*,\s*\d+\s*reviews?\b/i,
  ];
  return signals.filter((r) => r.test(t)).length >= 2;
}

const ABOUT_SECTION_HINTS = [
  'Accessibility', 'Amenities', 'Crowd', 'Planning', 'Payments', 'Children',
  'Parking', 'Offerings', 'Dining options', 'Service options', 'Highlights',
  'From the business', 'Popular for', 'Atmosphere', 'Health and safety',
];

function parseAboutDom(sectionHints) {
  const n = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const main = document.querySelector('[role="main"]');
  if (!main) return { description: null, additionalInfo: {}, placesTags: [] };

  let description = null;
  const descSelectors = [
    '.PbZDve',
    '.wiI7pd',
    '[data-section-id="overview"]',
    'div[jsaction*="description"]',
    'div[jsaction*="pane.attributes"] .fontBodyMedium',
  ];
  for (const sel of descSelectors) {
    const el = main.querySelector(sel);
    const text = n(el?.textContent);
    if (text && text.length > 40 && text.length < 5000 && !looksLikeUserReview(text)) {
      description = text;
      break;
    }
  }

  if (!description) {
    const paragraphs = [...main.querySelectorAll('div,span,p')]
      .map((el) => n(el.textContent))
      .filter((t) => t.length > 60 && t.length < 3000 && /\s/.test(t) && !looksLikeUserReview(t));
    const editorial = paragraphs.find((t) => !/reviews?|photos?|hours|menu|order|directions/i.test(t));
    if (editorial) description = editorial;
  }

  const additionalInfo = {};
  const placesTags = [];
  const isHeading = (text) => sectionHints.some((h) => {
    const lower = text.toLowerCase();
    return lower === h.toLowerCase() || lower.startsWith(h.toLowerCase());
  });

  const headings = [...main.querySelectorAll('h2,h3,[role="heading"],div.fontTitleSmall,div.qrShPb,div.fontTitleMedium')];
  for (const heading of headings) {
    const title = n(heading.textContent);
    if (!title || title.length > 80) continue;
    if (!isHeading(title) && !/options|accessibility|amenities|highlights|planning|payments/i.test(title)) continue;

    const items = new Set();
    let node = heading.nextElementSibling;
    let steps = 0;
    while (node && steps < 10) {
      [...node.querySelectorAll('span,li,div[aria-label],button[aria-label]')].forEach((el) => {
        const item = n(el.getAttribute('aria-label') || el.textContent);
        if (item && item !== title && isCleanAboutItem(item)) items.add(item);
      });
      node = node.nextElementSibling;
      steps++;
    }

    if (items.size) {
      additionalInfo[title] = [...items];
      placesTags.push(...items);
    }
  }

  [...main.querySelectorAll('button[data-item-id],div[data-item-id]')].forEach((el) => {
    const id = el.getAttribute('data-item-id') || '';
    if (!/place_attributes|attributes|about/i.test(id)) return;
    const label = n(el.getAttribute('aria-label') || el.textContent);
    if (isCleanAboutItem(label)) placesTags.push(label);
  });

  [...main.querySelectorAll('[aria-label]')].forEach((el) => {
    const label = n(el.getAttribute('aria-label'));
    if (!label || label.length > 60) return;
    if (sectionHints.some((h) => label.toLowerCase().startsWith(h.toLowerCase()))) {
      const items = [...el.querySelectorAll('[aria-label]')]
        .map((child) => n(child.getAttribute('aria-label')))
        .filter((t) => t && t !== label && isCleanAboutItem(t));
      if (items.length) additionalInfo[label] = [...new Set(items)];
    }
  });

  return { description, additionalInfo, placesTags: [...new Set(placesTags)] };
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

  return page.evaluate(parseAboutDom, ABOUT_SECTION_HINTS).catch(() => ({
    description: null,
    additionalInfo: {},
    placesTags: [],
  }));
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
    return { description: null, additionalInfo: {}, placesTags: [] };
  }

  console.log('[panels] Opened About tab.');
  await sleep(1500);

  const data = await page.evaluate(parseAboutDom, ABOUT_SECTION_HINTS).catch(() => ({
    description: null,
    additionalInfo: {},
    placesTags: [],
  }));

  const sectionCount = Object.keys(data.additionalInfo || {}).length;
  console.log(`[panels] About: description=${data.description ? 'yes' : 'no'}, sections=${sectionCount}`);
  return data;
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
  if (about.description && !place.description && !looksLikeUserReview(about.description)) {
    place.description = about.description;
  }
  if (about.additionalInfo && Object.keys(about.additionalInfo).length) {
    place.additionalInfo = { ...(place.additionalInfo || {}), ...about.additionalInfo };
  }
  if (about.placesTags?.length) {
    place.placesTags = [...new Set([...(place.placesTags || []), ...about.placesTags])];
  }
  return place;
}

export async function enrichPhotosAndAbout(page, place) {
  console.log('[panels] Exploring photos, web results, and about...');

  await clickOverviewTab(page).catch(() => { });
  await sleep(800);

  mergePhotosIntoPlace(place, await extractPhotosFromOverview(page));
  mergePhotosIntoPlace(place, {
    imageUrls: await extractPhotosFromAppState(page),
    videoUrls: [],
  });

  const webResults = await extractWebResults(page);
  mergeWebResultsIntoPlace(place, webResults);

  const overviewAbout = await extractAboutFromOverview(page);
  mergeAboutIntoPlace(place, overviewAbout);

  await clickOverviewTab(page).catch(() => { });
  await sleep(500);

  const tabAbout = await extractAboutTab(page);
  mergeAboutIntoPlace(place, tabAbout);

  await clickOverviewTab(page).catch(() => { });
  await sleep(500);

  mergePhotosIntoPlace(place, await extractPhotosAndVideos(page));

  await clickOverviewTab(page).catch(() => { });
  await sleep(500);

  return place;
}
