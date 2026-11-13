FROM node:22-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg ca-certificates \
 && pip3 install --break-system-packages -U yt-dlp \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json server.js ./
COPY src ./src
COPY public ./public

ENV HOST=0.0.0.0 \
    PORT=8787 \
    DOWNLOAD_DIR=/data \
    VIDYRA_CONFIG=/data/config
EXPOSE 8787
CMD ["node", "server.js"]
