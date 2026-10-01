# Trusted, minimal OCI image for GitHub bounty source inspection/test execution.
# Build and scan this image in deployment, then configure its immutable digest as
# ZA141251SA_BOUNTY_SANDBOX_IMAGE_DIGEST. The mission worker uses --pull=never.
# A supported Debian slim base avoids retaining Alpine's broad busybox/musl
# vulnerability surface while still keeping the trusted runner very small.
FROM node:24-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends tar gzip \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/runner
COPY runner.mjs /opt/runner/runner.mjs
USER 65532:65532
ENTRYPOINT ["node", "/opt/runner/runner.mjs"]
