# Node 20 + Chrome for Puppeteer actors.
FROM apify/actor-node-puppeteer-chrome:20

# Base image ships Chrome; npm must not download another browser during ci
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROME_DOWNLOAD=true \
    APIFY_CHROME_EXECUTABLE_PATH=/usr/bin/google-chrome \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome

COPY package*.json ./

RUN npm cache clean --force \
    && npm ci --omit=dev \
    && npm cache clean --force

COPY . ./

# Verify Chrome + our browser helper exist in the image
RUN test -x /usr/bin/google-chrome \
    && test -f /home/myuser/src/browser.js \
    && node -e "import('./src/browser.js').then(m => { const p = m.resolveChromeExecutablePath(); if (!p) throw new Error('no chrome'); console.log('Chrome OK:', p); })"

CMD ["node", "main.js"]
