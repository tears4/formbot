# Production Dockerfile for Smart Form QA Bot
# Optimized for Railway / container deployments with Playwright

FROM mcr.microsoft.com/playwright:v1.49.0-jammy

WORKDIR /app

# Install production dependencies
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy application source
COPY bot.js ./
COPY config ./config
COPY input ./input
COPY src ./src

# Create writable results directory owned by pwuser (non-root)
# Also prepare /tmp/results as a fallback for restricted filesystems
RUN mkdir -p /app/results /tmp/results \
    && chown -R pwuser:pwuser /app /tmp/results \
    && chmod -R u+rwX /app/results /tmp/results

# Environment defaults
ENV NODE_ENV=production
ENV HEADLESS=true
ENV LOG_LEVEL=info
ENV RESULTS_DIR=/app/results
ENV LOOP_ENABLED=true
ENV LOOP_DELAY_MS=600000

# Playwright browsers are pre-installed in the base image
USER pwuser

CMD ["node", "bot.js"]
