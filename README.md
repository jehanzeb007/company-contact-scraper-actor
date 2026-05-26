# 🗺️ Company Contact Scraper

Scrape any business profile from Google Maps — get contact details, address, ratings, photos, and more in one click.

---

## ✅ What You Get

| Data | Details |
|------|---------|
| 📛 Name & Category | Business name, primary and full category list |
| 📞 Contact | Phone number (formatted + raw), website URL |
| 📍 Address | Full address + parsed street, city, state, ZIP, country |
| ⭐ Ratings | Average score, total reviews, star-by-star breakdown |
| 🕐 Hours | Opening hours for each day |
| 📸 Photos | Image URLs with author and upload date |
| 🌐 Web Results | Related web links shown in the Maps panel |
| 🔑 IDs | CID, Feature ID, Place ID, Knowledge Graph ID |

> **Note:** Individual review text is **not** collected — only the star distribution summary.

---

## 🚀 Quick Start

You need **at least one** of these to run the actor:

- A Google Maps URL
- A business name (search query)
- A Google Maps CID
- A Google Place ID

---

## ⚙️ Input Options

### 🔍 Option 1 — Search by Business Name *(most common)*

```json
{
  "strategy": "search",
  "searchQuery": "Blue Bottle Coffee San Francisco",
  "website": "https://bluebottlecoffee.com/",
  "language": "en"
}
```

> 💡 **Tip:** Always add `website` when searching by name — it helps match the correct listing.

---

### 🔗 Option 2 — Google Maps URL

Paste the URL directly from your browser:

```json
{
  "strategy": "url",
  "url": "https://www.google.com/maps/place/Eiffel+Tower/@48.8583701,2.2922926,17z"
}
```

---

### 🆔 Option 3 — CID or Place ID

```json
{
  "strategy": "cid",
  "cid": "15430805186958748717"
}
```

```json
{
  "strategy": "placeId",
  "placeId": "ChIJZQi5xUUPyokRKnfZHK7gBnc"
}
```

---

## 🛠️ All Input Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `strategy` | string | `auto` | How to find the place: `auto`, `url`, `cid`, `placeId`, or `search` |
| `url` | string | — | Google Maps place URL |
| `cid` | string | — | Google Maps CID |
| `placeId` | string | — | Google Place ID |
| `searchQuery` | string | — | Business name to search |
| `website` | string | — | Company website — helps verify the right result when searching |
| `language` | string | `en` | Maps UI language (e.g. `en`, `es`, `fr`, `de`) |
| `apiOnly` | boolean | `false` | Use Maps API only — leave `false` for the most complete data |
| `blockAssets` | boolean | `true` | Block images/fonts during scrape to save bandwidth |
| `proxyConfig` | object | Residential | Apify proxy config — residential proxies recommended |

---

## 📦 Output Example

```json
{
  "title": "Blue Bottle Coffee",
  "categoryName": "Coffee shop",
  "phone": "+1 510-653-3394",
  "website": "https://bluebottlecoffee.com/",
  "address": "300 Webster St, Oakland, CA 94607, United States",
  "city": "Oakland",
  "state": "California",
  "countryCode": "United States",
  "totalScore": 4.5,
  "reviewsCount": 812,
  "reviewsDistribution": {
    "oneStar": 20,
    "twoStar": 15,
    "threeStar": 60,
    "fourStar": 180,
    "fiveStar": 537
  },
  "openingHours": [
    { "day": "Monday", "hours": "8 AM–6 PM" }
  ],
  "location": { "lat": 37.8044, "lng": -122.2712 },
  "imageUrl": "https://lh5.googleusercontent.com/...",
  "permanentlyClosed": false,
  "scrapedAt": "2026-05-25T08:40:00.000Z"
}
```

One object per run is saved to the **Apify dataset**.

---

## ❓ FAQ

**Why is some data missing or null?**
Google Maps doesn't always show every field. Fields the actor can't find are returned as `null` or empty arrays.

**Should I include `website` with my search query?**
Yes — it greatly improves accuracy by confirming the right business was found.

**What proxy should I use?**
Residential proxies (the default) are recommended for reliable results on Apify Cloud.

**My run failed with a Chrome error. What do I do?**
Set the environment variable `DEBUG_BROWSER=1` and re-run to see detailed browser logs.

---