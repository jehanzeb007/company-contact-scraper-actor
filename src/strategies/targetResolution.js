import { buildGoogleMapsCidUrl, extractCompleteMapUrl, searchAndClickMapsPreview } from '../discovery.js';

const STRATEGY_ALIASES = new Map([
  ['auto', 'auto'],
  ['url', 'url'],
  ['directUrl', 'url'],
  ['direct-url', 'url'],
  ['cid', 'cid'],
  ['placeId', 'placeId'],
  ['place-id', 'placeId'],
  ['search', 'search'],
  ['searchQuery', 'search'],
  ['search-query', 'search'],
]);

function normalizeStrategy(value) {
  if (!value) return 'auto';
  return STRATEGY_ALIASES.get(String(value).trim()) || null;
}

class TargetResolutionStrategy {
  constructor(name) {
    this.name = name;
  }

  canHandle() {
    return false;
  }

  resolve() {
    throw new Error(`Strategy "${this.name}" does not implement resolve().`);
  }

  assertCanHandle(input) {
    if (!this.canHandle(input)) {
      throw new Error(`Strategy "${this.name}" cannot run with the provided input.`);
    }
  }
}

class UrlResolutionStrategy extends TargetResolutionStrategy {
  constructor() {
    super('url');
  }

  canHandle(input) {
    return Boolean(input?.url);
  }

  async resolve({ input }) {
    this.assertCanHandle(input);
    return {
      targetUrl: input.url,
      searchString: input.url,
      searchQuery: null,
      skipWarmUp: false,
    };
  }
}

class CidResolutionStrategy extends TargetResolutionStrategy {
  constructor() {
    super('cid');
  }

  canHandle(input) {
    return Boolean(input?.cid);
  }

  async resolve({ input }) {
    this.assertCanHandle(input);
    const targetUrl = buildGoogleMapsCidUrl(input.cid);
    console.log(`[cid] Constructed direct CID URL: ${targetUrl}`);
    return {
      targetUrl,
      searchString: String(input.cid),
      searchQuery: null,
      skipWarmUp: false,
    };
  }
}

class PlaceIdResolutionStrategy extends TargetResolutionStrategy {
  constructor() {
    super('placeId');
  }

  canHandle(input) {
    return Boolean(input?.placeId);
  }

  async resolve({ input }) {
    this.assertCanHandle(input);
    const targetUrl = `https://www.google.com/maps/search/?api=1&query=Place&query_place_id=${encodeURIComponent(input.placeId)}`;
    console.log(`[placeId] Constructed direct Place ID URL: ${targetUrl}`);
    return {
      targetUrl,
      searchString: input.placeId,
      searchQuery: null,
      skipWarmUp: false,
    };
  }
}

class SearchQueryResolutionStrategy extends TargetResolutionStrategy {
  constructor() {
    super('search');
  }

  canHandle(input) {
    return Boolean(input?.searchQuery);
  }

  async resolve({ page, input }) {
    this.assertCanHandle(input);
    console.log(`\n[discovery] Initiating discovery for: "${input.searchQuery}"`);
    const discoveredUrl = await searchAndClickMapsPreview(page, input.searchQuery, input.website);
    if (!discoveredUrl) {
      throw new Error(
        `Failed to discover place "${input.searchQuery}"${input.website ? ` matching website "${input.website}"` : ''} on Google Maps.`,
      );
    }

    const needsPlaceUrl = !discoveredUrl.includes('/place/') && !discoveredUrl.includes('cid=');
    const finalUrl = needsPlaceUrl ? await extractCompleteMapUrl(page) : discoveredUrl;
    const targetUrl = finalUrl || discoveredUrl;
    console.log(`[discovery] Locked onto Maps URL: ${targetUrl}\n`);

    return {
      targetUrl,
      searchString: input.searchQuery,
      searchQuery: input.searchQuery,
      skipWarmUp: true,
    };
  }
}

const STRATEGIES = [
  new UrlResolutionStrategy(),
  new CidResolutionStrategy(),
  new PlaceIdResolutionStrategy(),
  new SearchQueryResolutionStrategy(),
];

export function selectTargetResolutionStrategy(input = {}) {
  const requested = normalizeStrategy(input.strategy);
  if (!requested) {
    throw new Error(`Unknown target resolution strategy: ${input.strategy}`);
  }

  if (requested !== 'auto') {
    const strategy = STRATEGIES.find((candidate) => candidate.name === requested);
    if (!strategy) throw new Error(`Unsupported target resolution strategy: ${input.strategy}`);
    strategy.assertCanHandle(input);
    return strategy;
  }

  const strategy = STRATEGIES.find((candidate) => candidate.canHandle(input));
  if (!strategy) {
    throw new Error('Input error: You must provide either a "url", a "searchQuery", a "placeId", or a "cid".');
  }
  return strategy;
}
