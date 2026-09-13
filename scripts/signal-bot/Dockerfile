# Build from the repository root:
# docker build -f scripts/signal-bot/Dockerfile -t cn-signal-worker:local .
FROM oven/bun:1.3.7 AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
# The repository's prepare hook installs Git hooks, which are not runtime dependencies.
RUN bun install --frozen-lockfile --production --ignore-scripts

FROM oven/bun:1.3.7 AS runtime
USER root
RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates ffmpeg nodejs python3 python3-venv util-linux \
    && python3 -m venv /opt/media-tools \
    && /opt/media-tools/bin/pip install --no-cache-dir yt-dlp gallery-dl \
    && ln -s /opt/media-tools/bin/yt-dlp /usr/local/bin/yt-dlp \
    && ln -s /opt/media-tools/bin/gallery-dl /usr/local/bin/gallery-dl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
# The browser installed as root must also be discoverable by the runtime bun user.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY --from=dependencies /app/node_modules ./node_modules
# Invoke the installed package's CLI so Chromium always matches bun.lock.
RUN node ./node_modules/playwright/cli.js install --with-deps chromium \
    && chmod -R a+rX /ms-playwright \
    && rm -rf /var/lib/apt/lists/*
COPY package.json ./
COPY src/api ./src/api
COPY src/bots ./src/bots
COPY src/pipeline ./src/pipeline
COPY src/signal-bot ./src/signal-bot
COPY src/utils ./src/utils
RUN mkdir -p /state /app/output \
    && chown bun:bun /state /app/output \
    && ffmpeg -version > /dev/null \
    && yt-dlp --version > /dev/null \
    && gallery-dl --version > /dev/null
USER bun
# Offline smoke checks run with the same user and browser path as production.
# --help must work without credentials; page.setContent makes no network request.
RUN bun src/signal-bot/main.ts --help > /dev/null \
    && bun --eval 'import { getBrowser, closeBrowser } from "./src/pipeline/utils/browserManager.ts"; const browser = await getBrowser(); const page = await browser.newPage(); await page.setContent("<title>Signal browser ready</title>"); if (await page.title() !== "Signal browser ready") throw new Error("Browser smoke check failed"); await closeBrowser();'
# Keep an OS lock across Bun execution; --no-fork lets Docker's init deliver
# shutdown signals directly to Bun while the lock releases on process exit.
ENTRYPOINT ["flock", "--no-fork", "--nonblock", "/state/worker.lock", "bun", "/app/src/signal-bot/main.ts"]
