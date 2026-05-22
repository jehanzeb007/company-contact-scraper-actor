# Google Maps Places Details Scraper — Apify Actor

Scrapes **company / place details** from Google Maps for one business and outputs a single dataset item in the same shape as the [Google Maps Reviews Scraper](https://github.com) place object.

## How it works

- Resolve the place via `url`, `placeId`, `cid`, or `searchQuery` (+ optional `website` for disambiguation).
- Navigate to the place (for session cookies), then load details from **`/maps/preview/place?pb=...`** (same API the Maps web app uses).
- Intercept the browser’s `preview/place` response when possible; otherwise build the `pb` token from the URL feature id (`0x...:0x...`) and fetch in-page.
- Parse the `)]}'` JSON payload for name, address, phone, website, hours, category, etc.
- **Hybrid enrichment**: if rating, review count, or star distribution are missing from the API, fill them from the live Maps page (`APP_INITIALIZATION_STATE` + Reviews tab histogram).
- **Photos & videos tab**: collects all photo URLs (scrolls gallery) and stores them in `imageUrls` / `images`.
- **About tab**: collects `description`, `additionalInfo` sections (amenities, accessibility, etc.), and `placesTags`.
- **Web results**: collects the “Web results” links at the bottom of the place panel (`title`, `url`, `displayedUrl`, `description`).
- Full DOM scrape only when the API path fails (`apiOnly: false`).

## Features

- One dataset row per place (full company profile)
- Search by company name with optional website matching
- Direct Google Maps URL, Place ID, and CID support
- Review distribution histogram (not individual reviews)
- Proxy-ready for Apify Cloud runs
- Asset blocking for faster scraping
- Key-value `OUTPUT_METADATA` for the resolved place

## Input

At least one of `url`, `searchQuery`, `placeId`, or `cid` is required.

| Field | Type | Default | Description |
|---|---:|---:|---|
| `url` | string | — | Full Google Maps place URL |
| `searchQuery` | string | — | Company name to search on Maps |
| `website` | string | — | Optional website for search disambiguation |
| `placeId` | string | — | Google Place ID |
| `cid` | string | — | Google Maps CID (decimal, URL, or hex pair) |
| `proxyConfig` | object | Residential proxy in schema | Apify proxy configuration |
| `blockAssets` | boolean | `true` | Block images, media, and fonts |
| `apiOnly` | boolean | `false` | Use only `/maps/preview/place` (no DOM fallback) |
| `language` | string | `en` | Maps UI language (`hl` param) |
| `headless` | boolean | `true` | Puppeteer headless mode |

Example:

```json
{
  "searchQuery": "NETSOL Technologies Ltd.",
  "website": "https://www.netsoltech.com/",
  "language": "en",
  "blockAssets": true,
  "proxyConfig": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```

## Output

One dataset item per run, aligned with the reviews actor place schema:

```json
{
  "searchString": "Search Query: NETSOL Technologies Ltd.",
  "title": "NETSOL Technologies Limited",
  "totalScore": 4.2,
  "reviewsCount": 128,
  "address": "123 Main St, City, ST 12345, USA",
  "street": "123 Main St",
  "city": "City",
  "state": "State",
  "countryCode": "US",
  "website": "https://example.com",
  "phone": "+1 555-0100",
  "categoryName": "Software company",
  "reviewsDistribution": {
    "oneStar": 5,
    "twoStar": 3,
    "threeStar": 10,
    "fourStar": 30,
    "fiveStar": 80
  },
  "openingHours": [{ "day": "Monday", "hours": "9 AM–5 PM" }],
  "url": "https://www.google.com/maps/place/...",
  "cid": "15430805186958748717",
  "location": { "lat": 40.7, "lng": -74.0 },
  "scrapedAt": "2026-05-22T12:00:00.000Z"
}
```

## Local development

```bash
npm install
npm run dev -- --searchQuery="Starbucks" --website="starbucks.com"
```

Or with `INPUT.json` in `.actor/` / storage and:

```bash
apify run
```

## Project structure

```
main.js              # Apify entry (delegates to src/main.js)
src/
  main.js            # Actor init, discovery, scrape, dataset push
  discovery.js       # Search + website matching (shared with reviews actor)
  scraper.js         # Orchestrator, DOM fallback, output schema
  placeApi.js        # preview/place fetch, pb builder, API response parser
.actor/
  actor.json
  input_schema.json
  Dockerfile
```
