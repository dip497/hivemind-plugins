# Image for Anthropic's OSS Scanner (https://github.com/anthropics/oss-scanner): the plugins published
# to HiveHub (agents, widgets, tools, views, bundles), built and checked as
# .github/workflows/test.yml does, with every dependency fetched here so the tests run with no
# network afterwards:
#
#   npm test             each widget, tool and view read and run by the app's own loaders (bun test)
#   npm run typecheck
#
# The tests load a checkout of dip497/hivemind (HIVEMIND_REF, default main) at /src/.hivemind-app,
# cloned and installed below. No Playwright e2e (it needs a built app and a display), no secrets.
# This repository has no Rust. threat_model.md, next to this file, says what matters.

# Node 22, as test.yml uses.
FROM node:22-bookworm
ENV DEBIAN_FRONTEND=noninteractive

# git is what the tool tests spawn; unzip is what Bun's installer needs.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git unzip xz-utils build-essential python3 \
    && rm -rf /var/lib/apt/lists/*

# Bun 1.4, as the app's CI pins.
ARG BUN_VERSION=1.4.3
ENV BUN_INSTALL=/usr/local/bun
ENV PATH=/usr/local/bun/bin:$PATH
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}" && bun --version

# Commits the tests make need a name.
RUN git config --global user.name "oss-scanner" && git config --global user.email "oss-scanner@localhost"

# scanner contract: the checkout lives inside the image, at /src
COPY . /src
WORKDIR /src

RUN npm ci --no-audit --no-fund

# The app the tests run each plugin through: its core and view SDK, installed with the pnpm its
# package.json names, as test.yml does.
ARG HIVEMIND_REF=main
RUN git clone --depth 1 --branch "${HIVEMIND_REF}" https://github.com/dip497/hivemind .hivemind-app \
    && npm install --global "$(node -p "require('./.hivemind-app/package.json').packageManager")" \
    && cd .hivemind-app \
    && pnpm install --frozen-lockfile --ignore-scripts --filter "@hivemind/core..." --filter "@hivemind/view-sdk..."

# The views written in TypeScript, built into views/<name>/dist. A step that fails fails the build.
RUN npm run build

# Run the checks once so the log shows the image works, without letting a failure abort the build.
RUN (npm run typecheck || echo "WARNING: typecheck reported errors") \
    && (npm test || echo "WARNING: npm test reported failures")

CMD ["bash"]
