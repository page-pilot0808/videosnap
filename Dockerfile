
FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PYTHONUNBUFFERED=1
ENV PATH="/opt/yt-dlp-venv/bin:${PATH}"

WORKDIR /app

# Install runtime dependencies and yt-dlp in an isolated Python environment
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        python3-venv \
        ffmpeg \
        ca-certificates \
    && python3 -m venv /opt/yt-dlp-venv \
    && /opt/yt-dlp-venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/yt-dlp-venv/bin/pip install --no-cache-dir "yt-dlp[default]" \
    && apt-get purge -y --auto-remove \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js dependencies first for better build caching
COPY package*.json ./

RUN npm install --omit=dev \
    && npm cache clean --force

# Copy application files
COPY . .

# Render or another host can provide PORT through environment variables
EXPOSE 3000

CMD ["npm", "start"]
