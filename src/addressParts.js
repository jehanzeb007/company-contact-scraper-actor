const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

const ADDRESS_COMPONENT_TYPES = new Set([
  'street_number',
  'route',
  'locality',
  'postal_town',
  'sublocality',
  'sublocality_level_1',
  'sublocality_level_2',
  'administrative_area_level_1',
  'administrative_area_level_2',
  'administrative_area_level_3',
  'postal_code',
  'country',
  'neighborhood',
  'premise',
  'subpremise',
  'floor',
  'room',
  'post_box',
]);

const CITY_TYPE_PRIORITY = [
  'locality',
  'postal_town',
  'administrative_area_level_2',
  'sublocality_level_1',
  'sublocality',
  'neighborhood',
];

const LANG_CODE_RE = /^[a-z]{2}(-[A-Z]{2})?$/i;

function walkArrays(node, visit) {
  if (node == null) return;
  if (Array.isArray(node)) {
    visit(node);
    for (const item of node) walkArrays(item, visit);
  } else if (typeof node === 'object') {
    for (const v of Object.values(node)) walkArrays(v, visit);
  }
}

function isTypesArray(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) return false;
  if (!value.every((t) => typeof t === 'string' && t.length > 0 && t.length < 80)) return false;
  return value.some((t) => ADDRESS_COMPONENT_TYPES.has(t));
}

function isLanguageCode(value) {
  return typeof value === 'string' && LANG_CODE_RE.test(value);
}

function parseComponentNode(node) {
  if (Array.isArray(node)) {
    let typesIdx = -1;
    for (let i = 0; i < node.length; i++) {
      if (isTypesArray(node[i])) {
        typesIdx = i;
        break;
      }
    }
    if (typesIdx < 0) return null;

    const types = node[typesIdx];
    const strings = [];
    for (let i = 0; i < node.length; i++) {
      if (i === typesIdx) continue;
      const v = node[i];
      if (typeof v !== 'string' || !v.length || v.length > 200) continue;
      // Language tag is usually the last slot after types (e.g. "en"), not "FL" or "US".
      if (i > typesIdx && i === node.length - 1 && isLanguageCode(v)) continue;
      strings.push(v);
    }
    if (!strings.length) return null;

    return {
      long: norm(strings[0]),
      short: norm(strings[1] || strings[0]),
      types: [...types],
    };
  }

  if (!node || typeof node !== 'object') return null;

  const types = node.types || node.type;
  if (!isTypesArray(types)) return null;

  const long = norm(node.longText ?? node.long_name ?? node.longName ?? node.text);
  const short = norm(node.shortText ?? node.short_name ?? node.shortName ?? long);
  if (!long) return null;

  return { long, short, types: [...types] };
}

function collectComponentsFromArray(arr) {
  const components = [];
  const seen = new Set();

  const push = (component) => {
    if (!component) return;
    const key = `${component.types.join('|')}:${component.long}`;
    if (seen.has(key)) return;
    seen.add(key);
    components.push(component);
  };

  for (const item of arr) {
    push(parseComponentNode(item));
    if (Array.isArray(item)) {
      for (const inner of item) push(parseComponentNode(inner));
    }
  }

  return components;
}

function scoreComponentGroup(components, { nearFid = false } = {}) {
  if (components.length < 2) return 0;

  let score = components.length * 10;
  if (nearFid) score += 40;

  const types = new Set(components.flatMap((c) => c.types));
  if (types.has('country')) score += 8;
  if (types.has('postal_code')) score += 5;
  if (types.has('locality') || types.has('postal_town')) score += 5;
  if (types.has('route') || types.has('street_number')) score += 3;
  if (types.has('administrative_area_level_1')) score += 3;

  return score;
}

/**
 * Find Google's typed address components in preview/place (or similar) JSON.
 * Returns null when no confident component group is found.
 */
export function extractAddressComponentsFromData(data, { fid = null } = {}) {
  if (data == null) return null;

  let best = null;

  walkArrays(data, (arr) => {
    const components = collectComponentsFromArray(arr);
    const nearFid = Boolean(fid && arr.some((v) => v === fid));
    const score = scoreComponentGroup(components, { nearFid });
    if (score > 0 && (!best || score > best.score)) {
      best = { components, score };
    }
  });

  return best?.components || null;
}

function pickComponent(components, typePriority) {
  for (const type of typePriority) {
    const hit = components.find((c) => c.types.includes(type));
    if (hit) return hit;
  }
  return null;
}

export function mapAddressComponentsToFields(components) {
  if (!Array.isArray(components) || !components.length) {
    return { street: null, city: null, postalCode: null, state: null, countryCode: null };
  }

  const streetNumber = pickComponent(components, ['street_number']);
  const route = pickComponent(components, ['route']);
  const city = pickComponent(components, CITY_TYPE_PRIORITY);
  const state = pickComponent(components, ['administrative_area_level_1']);
  const postal = pickComponent(components, ['postal_code']);
  const country = pickComponent(components, ['country']);

  let street = null;
  if (streetNumber && route) street = `${streetNumber.long} ${route.long}`;
  else if (route) street = route.long;
  else if (streetNumber) street = streetNumber.long;

  const countryCode = country
    ? (country.short.length <= 3 ? country.short : country.long)
    : null;

  return {
    street,
    city: city?.long || null,
    postalCode: postal?.long || null,
    state: state?.long || null,
    countryCode,
  };
}

/** Best-effort comma split when structured components are unavailable (DOM-only path). */
export function parseAddressParts(address) {
  const parts = String(address || '').split(',').map(norm).filter(Boolean);
  const out = { street: parts[0] || null, city: null, postalCode: null, state: null, countryCode: null };
  if (parts.length < 2) return out;

  const last = parts[parts.length - 1];
  const second = parts[parts.length - 2];

  if (/^\d{4,10}([-\s]\d+)?$/i.test(second)) {
    out.postalCode = second;
    out.city = parts.length >= 3 ? parts[parts.length - 3] : null;
    out.countryCode = last;
    return out;
  }

  if (parts.length >= 3) {
    const stateZip = second.match(/^([A-Za-z][A-Za-z\s.'-]{0,40})\s+(\d{4,10}(?:-\d+)?)$/);
    if (stateZip) {
      out.state = stateZip[1];
      out.postalCode = stateZip[2];
      out.city = parts.length >= 4 ? parts[parts.length - 3] : null;
      out.countryCode = last;
      return out;
    }

    out.city = second;
    out.countryCode = last;
    return out;
  }

  out.city = second;
  out.countryCode = last;
  return out;
}

/** Structured components from JSON when present; otherwise minimal string fallback. */
export function resolveAddressParts({ data = null, address = null, fid = null } = {}) {
  const components = data ? extractAddressComponentsFromData(data, { fid }) : null;
  if (components?.length) return mapAddressComponentsToFields(components);
  if (!address) return {};
  return parseAddressParts(address);
}
