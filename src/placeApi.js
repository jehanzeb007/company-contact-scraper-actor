import { resolveAddressParts } from './addressParts.js';
import { extractAboutFromPreviewData } from './aboutInfo.js';
import {
  inferNameFromStreetAddress,
  isWeakStructuralPlaceName,
  norm,
  normalizeAdditionalInfo,
} from './textHeuristics.js';

export { norm } from './textHeuristics.js';

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

export function stripXssiPrefix(s) {
  return String(s || '').replace(/^\)\]\}'\s*/, '');
}

export function parsePreviewPlaceJson(text) {
  const cleaned = stripXssiPrefix(text).trim();
  if (!cleaned) throw new Error('Empty preview/place response');
  return JSON.parse(cleaned);
}

/** Standard field selectors for full place detail payload (matches Maps web client). */
const DETAIL_PB_SUFFIX = (
  '!12m4!2m3!1i360!2i120!4i8!13m57!2m2!1i203!2i100!3m2!2i4!5b1!6m6!1m2!1i86!2i86!1m2!1i408!2i240!7m33'
  + '!1m3!1e1!2b0!3e3!1m3!1e2!2b1!3e2!1m3!1e2!2b0!3e3!1m3!1e8!2b0!3e3!1m3!1e10!2b0!3e3!1m3!1e10!2b1!3e2!1m3!1e10!2b0!3e4!1m3!1e9!2b1!3e2!2b1!9b0'
  + '!15m8!1m7!1m2!1m1!1e2!2m2!1i195!2i195!3i20!14m2!1saFEQao_hLaG7kdUPqaiF4QM!7e81!15m110!1m28!13m9!2b1!3b1!4b1!6i1!8b1!9b1!14b1!20b1!25b1'
  + '!18m17!3b1!4b1!5b1!6b1!9b1!13b1!14b1!17b1!20b1!21b1!22b1!30b1!32b1!33m1!1b1!34b1!36e2!10m1!8e3!11m1!3e1!17b1!20m2!1e3!1e6!24b1!25b1!26b1!27b1!29b1!30m1!2b1!36b1!37b1!39m3!2m2!2i1!3i1!43b1!52b1!54m1!1b1!55b1!56m1!1b1!61m2!1m1!1e1!65m5!3m4!1m3!1m2!1i224!2i298!72m22!1m8!2b1!5b1!7b1!12m4!1b1!2b1!4m1!1e1!4b1!8m10!1m6!4m1!1e1!4m1!1e3!4m1!1e4!3sother_user_google_review_posts__and__hotel_and_vr_partner_review_posts!6m1!1e1!9b1!89b1!90m2!1m1!1e2!98m3!1b1!2b1!3b1!103b1!113b1!114m3!1b1!2m1!1b1!117b1!122m1!1b1!126b1!127b1!128m1!1b0!21m28!1m6!1m2!1i0!2i0!2m2!1i530!2i911!1m6!1m2!1i820!2i0!2m2!1i870!2i911!1m6!1m2!1i0!2i0!2m2!1i870!2i20!1m6!1m2!1i0!2i891!2m2!1i870!2i911!22m1!1e81!30m6!3b1!6m1!2b1!7m1!2b1!9b1!34m5!7b1!10b1!14b1!15m1!1b0!37i780'
);

export function buildPreviewPlacePb({ fid, lat, lng, query, kgmid }) {
  if (!fid) throw new Error('Cannot build preview/place pb without feature id (0x...:0x...)');

  const latN = Number(lat);
  const lngN = Number(lng);
  const hasCoords = Number.isFinite(latN) && Number.isFinite(lngN);

  let pb = `!1m16!1s${fid}`;
  if (hasCoords) {
    pb += `!3m8!1m3!1d4035.4416279464617!2d${lngN}!3d${latN}!3m2!1i870!2i911!4f13.1!4m2!3d${latN}!4d${lngN}`;
  } else {
    pb += '!3m8!1m3!1d5000!2d0!3d0!3m2!1i1024!2i768!4f13.1!4m2!3d0!4d0';
  }
  if (kgmid) pb += `!15m2!1m1!4s${encodeURIComponent(kgmid)}`;
  pb += DETAIL_PB_SUFFIX;
  if (query) {
    const q = String(query).trim();
    pb += `!39s${encodeURIComponent(q)}&q=${encodeURIComponent(q)}`;
  }
  return pb;
}

