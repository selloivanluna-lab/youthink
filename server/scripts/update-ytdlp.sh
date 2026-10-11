#!/bin/sh
# Actualiza yt-dlp sin tumbar el arranque si falla (sin red, etc.).
echo "[update-ytdlp] actualizando yt-dlp..."
pip3 install --no-cache-dir --break-system-packages -U yt-dlp \
  && echo "[update-ytdlp] OK: $(yt-dlp --version 2>/dev/null)" \
  || echo "[update-ytdlp] WARN: no se pudo actualizar (se usa la versión instalada)"
exit 0
