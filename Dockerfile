FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip ffmpeg curl unzip ca-certificates \
      xvfb xauth fonts-liberation fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/*

# yt-dlp (binario) + ytmusicapi (radio). PEP 668 -> --break-system-packages
RUN pip3 install --no-cache-dir --break-system-packages -U yt-dlp ytmusicapi

# Deno (firma nsig de YouTube para yt-dlp)
ENV DENO_INSTALL=/usr/local/deno
RUN curl -fsSL https://deno.land/install.sh | sh
ENV PATH="/usr/local/deno/bin:${PATH}"

WORKDIR /app
COPY server/package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Chromium de Playwright (remote browser / Cookie Keeper Plan B)
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install --with-deps chromium

COPY server/ .

ENV PORT=8080
ENV HOST=0.0.0.0
ENV BROWSER_HEADLESS=0
ENV BROWSER_PROFILE_DIR=/data/profile
EXPOSE 8080

# Refresca yt-dlp en el arranque y levanta el server bajo Xvfb (navegador headful).
CMD ["sh", "-c", "scripts/update-ytdlp.sh; xvfb-run -a node src/index.js"]