export function buildPreviewPlaceUrl({ pb, language = 'en' }) {
  const params = new URLSearchParams({
    authuser: '0',
    hl: language || 'en',
    pb,
  });
  return `https://www.google.com/maps/preview/place?${params.toString()}`;
}

function findHistogramInData(data) {
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
          return normalizeReviewsDistribution(dist);
        }
      }
    }
    if (Array.isArray(cur)) {
      for (const v of cur) if (v && typeof v === 'object') stack.push(v);
    } else {
      for (const v of Object.values(cur)) if (v && typeof v === 'object') stack.push(v);
    }
  }
  return null;
}

function isPlausibleHistogramDist(dist) {
  const d = normalizeReviewsDistribution(dist);
  const counts = [d.oneStar, d.twoStar, d.threeStar, d.fourStar, d.fiveStar].map((n) => Number(n) || 0);
  const sum = counts.reduce((a, b) => a + b, 0);
  if (sum <= 0) return false;
  if (counts.filter((c) => c > 0).length < 2) return false;
  if (Math.max(...counts) === sum && sum > 50) return false;
  return true;
}

function findFiveStarCounts(arr) {
  if (!Array.isArray(arr) || arr.length !== 5) return null;
  if (!arr.every((n) => typeof n === 'number' && n >= 0)) return null;
  const total = arr.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const dist = normalizeReviewsDistribution({
    '1_star': arr[0],
    '2_star': arr[1],
    '3_star': arr[2],
    '4_star': arr[3],
    '5_star': arr[4],
  });
  return isPlausibleHistogramDist(dist) ? dist : null;
}

const FID_RE = /^0x[0-9a-f]+:0x[0-9a-f]+$/i;

function walkArrays(node, visit) {
  if (node == null) return;
  if (Array.isArray(node)) {
    visit(node);
    for (const item of node) walkArrays(item, visit);
  } else if (typeof node === 'object') {
    for (const v of Object.values(node)) walkArrays(v, visit);
  }
}

function looksLikeAddress(value, placeName) {
  const t = norm(value);
  if (!t || t.length < 12 || t.length > 300) return false;
  if (/^\d+\s*reviews?$/i.test(t)) return false;
  if (/\breviews?\b/i.test(t) && !/\d+\s+\w+/.test(t)) return false;
  if (!t.includes(',')) return false;
  if (/^https?:\/\//i.test(t)) return false;
  if (placeName && t.toLowerCase().includes(placeName.toLowerCase().slice(0, Math.min(12, placeName.length)))) {
    return true;
  }
  return /\d/.test(t) && /[a-z]/i.test(t) && t.split(',').length >= 2;
}

function extractRatingReviewsNear(context, idx) {
  let best = { overallRating: null, totalReviews: null, score: 0 };

  const consider = (rating, reviews) => {
    if (typeof rating !== 'number' || rating <= 0 || rating > 5) return;
    if (typeof reviews !== 'number' || reviews < 0 || reviews >= 50_000_000) return;
    let score = reviews;
    if (rating % 1 !== 0) score *= 100;
    else if (rating === 5 && reviews > 500) score *= 0.01;
    if (score > best.score) best = { overallRating: rating, totalReviews: reviews, score };
  };

  for (let i = 0; i < context.length - 1; i++) {
    consider(context[i], context[i + 1]);
    if (Array.isArray(context[i]) && context[i].length >= 2) {
      consider(context[i][0], context[i][1]);
    }
  }

  for (let o = 1; o <= 12; o++) {
    const j = idx - o;
    if (j < 0) continue;
    consider(context[j], context[j + 1]);
  }

  return { overallRating: best.overallRating, totalReviews: best.totalReviews };
}

function findFlatFiveCountArray(data) {
  let best = null;
  walkArrays(data, (arr) => {
    if (arr.length !== 5) return;
    if (!arr.every((n) => typeof n === 'number' && n >= 0 && Number.isFinite(n))) return;
    const sum = arr.reduce((a, b) => a + b, 0);
    if (sum <= 0) return;
    const dist = normalizeReviewsDistribution({
      '1_star': arr[0],
      '2_star': arr[1],
      '3_star': arr[2],
      '4_star': arr[3],
      '5_star': arr[4],
    });
    if (!isPlausibleHistogramDist(dist)) return;
    if (!best || sum > best.sum) best = { arr, sum };
  });
  if (!best) return null;
  return normalizeReviewsDistribution({
    '1_star': best.arr[0],
    '2_star': best.arr[1],
    '3_star': best.arr[2],
    '4_star': best.arr[3],
    '5_star': best.arr[4],
  });
}

function findReviewStatsNearFidInText(stripped, fid) {
  if (!fid) return {};
  const idx = stripped.indexOf(`"${fid}"`);
  if (idx < 0) return {};
  const slice = stripped.slice(Math.max(0, idx - 800), idx + 400);
  const matches = [...slice.matchAll(/(\d(?:\.\d+)?),\s*(\d{1,9})\]/g)];
  if (!matches.length) return {};
  let best = null;
  for (const m of matches) {
    const rating = Number(m[1]);
    const reviews = Number(m[2]);
    if (rating <= 0 || rating > 5 || reviews < 0) continue;
    let score = reviews;
    if (rating % 1 !== 0) score *= 100;
    else if (rating === 5 && reviews > 500) score *= 0.01;
    if (!best || score > best.score) best = { overallRating: rating, totalReviews: reviews, score };
  }
  if (best) return { overallRating: best.overallRating, totalReviews: best.totalReviews };
  return {};
}

