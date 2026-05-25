# Company Contact Scraper - Apify Actor

Scrapes one company/place profile from Google Maps and outputs one dataset item with contact details, address data, ratings, review star distribution, photos, web results, and Google Maps identifiers.

## What It Extracts

- Company/place name
- Category and category list
- Website and phone number
- Full address plus parsed street, city, state, postal code, and country
- Latitude/longitude
- Google Maps URL, CID, feature ID, KG/MID, and optional Place ID
- Rating, review count, and star distribution histogram
- Opening hours
- Photos and image URLs
- Web results shown in the Google Maps panel
- About/attribute data when available

The actor does not return individual review text. It returns only the aggregate star distribution.

## How It Works

1. Resolves the target company using a strategy: `url`, `cid`, `placeId`, or `search`.
2. For search runs, optionally verifies the matched result by website domain.
3. Opens the Google Maps profile in Puppeteer.
4. Uses Google Maps `preview/place` data when available.
5. Enriches missing contact, rating, review distribution, photos, web results, and about fields from the live Maps page when `apiOnly` is `false`.
6. Pushes one item to the default Apify dataset.
7. Writes `OUTPUT_METADATA` to the default key-value store.

## Input

At least one of `url`, `cid`, `placeId`, or `searchQuery` is required.

If `strategy` is `auto` and multiple target fields are provided, the priority is:

1. `url`
2. `cid`
3. `placeId`
4. `searchQuery`

| Field | Type | Required | Default | Description |
|---|---|---:|---|---|
| `strategy` | string | No | `auto` | Target resolution method. Allowed values: `auto`, `url`, `cid`, `placeId`, `search`. |
| `url` | string | Conditional | `null` | Full Google Maps place URL. |
| `cid` | string | Conditional | `null` | Google Maps CID. Accepts decimal CID, Maps URL with `cid`/`ludocid`, `cid:123`, `ludocid=123`, or a URL with a hex CID pair. Keep large CIDs as strings. |
| `placeId` | string | Conditional | `null` | Google Place ID. |
| `searchQuery` | string | Conditional | `null` | Company name to search on Google Maps. |
| `website` | string | No | `null` | Company website used to verify the correct search result. Strongly recommended with `searchQuery`. |
| `proxyConfig` | object | No | Apify residential proxy | Apify proxy configuration. Residential proxies are recommended for cloud runs. |
| `blockAssets` | boolean | No | `true` | Blocks image/font/media requests during the main scrape to reduce bandwidth. |
| `apiOnly` | boolean | No | `false` | Uses only the Maps preview API and disables DOM fallback/enrichment. Leave `false` for best completeness. |
| `language` | string | No | `en` | Google Maps UI language code, for example `en`, `es`, `fr`, `de`. |
| `headless` | boolean | No | `true` | Puppeteer headless mode. Keep `true` on Apify Cloud. |

## Input Examples

### Search by Company Name and Website

```json
{
  "strategy": "search",
  "searchQuery": "VAS Global | Virtual Assistant Services for Businesses",
  "website": "https://virtualassistantsolutions.com/",
  "language": "en",
  "blockAssets": true,
  "apiOnly": false,
  "proxyConfig": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```

### Direct Google Maps URL

```json
{
  "strategy": "url",
  "url": "https://www.google.com/maps/place/Eiffel+Tower/@48.8583701,2.2922926,17z",
  "language": "en",
  "proxyConfig": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```

### Google Maps CID

```json
{
  "strategy": "cid",
  "cid": "15430805186958748717",
  "language": "en"
}
```

### Google Place ID

```json
{
  "strategy": "placeId",
  "placeId": "ChIJZQi5xUUPyokRKnfZHK7gBnc",
  "language": "en"
}
```

## Output

The actor writes one object to the default dataset. Some fields can be `null` or empty arrays if Google Maps does not expose the data.

### Main Output Fields

