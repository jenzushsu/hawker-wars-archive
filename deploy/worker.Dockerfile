# syntax=docker/dockerfile:1
FROM node:24.19.0-bookworm-slim
WORKDIR /app
# Optional CA is for managed build environments; never stored in the image.
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm install --global pnpm@11.25.0
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=node:node packages ./packages
COPY --chown=node:node apps/web/package.json ./apps/web/package.json
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    pnpm install --frozen-lockfile
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node manifests ./manifests
COPY --chown=node:node docs/providers/prompt-v2-comparison-approval.json ./docs/providers/prompt-v2-comparison-approval.json
COPY --chown=node:node docs/providers/planning-experiment-approval.json ./docs/providers/planning-experiment-approval.json
COPY --chown=node:node docs/deployment/evidence/prompt-v2/jev-investigation.json ./docs/deployment/evidence/prompt-v2/jev-investigation.json
COPY --chown=node:node docs/providers/short-plan-approval.json ./docs/providers/short-plan-approval.json
USER node
ENV NODE_ENV=production
CMD ["node", "--use-env-proxy", "--import", "tsx", "scripts/supervise-rules-worker.ts"]
