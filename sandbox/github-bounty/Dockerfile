# Trusted, minimal OCI image for GitHub bounty source inspection/test execution.
# Build and scan this image in deployment, then configure its immutable digest as
# ZA141251SA_BOUNTY_SANDBOX_IMAGE_DIGEST. The mission worker uses --pull=never.
FROM node:22-alpine
RUN apk add --no-cache tar gzip
WORKDIR /opt/runner
COPY runner.mjs /opt/runner/runner.mjs
USER 65532:65532
ENTRYPOINT ["node", "/opt/runner/runner.mjs"]