| Field | Type | Description |
|---|---|---|
| `searchString` | string or null | Original search/target value used for the run. |
| `title` | string or null | Company/place name. |
| `description` | string or null | Business description when available. |
| `categoryName` | string or null | Primary Google Maps category. |
| `categories` | array | Category list. |
| `address` | string or null | Full address. |
| `street` | string or null | Parsed street address. |
| `city` | string or null | Parsed city. |
| `postalCode` | string or null | Parsed postal/ZIP code. |
| `state` | string or null | Parsed state/province/region. |
| `countryCode` | string or null | Parsed country/country label. |
| `website` | string or null | Company website URL. |
| `phone` | string or null | Phone number as displayed by Google Maps. |
| `phoneUnformatted` | string or null | Normalized phone number when possible. |
| `totalScore` | number or null | Average rating. |
| `reviewsCount` | number or null | Total reviews count. |
| `reviewsDistribution` | object | Review histogram by star rating. |
| `openingHours` | array | Opening hours by day. |
| `location` | object or null | Latitude and longitude. |
| `url` | string or null | Final Google Maps URL. |
| `placeId` | string or null | Google Place ID when provided. |
| `cid` | string or null | Google Maps CID. |
| `fid` | string or null | Google Maps feature ID. |
| `kgmid` | string or null | Google Knowledge Graph / Maps ID when available. |
| `plusCode` | string or null | Google Plus Code when available. |
| `imageUrl` | string or null | Primary image URL. |
| `imageUrls` | array | Collected image URLs. |
| `imagesCount` | number | Number of collected image URLs. |
| `images` | array | Image objects with `imageUrl`, `authorName`, `authorUrl`, and `uploadedAt`. |
| `videoUrls` | array | Collected video URLs when available. |
| `webResults` | array | Related web results shown in Google Maps. |
| `additionalInfo` | object | About/attribute sections such as accessibility, amenities, planning, and payments. |
| `placesTags` | array | Flattened tags/attributes from Google Maps. |
| `permanentlyClosed` | boolean | Whether Google Maps marks the place permanently closed. |
| `temporarilyClosed` | boolean | Whether Google Maps marks the place temporarily closed. |
| `scrapedAt` | string | ISO timestamp when the item was scraped. |

### Example Output

```json
{
  "searchString": "VAS Global | Virtual Assistant Services for Businesses",
  "title": "VAS Global | Virtual Assistant Services for Businesses",
  "description": null,
  "categoryName": "Business management consultant",
  "address": "123 Example Street, Miami, FL 33101, United States",
  "street": "123 Example Street",
  "city": "Miami",
  "postalCode": "33101",
  "state": "Florida",
  "countryCode": "United States",
  "website": "https://virtualassistantsolutions.com/",
  "phone": "+1 850-861-6367",
  "phoneUnformatted": "+18508616367",
  "totalScore": 2.4,
  "reviewsCount": 21,
  "reviewsDistribution": {
    "oneStar": 6,
    "twoStar": 7,
    "threeStar": 4,
    "fourStar": 1,
    "fiveStar": 3
  },
  "openingHours": [
    {
      "day": "Monday",
      "hours": "9 AM-5 PM"
    }
  ],
  "location": {
    "lat": 25.6554871,
    "lng": -80.4031784
  },
  "url": "https://www.google.com/maps/place/...",
  "placeId": null,
  "cid": "10346650057377339081",
  "fid": "0x88d9c189a9fea2df:0x8f919ce21903b6c9",
  "kgmid": "/g/11wbwhnbf9",
  "imageUrl": "https://lh5.googleusercontent.com/...",
  "imageUrls": [
    "https://lh5.googleusercontent.com/..."
  ],
  "imagesCount": 1,
  "images": [
    {
      "imageUrl": "https://lh5.googleusercontent.com/...",
      "authorName": null,
      "authorUrl": null,
      "uploadedAt": null
    }
  ],
  "videoUrls": [],
  "webResults": [
    {
      "title": "VAS Global",
      "url": "https://virtualassistantsolutions.com/",
      "displayedUrl": "virtualassistantsolutions.com",
      "description": "Related website result text when available"
    }
  ],
  "additionalInfo": {},
  "placesTags": [],
  "permanentlyClosed": false,
  "temporarilyClosed": false,
  "scrapedAt": "2026-05-25T08:40:00.000Z"
}
```

## Local Development

Install dependencies:

```bash
npm install
```

Run with CLI arguments:

```bash
node src/main.js --searchQuery="VAS Global | Virtual Assistant Services for Businesses" --website="https://virtualassistantsolutions.com/"
```

Run through Apify CLI:

```bash
apify run
```

Validate Apify schemas:

```bash
apify validate-schema
```

## Apify Deployment

The Dockerfile is stored at the project root:

```text
Dockerfile
```

Apify auto-detects it because `.actor/Dockerfile` is not present.

Deploy/rebuild on Apify:

```bash
apify push
```

If Chrome startup fails in Apify Cloud, set the environment variable below and rerun to print Chrome stderr:

```text
DEBUG_BROWSER=1
```

## Project Structure

```text
main.js                         # Root entrypoint, imports src/main.js
Dockerfile                      # Apify Docker image definition
package.json
.actor/
  actor.json                    # Apify actor metadata and dataset view
  input_schema.json             # Apify input schema
src/
  main.js                       # Actor init, proxy/browser setup, dataset push
  strategies/
    targetResolution.js         # Strategy pattern for url/cid/placeId/search
  discovery.js                  # Google Maps search and website matching
  scraper.js                    # Scrape orchestration and output formatter
  placeApi.js                   # preview/place API parsing
  placePanels.js                # photos, about, and web results enrichment
  browser.js                    # Chrome executable resolution and launch options
```

## Client Documentation

A DOCX version of the client-facing input/output documentation is included:

```text
Company_Contact_Scraper_Client_Documentation.docx
```
