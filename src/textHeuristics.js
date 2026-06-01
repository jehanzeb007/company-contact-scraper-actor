export const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** True when text reads like a user review rather than a business/editorial description. */
export function looksLikeUserReview(text) {
  const t = String(text || '');
  if (t.length < 80) return false;

  const strong = [
    /\bLocal Guide\b/i,
    /\b\d+\s*(months?|weeks?|days?|years?)\s+ago\b/i,
    /[★⭐]{1,5}/,
    /\b\d\s*\/\s*5\s*stars?\b/i,
    /\b(edited|posted)\b.*\b(ago|review)\b/i,
    /\bgoogle\s+review\b/i,
    /\bshare\s+review\b/i,
  ];
  if (strong.some((r) => r.test(t))) return true;

  const signals = [
    /\bI\s+(was|am|had|went|looked|will|completely|think|felt|found|got|love|hate|don't|do not)\b/i,
    /\bmy\s+(trade-in|phone|device|experience|husband|wife|kid|family|order|visit)\b/i,
    /\bhighly recommend\b/i,
    /\b(would|wouldn't|would not)\s+recommend\b/i,
    /\bthis is the only\b/i,
    /\baround \d+:\d+\s*(AM|PM)\b/i,
    /\b(November|December|January|February|March|April|May|June|July|August|September|October)\s+\d{1,2}/i,
    /\bstore manager\b/i,
    /\bstars?\s*,\s*\d+\s*reviews?\b/i,
    /\bwe\s+(went|came|visited|ordered|ate)\b/i,
    /\b(service|staff|waiter|server)\s+(was|were)\s+(amazing|terrible|rude|great|awful|friendly|slow)\b/i,
    /\b(visited|went)\s+here\b/i,
    /\b(never|always)\s+(come|go|return)\b/i,
  ];

  const hits = signals.filter((r) => r.test(t)).length;
  if (t.length >= 180 && hits >= 2) return true;
  if (t.length >= 120 && hits >= 3) return true;
  return false;
}

const GEO_OR_KGMID_PATH_RE = /^\/(geo|g)\//i;

const GEO_SLUG_LABEL_OVERRIDES = {
  parking_availability: 'Usually plenty of parking',
  has_wheelchair_accessible_parking: 'Wheelchair accessible parking lot',
  has_wheelchair_accessible_entrance: 'Wheelchair accessible entrance',
  has_wheelchair_accessible_restroom: 'Wheelchair accessible restroom',
  has_parking_lot_free: 'Free parking lot',
  has_parking_street_free: 'Free street parking',
  has_parking_lot_paid: 'Paid parking lot',
  has_parking_street_paid: 'Paid street parking',
  no_contact_delivery: 'No-contact delivery',
  has_onsite_services: 'Onsite services',
  suitable_for_solo_dining: 'Solo dining',
  serves_all_you_can_eat: 'All you can eat',
  serves_late_night_food: 'Late-night food',
  has_counter_service: 'Counter service',
  has_table_service: 'Table service',
  has_free_wifi: 'Free Wi-Fi',
  has_wifi: 'Wi-Fi',
  has_restroom: 'Restroom',
  has_nfc_mobile_payments: 'NFC mobile payments',
  has_credit_cards: 'Credit cards',
  has_debit_cards: 'Debit cards',
  good_for_kids_birthday: 'Good for kids birthday',
  has_childrens_menu: "Kids' menu",
  has_kids_menu: "Kids' menu",
  has_high_chairs: 'High chairs',
  good_for_kids: 'Good for kids',
  suitable_for_groups: 'Groups',
  feels_casual: 'Casual',
  requires_cash_only: 'Cash-only',
  has_changing_tables: 'Has changing table(s)',
  has_restroom_unisex: 'Gender-neutral restroom',
  serves_coffee: 'Coffee',
  serves_vegan: 'Vegan options',
  serves_healthy: 'Healthy options',
  serves_quick_bite: 'Quick bite',
  serves_dessert: 'Dessert',
  has_seating: 'Seating',
  has_takeout: 'Takeout',
  has_delivery: 'Delivery',
  has_dine_in: 'Dine-in',
};

/** Strip Google Maps icon-font / zero-width characters from scraped text. */
export function stripMapsIconChars(text) {
  return norm(String(text || '').replace(/[\uE000-\uF8FF\u200B-\u200F]/g, ''));
}

/** Convert `/geo/.../has_foo_bar` schema paths to UI-style labels when possible. */
export function geoPathToHumanLabel(path) {
  const slug = String(path || '').split('/').filter(Boolean).pop() || '';
  if (!slug || /^g:?[0-9a-z]+$/i.test(slug)) return null;
  if (GEO_SLUG_LABEL_OVERRIDES[slug]) return GEO_SLUG_LABEL_OVERRIDES[slug];

  let name = slug.replace(/^(has_|serves_|feels_|requires_|suitable_for_|is_)/, '');
  if (!name) return null;
  const words = name.split('_').filter(Boolean);
  if (!words.length) return null;

  const result = words.map((w, i) => {
    const lower = w.toLowerCase();
    if (lower === 'wifi') return 'Wi-Fi';
    if (lower === 'nfc') return 'NFC';
    if (['for', 'and', 'or', 'the', 'a', 'of'].includes(lower) && i > 0) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join(' ');

  return result.replace(/\bWi Fi\b/g, 'Wi-Fi').replace(/\bNfc\b/g, 'NFC') || null;
}

const ABOUT_SECTION_TITLES = new Map([
  ['accessibility', 'Accessibility'],
  ['amenities', 'Amenities'],
  ['atmosphere', 'Atmosphere'],
  ['children', 'Children'],
  ['crowd', 'Crowd'],
  ['dining options', 'Dining options'],
  ['offerings', 'Offerings'],
  ['parking', 'Parking'],
  ['payments', 'Payments'],
  ['planning', 'Planning'],
  ['popular for', 'Popular for'],
  ['service options', 'Service options'],
  ['highlights', 'Highlights'],
  ['health and safety', 'Health and safety'],
  ['from the business', 'From the business'],
  ['getting here', 'Getting here'],
  ['activities', 'Activities'],
]);

const PREFERRED_ABOUT_LABELS = new Map([
  ['no-contact delivery', 'No-contact delivery'],
  ['delivery', 'Delivery'],
  ['onsite services', 'Onsite services'],
  ['takeout', 'Takeout'],
  ['dine-in', 'Dine-in'],
  ['outdoor seating', 'Outdoor seating'],
  ['drive-through', 'Drive-through'],
  ['lunch', 'Lunch'],
  ['dinner', 'Dinner'],
  ['solo dining', 'Solo dining'],
  ['all you can eat', 'All you can eat'],
  ['healthy options', 'Healthy options'],
  ['late-night food', 'Late-night food'],
  ['quick bite', 'Quick bite'],
  ['coffee', 'Coffee'],
  ['vegan options', 'Vegan options'],
  ['counter service', 'Counter service'],
  ['dessert', 'Dessert'],
  ['seating', 'Seating'],
  ['table service', 'Table service'],
  ['order ahead', 'Order ahead'],
  ['counter seating', 'Counter seating'],
  ['restroom', 'Restroom'],
  ['wi-fi', 'Wi-Fi'],
  ['free wi-fi', 'Free Wi-Fi'],
  ['gender-neutral restroom', 'Gender-neutral restroom'],
  ['casual', 'Casual'],
  ['groups', 'Groups'],
  ['credit cards', 'Credit cards'],
  ['debit cards', 'Debit cards'],
  ['nfc mobile payments', 'NFC mobile payments'],
  ['cash only', 'Cash-only'],
  ['good for kids', 'Good for kids'],
  ['good for kids birthday', 'Good for kids birthday'],
  ['high chairs', 'High chairs'],
  ["kids' menu", "Kids' menu"],
  ['changing tables', 'Has changing table(s)'],
  ['wheelchair accessible entrance', 'Wheelchair accessible entrance'],
  ['wheelchair accessible parking lot', 'Wheelchair accessible parking lot'],
  ['wheelchair accessible restroom', 'Wheelchair accessible restroom'],
  ['free parking lot', 'Free parking lot'],
  ['free street parking', 'Free street parking'],
  ['paid parking lot', 'Paid parking lot'],
  ['paid street parking', 'Paid street parking'],
  ['usually plenty of parking', 'Usually plenty of parking'],
]);

const PAYMENT_CARD_BRAND_RE = /^(visa|mastercard|master card|amex|american express|discover|diners club|unionpay|jcb)$/i;

const MACHINE_ABOUT_LABEL_RE = /^(GUIDED_|E:|TYPE_)/i;

function isOpaqueIdLabel(label) {
  const t = norm(label);
  if (!t || /\s/.test(t)) return false;
  if (t.length < 8) return false;
  if (/^\d+ah[a-z0-9_-]+$/i.test(t)) return true;
  if (!/^[a-z0-9]+$/i.test(t)) return false;
  if (/[aeiou]/i.test(t)) return false;
  return true;
}

function isMachineAboutLabel(label) {
  const t = norm(label);
  if (!t) return true;
  if (MACHINE_ABOUT_LABEL_RE.test(t)) return true;
  if (/^[A-Z][A-Z0-9_]{4,}$/.test(t)) return true;
  if (/^[a-z]+(_[a-z0-9]+)+$/.test(t) && !t.includes(' ')) return true;
  if (/types\s+accepted/i.test(t)) return true;
  if (isOpaqueIdLabel(t)) return true;
  if (ABOUT_SECTION_TITLES.has(t.toLowerCase().replace(/_/g, ' '))) return true;
  if (ABOUT_SECTION_TITLES.has(t.toLowerCase())) return true;
  return false;
}

function resolveAboutSectionTitle(section) {
  const lower = norm(section).toLowerCase().replace(/_/g, ' ');
  return ABOUT_SECTION_TITLES.get(lower) || norm(section);
}

function stripAboutKeyPrefixes(key) {
  let k = key;
  let prev;
  do {
    prev = k;
    k = k.replace(
      /^(always offers|always|offers|serves|has|welcomes|popular for|accepts|pay|good for)\s+/,
      '',
    );
    k = k.replace(/\s+(available|popular)$/, '');
  } while (k !== prev);
  return k.trim();
}

/** Normalize a raw about value (plain text or geo path) to a display label. */
export function additionalInfoLabelFromRaw(raw) {
  const t = stripMapsIconChars(raw);
  if (!t) return null;
  if (GEO_OR_KGMID_PATH_RE.test(t) || /^\/[a-z0-9_./-]+$/i.test(t)) {
    return geoPathToHumanLabel(t);
  }
  return normalizeAboutDisplayLabel(t);
}

function normalizeAboutDisplayLabel(label) {
  const t = norm(label);
  if (!t || isMachineAboutLabel(t)) return null;
  if (/^pay\s+/i.test(t)) return null;
  if (isOpaqueIdLabel(t)) return null;

  const key = canonicalAdditionalInfoKey(t);
  if (!key) return null;
  return PREFERRED_ABOUT_LABELS.get(key) || t;
}

/** Human-readable Maps about attribute (not schema paths or section titles). */
export function isCleanAdditionalInfoLabel(label, sectionTitle = null) {
  const t = norm(label);
  if (!t || t.length < 2 || t.length > 120) return false;
  if (GEO_OR_KGMID_PATH_RE.test(t)) return false;
  if (/^\/[a-z0-9_./-]+$/i.test(t)) return false;
  if (isMachineAboutLabel(t)) return false;
  if (isOpaqueIdLabel(t)) return false;
  if (/^pay\s+/i.test(t)) return false;
  if (sectionTitle && t.toLowerCase() === norm(sectionTitle).toLowerCase()) return false;
  if (norm(sectionTitle).toLowerCase() === 'payments' && PAYMENT_CARD_BRAND_RE.test(t)) return false;
  return true;
}

function canonicalAdditionalInfoKey(label) {
  let k = norm(label).toLowerCase();
  if (GEO_OR_KGMID_PATH_RE.test(k)) {
    const slug = k.split('/').pop() || '';
    k = slug.replace(/^(has_|serves_|feels_|requires_|suitable_for_)/, '').replace(/_/g, ' ');
  }
  k = stripAboutKeyPrefixes(k);
  k = k.replace(/\s+/g, ' ').trim();

  const KEY_FIXES = {
    'no contact delivery': 'no-contact delivery',
    'dine in': 'dine-in',
    'drive through': 'drive-through',
    'seating outdoors': 'outdoor seating',
    'onsite services available': 'onsite services',
    'lunch popular': 'lunch',
    'dinner popular': 'dinner',
    'all you can eat always': 'all you can eat',
    'always offers all you can eat': 'all you can eat',
    'quick bite': 'quick bite',
    'has restroom': 'restroom',
    'welcomes children': 'good for kids',
    'high chairs available': 'high chairs',
    'has order ahead options': 'order ahead',
    'has changing tables': 'changing tables',
    'has changing table': 'changing tables',
    'credit card': 'credit cards',
    'debit card': 'debit cards',
    'mobile nfc': 'nfc mobile payments',
    'free wifi': 'free wi-fi',
    'wifi': 'wi-fi',
  };
  if (KEY_FIXES[k]) k = KEY_FIXES[k];
  if (k === 'service options' || k === 'popular for' || k === 'dining options') return '';
  return k;
}

function scoreAdditionalInfoLabel(label) {
  const t = norm(label);
  let score = 0;
  if (isMachineAboutLabel(t)) score -= 100;
  if (GEO_OR_KGMID_PATH_RE.test(t)) score -= 100;
  if (/^\/[a-z0-9_./-]+$/i.test(t)) score -= 100;
  if (/^(offers|serves|has|welcomes|always|popular for|accepts|pay)\s+/i.test(t)) score -= 25;
  if (/[/\\_]/.test(t)) score -= 30;
  const key = canonicalAdditionalInfoKey(t);
  if (PREFERRED_ABOUT_LABELS.has(key) && PREFERRED_ABOUT_LABELS.get(key) === t) score += 30;
  if (t.length >= 3 && t.length <= 50) score += 5;
  return score;
}

/** About-section items as `[{ "Wheelchair accessible entrance": true }, ...]`. */
export function formatAdditionalInfoItems(items, sectionTitle = null) {
  if (!Array.isArray(items)) return [];
  const labels = [];
  for (const entry of items) {
    let label = null;
    if (typeof entry === 'string') {
      label = additionalInfoLabelFromRaw(entry);
    } else if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const keys = Object.keys(entry);
      if (keys.length === 1 && entry[keys[0]] === true) label = additionalInfoLabelFromRaw(keys[0]);
    }
    if (!label || !isCleanAdditionalInfoLabel(label, sectionTitle)) continue;
    labels.push(label);
  }

  const byCanonical = new Map();
  for (const label of labels) {
    const key = canonicalAdditionalInfoKey(label);
    if (!key || key.length < 2) continue;
    const display = PREFERRED_ABOUT_LABELS.get(key) || label;
    const prev = byCanonical.get(key);
    if (!prev || scoreAdditionalInfoLabel(display) > scoreAdditionalInfoLabel(prev)) {
      byCanonical.set(key, display);
    }
  }

  return [...byCanonical.values()]
    .sort((a, b) => a.localeCompare(b))
    .map((label) => ({ [label]: true }));
}

/** Normalize all about sections to the `{ label: true }[]` shape. */
export function normalizeAdditionalInfo(additionalInfo) {
  const merged = {};
  for (const [section, items] of Object.entries(additionalInfo || {})) {
    const title = resolveAboutSectionTitle(section);
    if (!merged[title]) merged[title] = [];
    if (Array.isArray(items)) merged[title].push(...items);
  }
  const out = {};
  for (const [section, items] of Object.entries(merged)) {
    const formatted = formatAdditionalInfoItems(items, section);
    if (formatted.length) out[section] = formatted;
  }
  return out;
}

/** Merge multiple `additionalInfo` objects, combining items within each section. */
export function mergeAdditionalInfo(...sources) {
  const combined = {};
  for (const source of sources) {
    for (const [section, items] of Object.entries(source || {})) {
      if (!Array.isArray(items) || !items.length) continue;
      const existingKey = Object.keys(combined).find((k) => k.toLowerCase() === section.toLowerCase());
      const key = existingKey || section;
      if (!combined[key]) combined[key] = [];
      combined[key].push(...items);
    }
  }
  return normalizeAdditionalInfo(combined);
}

function looksLikeAboutPanelBlob(text) {
  const lower = text.toLowerCase();
  const markers = [
    'service options', 'popular for', 'dining options', 'wheelchair accessible',
    'no-contact delivery', 'nfc mobile payments', 'kids\' menu',
  ];
  return markers.filter((m) => lower.includes(m)).length >= 2;
}

/** Business description from Maps, or null when missing / review-like. */
export function sanitizePlaceDescription(text) {
  const d = norm(text);
  if (!d) return null;
  if (d.length < 15 || d.length > 5000) return null;
  if (looksLikeUserReview(d)) return null;
  if (looksLikeAboutPanelBlob(d)) return null;
  return d;
}

const WEAK_PLACE_TYPES = new Set([
  'level', 'floor', 'room', 'wing', 'section', 'corridor', 'entrance', 'area', 'zone',
]);

/** Indoor/structural Maps entities (e.g. "First Floor" typed as Level) — not the venue title. */
export function isWeakStructuralPlaceName(name, types = []) {
  const n = norm(name);
  if (!n) return true;

  for (const t of types) {
    const lower = norm(t).toLowerCase();
    if (WEAK_PLACE_TYPES.has(lower)) return true;
  }

  if (/^(first|second|third|fourth|fifth|ground|basement|lower|upper|mezzanine|top)\s+floor$/i.test(n)) return true;
  if (/^floor\s+\d+/i.test(n) || /^level\s+\d+/i.test(n)) return true;
  if (/^\d+(?:st|nd|rd|th)\s+floor$/i.test(n)) return true;
  if (/^(lobby|atrium|food court|parking (?:garage|lot|deck|level))$/i.test(n)) return true;

  return false;
}

/** Parse "Venue · Floor - Google Maps" style browser titles. */
export function parseMapsPageTitle(title) {
  const t = norm(title).replace(/\s*[-–|]\s*Google\s+Maps.*$/i, '');
  if (!t) return null;
  const parts = t.split(/\s*[·•]\s*/).map((p) => norm(p)).filter(Boolean);
  if (parts.length >= 2) {
    if (isWeakStructuralPlaceName(parts[0], [parts[0]])) return parts[parts.length - 1];
    return parts[0];
  }
  return isWeakStructuralPlaceName(t, []) ? null : t;
}

/** Mall/venue name often appears in the street portion of the formatted address. */
export function inferNameFromStreetAddress(address) {
  const a = norm(address);
  if (!a) return null;
  const m = a.match(
    /\d[\d\s,.-]*\s+(?:[NSEW]{1,2}\s+)?([A-Za-z][A-Za-z\s.'-]{2,60})\s+(?:Rd\.?|Road|St\.?|Street|Ave\.?|Avenue|Blvd\.?|Boulevard|Dr\.?|Drive|Way|Ln\.?|Lane|Pkwy\.?|Parkway|Plaza|Square|Center|Centre|Commons|Loop|Trail|Highway|Hwy)\b/i,
  );
  if (!m) return null;
  const candidate = norm(m[1]);
  if (!candidate || candidate.length < 3) return null;
  if (/^(north|south|east|west|nw|ne|sw|se)$/i.test(candidate)) return null;
  if (isWeakStructuralPlaceName(candidate, [])) return null;
  return candidate;
}
