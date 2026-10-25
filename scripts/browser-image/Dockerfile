FROM node:26.8.1@sha256:f5d1cc40abc10c2843339a2134d07817cf33c405cb16bfd052b0ed790254c3a3

ARG NODE_VERSION=26.8.1
ARG NUB_VERSION=0.9.6
ARG NUB_SHA256=77220dc6deb6ebbdb0a282c61b80a157e32016e088f3632d8fb4bf74a931e4ce
ARG PLAYWRIGHT_VERSION=1.64.0
ARG PLAYWRIGHT_CORE_SHA512=T9r+MZkTECl2+oUcZ26YgZzTrYidTsIhYYkJix+6iDOymOb1FB2RLLSOxRGnZGv5DStt+aduIVbt+E8WygXYpg==
ARG DEBIAN_SNAPSHOT=20261024T000000Z

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PATH=/opt/nub/bin:$PATH

RUN test "$(uname -m)" = x86_64 && test "$(node -p 'process.versions.node')" = "$NODE_VERSION" \
    && rm -f /etc/apt/sources.list /etc/apt/sources.list.d/* \
    && printf 'deb [check-valid-until=no] https://snapshot.debian.org/archive/debian/%s/ trixie main\ndeb [check-valid-until=no] https://snapshot.debian.org/archive/debian-security/%s/ trixie-security main\n' "$DEBIAN_SNAPSHOT" "$DEBIAN_SNAPSHOT" > /etc/apt/sources.list \
    && curl -fsSL "https://github.com/nubjs/nub/releases/download/v$NUB_VERSION/nub-linux-x64.tar.gz" -o /tmp/nub.tgz \
    && printf '%s  /tmp/nub.tgz\n' "$NUB_SHA256" | sha256sum -c - \
    && mkdir -p /opt/nub \
    && tar -xzf /tmp/nub.tgz -C /opt/nub \
    && nub --version | grep -qxF "v$NUB_VERSION" \
    && rm /tmp/nub.tgz

RUN --mount=type=bind,source=verify.mjs,target=/tmp/verify.mjs \
    curl -fsSL "https://registry.npmjs.org/playwright-core/-/playwright-core-$PLAYWRIGHT_VERSION.tgz" -o /tmp/playwright-core.tgz \
    && ACTUAL_SHA512="$(openssl dgst -sha512 -binary /tmp/playwright-core.tgz | openssl base64 -A)" \
    && test "$ACTUAL_SHA512" = "$PLAYWRIGHT_CORE_SHA512" \
    && mkdir /tmp/playwright-core \
    && tar -xzf /tmp/playwright-core.tgz -C /tmp/playwright-core --strip-components=1 \
    && node /tmp/playwright-core/cli.js install --with-deps chromium firefox \
    && node /tmp/verify.mjs \
    && mkdir -p /opt/browser-ci \
    && printf '{"node":"%s","nub":"%s","playwright":"%s"}\n' "$NODE_VERSION" "$NUB_VERSION" "$PLAYWRIGHT_VERSION" > /opt/browser-ci/versions.json \
    && chmod -R a+rX /ms-playwright \
    && rm -rf /tmp/playwright-core /tmp/playwright-core.tgz /var/lib/apt/lists/* /root/.cache /root/.npm
