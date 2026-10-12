FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv ffmpeg ca-certificates \
    && python3 -m venv /opt/yt-dlp-venv \
    && /opt/yt-dlp-venv/bin/pip install --no-cache-dir -U "yt-dlp[default]" \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

ENV PATH="/opt/yt-dlp-venv/bin:${PATH}"

COPY package*.json ./
RUN npm install --omit=dev

COPY . .
EXPOSE 3000
CMD ["npm", "start"]
