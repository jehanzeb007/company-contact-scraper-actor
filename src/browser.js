import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

function isApifyRuntime() {
  return Boolean(
    process.env.APIFY_ACTOR_RUN_ID
    || process.env.ACTOR_RUN_ID
    || process.env.APIFY_CHROME_EXECUTABLE_PATH,
  );
}

function findChromeBinaryInDir(dir, depth = 0) {
  if (!dir || depth > 8 || !existsSync(dir)) return null;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isFile() && entry.name === 'chrome') return full;
      if (entry.isDirectory()) {
        const nested = findChromeBinaryInDir(full, depth + 1);
        if (nested) return nested;
      }
    }
  } catch { /* ignore permission errors */ }
  return null;
}

function findPuppeteerCachedChrome() {
  const roots = [
    process.env.PUPPETEER_CACHE_DIR,
    '/puppeteer-browsers',
    join(process.env.HOME || '/home/myuser', '.cache', 'puppeteer'),
  ].filter(Boolean);

  for (const root of roots) {
    const hit = findChromeBinaryInDir(root);
    if (hit) return hit;
  }
  return null;
}

/** Chrome binary for Apify Docker image or local Puppeteer cache. */
export function resolveChromeExecutablePath() {
  const envPath = process.env.APIFY_CHROME_EXECUTABLE_PATH
    || process.env.PUPPETEER_EXECUTABLE_PATH
    || process.env.APIFY_DEFAULT_BROWSER_EXECUTABLE_PATH;

  if (envPath) return envPath;

  const cached = findPuppeteerCachedChrome();
  if (cached) return cached;

  const fallbacks = process.platform === 'win32'
    ? [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ]
    : [
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
    ];

  for (const p of fallbacks) {
    if (existsSync(p)) return p;
  }

  if (isApifyRuntime() || process.platform === 'linux') {
    return '/usr/bin/google-chrome';
  }

  return undefined;
}

export function buildPuppeteerLaunchOptions({ headless, args, defaultViewport }) {
  const executablePath = resolveChromeExecutablePath();

  if (!executablePath && (isApifyRuntime() || process.platform === 'linux')) {
    throw new Error(
      'Chrome executable not found. Use apify/actor-node-puppeteer-chrome base image '
      + 'and redeploy after `apify push`.',
    );
  }

  const options = { headless, args, defaultViewport };
  if (executablePath) options.executablePath = executablePath;
  return options;
}