function isExternalHttpUrl(value) {
  if (!value || !/^https?:\/\//i.test(value)) return false;
  return !/google\.|gstatic\.|ggpht|googleusercontent|goo\.gl|maps\.app/i.test(value);
}

function classifyExternalUrl(url) {
  if (!isExternalHttpUrl(url)) return null;
  const lower = url.toLowerCase();
  if (/menu|\/order|food\.|ubereats|doordash|grubhub|foodpanda/i.test(lower)) return 'menu';
  return 'website';
}

function extractContextFields(context, idx, placeName) {
  let address = null;
  let phone = null;
  let website = null;
  let menu = null;
  let imageUrl = null;
  let price = null;
  let plusCode = null;

  for (let i = 0; i < context.length - 1; i++) {
    const a = context[i];
    const b = context[i + 1];
    if (typeof a === 'string' && typeof b === 'string' && isExternalHttpUrl(a) && /\.[a-z]{2,}/i.test(b)) {
      const kind = classifyExternalUrl(a);
      if (kind === 'menu' && !menu) menu = a;
      else if (!website) website = a;
    }
  }

  for (const value of context) {
    if (typeof value !== 'string') continue;
    const t = norm(value);
    if (!phone && /^\+[\d\s().-]{8,}$/.test(t)) phone = t;
    if (!phone && /^0\d{9,12}$/.test(t.replace(/\s/g, ''))) phone = t;
    if (isExternalHttpUrl(t)) {
      const kind = classifyExternalUrl(t);
      if (kind === 'menu' && !menu) menu = t;
      else if (!website) website = t;
    }
    if (!imageUrl && /googleusercontent\.com/i.test(t)) imageUrl = t.replace(/\\u003d/g, '=');
    if (!price && /^\${1,4}(?:\s*[–-]\s*\${1,4})?$/.test(t)) price = t;
    if (!plusCode && /^[2-9CFGHJMPQRVWX]{4,}\+[2-9CFGHJMPQRVWX]{2,}$/.test(t)) plusCode = t;
    if (!address && looksLikeAddress(t, placeName)) address = t;
  }

  return { address, phone, website, menu, imageUrl, price, plusCode };
}

function deepExtractContactFromData(data, placeName) {
  const out = { phone: null, website: null, menu: null, address: null };
  walkArrays(data, (arr) => {
    const chunk = extractContextFields(arr, arr.length, placeName);
    if (!out.phone && chunk.phone) out.phone = chunk.phone;
    if (!out.website && chunk.website) out.website = chunk.website;
    if (!out.menu && chunk.menu) out.menu = chunk.menu;
    if (!out.address && chunk.address) out.address = chunk.address;
  });
  return out;
}

export function extractContactFromPreviewText(stripped, fid, placeName) {
  const out = { phone: null, website: null, menu: null };
  if (!stripped) return out;

  const idx = fid ? stripped.indexOf(`"${fid}"`) : -1;
  const slices = idx > 0
    ? [stripped.slice(Math.max(0, idx - 2500), idx), stripped.slice(idx, idx + 1500)]
    : [stripped];

  for (const slice of slices) {
    const phones = [...slice.matchAll(/"(\+\d[\d\s().-]{8,})"/g)];
    if (!out.phone && phones.length) out.phone = norm(phones[0][1]);

    const siteMatches = [...slice.matchAll(/"(https?:\/\/[^"]+)",\s*"([a-z0-9][a-z0-9.-]+\.[a-z]{2,})"/gi)];
    for (const m of siteMatches.reverse()) {
      const url = m[1];
      const kind = classifyExternalUrl(url);
      if (kind === 'menu' && !out.menu) out.menu = url;
      else if (!out.website && kind === 'website') out.website = url;
    }

    const menuLinks = [...slice.matchAll(/"(https?:\/\/[^"]*(?:menu|order)[^"]*)"/gi)];
    for (const m of menuLinks) {
      if (!out.menu && isExternalHttpUrl(m[1])) out.menu = m[1];
    }
  }

  return out;
}

function extractPlaceRecords(data) {
  const records = [];
  walkArrays(data, (arr) => {
    for (let i = 0; i <= arr.length - 4; i++) {
      const fid = arr[i];
      if (typeof fid !== 'string' || !FID_RE.test(fid)) continue;
      const name = arr[i + 1];
      if (typeof name !== 'string' || name.length < 2 || name.length > 200) continue;
      if (/^https?:\/\//i.test(name) || /\breviews?\b/i.test(name)) continue;
      const marker = arr[i + 2];
      if (marker !== null && marker !== undefined) continue;
      const types = arr[i + 3];
      if (!Array.isArray(types) || !types.length || typeof types[0] !== 'string') continue;

      const { overallRating, totalReviews } = extractRatingReviewsNear(arr, i);
      const contextFields = extractContextFields(arr, i, name);

      records.push({
        fid,
        name: norm(name),
        types: types.filter((t) => typeof t === 'string'),
        overallRating,
        totalReviews,
        ...contextFields,
      });
    }
  });
  return records;
}

function scorePlaceNameCandidate(record, { searchQuery = null, address = null } = {}) {
  if (!record || isWeakStructuralPlaceName(record.name, record.types)) return -1;

  let score = 0;
  const addr = norm(address || '');
  const rAddr = norm(record.address || '');
  if (addr && rAddr) {
    if (addr === rAddr) score += 50;
    else if (addr.includes(rAddr) || rAddr.includes(addr)) score += 25;
  }

  const reviews = Number(record.totalReviews);
  if (Number.isFinite(reviews) && reviews > 0) {
    score += Math.min(25, Math.log10(reviews + 1) * 8);
  }

  const primary = norm(record.types?.[0] || '').toLowerCase();
  if (/mall|shopping|department|store|restaurant|museum|airport|hospital|university|church|park|hotel|stadium|arena|library|gym|spa|salon|bank|pharmacy|supermarket|establishment|point_of_interest/i.test(primary)) {
    score += 15;
  }

  if (searchQuery) {
    const q = norm(searchQuery).toLowerCase();
    const title = record.name.toLowerCase();
    if (title.includes(q) || q.includes(title)) score += 40;
    for (const token of q.split(/\s+/).filter((t) => t.length > 2)) {
      if (title.includes(token)) score += 8;
    }
  }

  return score;
}

function findBetterPlaceName(records, weakRecord, hints = {}) {
  let bestName = null;
  let bestScore = 0;
  const address = weakRecord.address || hints.address || null;

  for (const r of records) {
    if (r.fid === weakRecord.fid) continue;
    const score = scorePlaceNameCandidate(r, { ...hints, address });
    if (score > bestScore) {
      bestScore = score;
      bestName = r.name;
    }
  }

  return bestScore >= 15 ? bestName : null;
}

function findAlternateNameNearFid(data, fid) {
  let best = null;
  walkArrays(data, (arr) => {
    const idx = arr.indexOf(fid);
    if (idx < 0) return;
    const start = Math.max(0, idx - 20);
    const end = Math.min(arr.length, idx + 80);
    for (let i = start; i <= end - 4; i++) {
      const candidateFid = arr[i];
      if (typeof candidateFid !== 'string' || !FID_RE.test(candidateFid) || candidateFid === fid) continue;
      const name = arr[i + 1];
      if (typeof name !== 'string' || name.length < 2 || name.length > 200) continue;
      if (arr[i + 2] !== null && arr[i + 2] !== undefined) continue;
      const types = arr[i + 3];
      if (!Array.isArray(types) || !types.length) continue;
      if (isWeakStructuralPlaceName(name, types)) continue;
      best = norm(name);
    }
  });
  return best;
}

function resolvePlaceRecordName(record, records, hints, data) {
  if (!record || !isWeakStructuralPlaceName(record.name, record.types)) return record;

  const structuralLabel = record.name;
  const resolved = findBetterPlaceName(records, record, hints)
    || findAlternateNameNearFid(data, record.fid)
    || inferNameFromStreetAddress(record.address);

  if (!resolved || resolved.toLowerCase() === structuralLabel.toLowerCase()) return record;

  return { ...record, name: resolved, structuralLabel };
}

function pickPlaceRecord(records, { expectedFid = null, searchQuery = null } = {}) {
  if (!records.length) return null;
  if (expectedFid) {
    const exact = records.find((r) => r.fid === expectedFid);
    if (exact) return exact;
  }
  if (searchQuery) {
    const q = norm(searchQuery).toLowerCase();
    const tokens = q.split(' ').filter((t) => t.length > 2);
    let best = null;
    let bestScore = -1;
    for (const r of records) {
      const title = r.name.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (title.includes(token)) score += 10;
      }
      if (title.includes(q) || q.includes(title)) score += 50;
      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }
    if (best && bestScore > 0) return best;
  }
  return records[0];
}

export function responseContainsFid(text, fid) {
  if (!text || !fid) return false;
  return text.includes(fid);
}

export function pbContainsFid(pb, fid) {
  if (!pb || !fid) return false;
  try {
    return decodeURIComponent(pb).includes(fid);
  } catch {
    return pb.includes(fid);
  }
}

function extractOpeningHoursFromText(text) {
  const hours = [];
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const re = /\["(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)"[^\]]*\[\["([^"]+)"/g;
  const seen = new Set();
  let m;
  while ((m = re.exec(text)) !== null) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    const cleaned = m[2]
      .replace(/[\u200b\u202f\xa0]/g, ' ')
      .replace(/\u2013|\u2014/g, '-')
      .trim();
    hours.push({ day: m[1], hours: cleaned });
  }
  return hours;
}

function unwrapGoogleRedirectUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith('google.com') && u.pathname === '/url') {
      const target = u.searchParams.get('q') || u.searchParams.get('url');
      if (target) return target;
    }
  } catch { /* ignore */ }
  return url;
}

function isWebResultUrl(url) {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  const lower = url.toLowerCase();
  if (/google\.com\/maps|maps\.google\.|goo\.gl\/maps|maps\.app\.goo/i.test(lower)) return false;
  if (/googleusercontent|gstatic\.com|ggpht\.com/i.test(lower)) return false;
  if (/accounts\.google|support\.google|policies\.google/i.test(lower)) return false;
  return true;
}

export function normalizeWebResult(item) {
  const url = unwrapGoogleRedirectUrl(String(item?.url || ''));
  if (!isWebResultUrl(url)) return null;
  const title = norm(item?.title);
  if (!title || title.length < 2 || title.length > 300) return null;
  if (/^https?:\/\//i.test(title)) return null;
  let displayedUrl = null;
  try {
    displayedUrl = new URL(url).hostname.replace(/^www\./i, '');
  } catch { /* ignore */ }
  const description = item?.description ? norm(item.description) : null;
  return {
    title,
    url,
    displayedUrl,
    description: description && description.length > 5 && description.length < 800 ? description : null,
  };
}

function isGalleryImageUrl(url) {
  const u = String(url || '').replace(/\\u003d/g, '=').replace(/\\u0026/g, '&');
  if (!/googleusercontent\.com|ggpht\.com/i.test(u)) return false;
  if (/s44-p-k-no-ns-nd\/photo\.jpg/i.test(u)) return false;
  if (/\/AAAAAAAAAAI\/AAAAAAAAAAA\//i.test(u)) return false;
  if (/\/photo\.jpg/i.test(u) && /=w\d{1,2}(-h\d{1,2})?-/i.test(u) && !/=w\d{3,}/i.test(u)) return false;
  return true;
}

export function extractImageUrlsFromPreviewData(data) {
  const urls = new Set();
  walkArrays(data, (arr) => {
    for (const v of arr) {
      if (typeof v !== 'string') continue;
      const raw = v.replace(/\\u003d/g, '=').replace(/\\u0026/g, '&');
      if (!isGalleryImageUrl(raw)) continue;
      const normalized = raw.startsWith('//') ? `https:${raw}` : raw;
      if (/^https?:\/\//i.test(normalized)) urls.add(normalized);
    }
  });
  return [...urls].slice(0, 80);
}

export function extractWebResultsFromPreviewData(data) {
  const results = [];
  const seen = new Set();

  const pushRaw = (raw) => {
    const item = normalizeWebResult(raw);
    if (!item) return;
    const key = item.url.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    results.push(item);
  };

  walkArrays(data, (arr) => {
    for (let i = 0; i < arr.length - 1; i++) {
      const a = arr[i];
      const b = arr[i + 1];
      if (typeof a !== 'string' || typeof b !== 'string') continue;
      const title = norm(a);
      const url = unwrapGoogleRedirectUrl(b);
      if (!title || title.length < 3 || title.length > 300) continue;
      if (!isWebResultUrl(url)) continue;
      if (/^\+?\d[\d\s().-]{7,}$/.test(title)) continue;
      if (FID_RE.test(title) || /^0x[0-9a-f]+:0x[0-9a-f]+$/i.test(title)) continue;
      if (/^\d+\s*reviews?$/i.test(title)) continue;

      let description = null;
      const c = arr[i + 2];
      if (typeof c === 'string' && c.length > 12 && c.length < 800 && !/^https?:\/\//i.test(c)) {
        description = norm(c);
      }
      pushRaw({ title, url, description });
    }
  });

  return results.slice(0, 30);
}

export function parsePreviewPlaceResponse(text, hints = {}) {
  const stripped = stripXssiPrefix(text);
  let data;
  try {
    data = JSON.parse(stripped);
  } catch (e) {
    throw new Error(`preview/place JSON parse failed: ${e.message}`);
  }

  const records = extractPlaceRecords(data);
  let record = pickPlaceRecord(records, {
    expectedFid: hints.fid || null,
    searchQuery: hints.query || null,
  });
  record = resolvePlaceRecordName(record, records, {
    searchQuery: hints.query || null,
    address: record?.address || null,
  }, data);

  if (!record?.name) {
    throw new Error('preview/place JSON did not contain a recognizable place record');
  }

  if (hints.fid && record.fid !== hints.fid) {
    throw new Error(`preview/place fid mismatch (expected ${hints.fid}, got ${record.fid})`);
  }

  const coordsMatch = stripped.match(/\[null,\s*null,\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\]/i);
  const location = coordsMatch
    ? { lat: Number(coordsMatch[1]), lng: Number(coordsMatch[2]) }
    : (hints.location || null);

  const deepContact = deepExtractContactFromData(data, record.name);
  const textContact = extractContactFromPreviewText(stripped, record.fid, record.name);

  const openingHours = extractOpeningHoursFromText(stripped);
  let reviewsDistribution = findHistogramInData(data);
  if (!reviewsDistribution || !Object.values(reviewsDistribution).some((v) => v > 0)) {
    reviewsDistribution = findFlatFiveCountArray(data)
      || findFiveStarCounts(data?.[5])
      || reviewsDistribution;
  }

  const nearFidStats = findReviewStatsNearFidInText(stripped, record.fid);
  const overallRating = record.overallRating ?? nearFidStats.overallRating ?? null;
  const totalReviews = record.totalReviews ?? nearFidStats.totalReviews ?? null;
  const about = extractAboutFromPreviewData(data, walkArrays);
  const webResults = extractWebResultsFromPreviewData(data);
  const imageUrls = extractImageUrlsFromPreviewData(data);
  const hero = record.imageUrl && isGalleryImageUrl(record.imageUrl) ? record.imageUrl : null;
  const formattedAddress = record.address || deepContact.address || null;

  return {
    name: record.name,
    subTitle: record.structuralLabel || null,
    overallRating,
    totalReviews,
    category: record.types[0] || null,
    categories: record.types,
    address: formattedAddress,
    phone: record.phone || deepContact.phone || textContact.phone || null,
    website: record.website || deepContact.website || textContact.website || null,
    menu: record.menu || deepContact.menu || textContact.menu || null,
    imageUrl: hero || imageUrls[0] || record.imageUrl,
    imageUrls,
    price: record.price,
    plusCode: record.plusCode,
    openingHours,
    reviewsDistribution: reviewsDistribution || normalizeReviewsDistribution({}),
    fid: record.fid,
    location,
    description: about.description,
    additionalInfo: normalizeAdditionalInfo(about.additionalInfo),
    webResults,
    ...resolveAddressParts({ data, address: formattedAddress, fid: record.fid }),
  };
}


export async function fetchPreviewPlaceInBrowser(page, { pb, language = 'en', referer = 'https://www.google.com/' }) {
  const apiUrl = buildPreviewPlaceUrl({ pb, language });
  console.log(`[api] Fetching preview/place (pb len=${pb.length})...`);

  const result = await page.evaluate(async ({ apiUrl, referer }) => {
    const res = await fetch(apiUrl, {
      method: 'GET',
      credentials: 'include',
      headers: {
        accept: '*/*',
        'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
        'x-maps-diversion-context-bin': 'CAE=',
      },
      referrer: referer,
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  }, { apiUrl, referer });

  if (!result.ok) {
    throw new Error(`preview/place HTTP ${result.status}`);
  }
  if (!result.text || !stripXssiPrefix(result.text).trim().startsWith('[')) {
    throw new Error('preview/place returned non-JSON body (possible consent/captcha page)');
  }

  return { text: result.text, pb, url: apiUrl };
}

export function resolvePlaceHintsFromUrl(pageUrl, { placeId = null, searchQuery = null } = {}) {
  const fid = fidFromUrl(pageUrl);
  const kgmid = kgmidFromUrl(pageUrl);
  const location = extractCoordsFromUrl(pageUrl);
  return {
    fid,
    kgmid,
    location,
    lat: location?.lat,
    lng: location?.lng,
    placeId,
    query: searchQuery || null,
    pageUrl,
  };
}

export async function scrapePlaceViaPreviewApi(page, {
  pageUrl,
  language = 'en',
  placeId = null,
  searchQuery = null,
  intercepted = null,
}) {
  const hints = resolvePlaceHintsFromUrl(pageUrl, { placeId, searchQuery });
  if (!hints.fid) throw new Error('Cannot call preview/place without feature id in Maps URL');

  const useIntercepted = intercepted?.text
    && responseContainsFid(intercepted.text, hints.fid)
    && (!intercepted.pb || pbContainsFid(intercepted.pb, hints.fid));

  const pb = (useIntercepted && intercepted.pb && pbContainsFid(intercepted.pb, hints.fid))
    ? intercepted.pb
    : buildPreviewPlacePb({
      fid: hints.fid,
      lat: hints.lat,
      lng: hints.lng,
      kgmid: hints.kgmid,
      query: hints.query,
    });

  const payload = useIntercepted
    ? intercepted
    : await fetchPreviewPlaceInBrowser(page, { pb, language, referer: pageUrl || 'https://www.google.com/' });

  const place = parsePreviewPlaceResponse(payload.text, hints);
  if (!place?.name) throw new Error('preview/place response did not contain a place name');

  place.pageUrl = pageUrl;
  place.fid = place.fid || hints.fid;
  place.kgmid = hints.kgmid || kgmidFromUrl(pageUrl);
  place.location = place.location || hints.location;
  place.placeId = placeId || null;
  // cid is set by scrape orchestrator from page URL
  place.scrapedAt = new Date().toISOString();

  return { place, apiUrl: payload.url, pb: payload.pb };
}
