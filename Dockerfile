# Production Dockerfile for Smart Form QA Bot
# Optimized for Railway / container deployments with Playwright

FROM mcr.microsoft.com/playwright:v1.49.0-jammy

# Use Node already present in the Playwright image
WORKDIR /app

# Install only production deps first (better layer caching)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy application source
COPY bot.js ./
COPY config ./config
COPY input ./input
COPY src ./src

# Ensure results directory exists (will be written at runtime)
RUN mkdir -p results

# Environment defaults
ENV NODE_ENV=production
ENV HEADLESS=true
ENV LOG_LEVEL=info

# Playwright browsers are pre-installed in the base image
# Running as non-root is recommended; the playwright image includes pwuser
USER pwuser

# Default command
CMD ["node", "bot.js"]
