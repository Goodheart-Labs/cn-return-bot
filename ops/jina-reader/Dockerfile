# Jina Reader, built from its open-source repository at a pinned commit, plus
# our patch that lets it use the DataImpulse residential proxy (GOO-853).
# The cn-jina-reader unit builds this image on the services box and runs it.
#
# The final stage copies upstream's own Dockerfile for amd64, the services
# box's architecture. Upstream's Dockerfile expects an already compiled
# checkout, so the first stage does what upstream's CI does before it builds
# the image: install, download the licensed assets and compile.

FROM node:24 AS build
# The commit of github.com/jina-ai/reader we build. Upgrading Jina means
# changing this value and checking that the patch still applies.
ARG JINA_READER_COMMIT=1574bfd380d249c86c82db4dace0d9c8fe17e2b1
WORKDIR /src
RUN git init -q . \
    && git fetch -q --depth 1 https://github.com/jina-ai/reader.git "$JINA_READER_COMMIT" \
    && git checkout -q FETCH_HEAD
COPY dataimpulse-proxy.patch /tmp/
RUN git apply /tmp/dataimpulse-proxy.patch
RUN npm ci && bash download-external-assets.sh && npm run build

FROM node:24
RUN apt-get update \
    && apt-get install -y wget gnupg \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y libreoffice google-chrome-stable fonts-noto-cjk-extra fonts-noto-color-emoji fonts-liberation fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 zstd libc++-dev \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*
ENV OVERRIDE_CHROME_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
RUN groupadd -r jina && useradd -g jina -G audio,video -m jina
USER jina
WORKDIR /app
COPY --from=build --chown=jina:jina /src/package.json /src/package-lock.json ./
COPY --from=build --chown=jina:jina /src/node_modules ./node_modules
COPY --from=build --chown=jina:jina /src/build ./build
COPY --from=build --chown=jina:jina /src/public ./public
COPY --from=build --chown=jina:jina /src/licensed ./licensed
RUN rm -rf ~/.config/chromium && mkdir -p ~/.config/chromium
RUN NODE_COMPILE_CACHE=node_modules npm run dry-run
ENV NODE_COMPILE_CACHE=node_modules
ENV PORT=8080
# 8080 speaks only HTTP/2. The plain HTTP/1.1 server listens on 8081.
EXPOSE 8081
ENTRYPOINT ["node"]
CMD ["build/stand-alone/crawl.js"]
