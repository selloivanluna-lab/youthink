'use strict';
// Búsqueda directa en YouTube vía API interna InnerTube (WEB / Android).
// Ultrarrápida (~200-600ms), sin dependencia de Python, sin bloqueo de bot en la nube,
// y capaz de encontrar videos generales (entrevistas, podcasts, tutoriales, sketches)
// que no existen en el catálogo restringido de YouTube Music.
//
// Importante: NO filtramos a "canciones". Devolvemos videos reales (incluidos Shorts)
// y soportamos paginación por continuation para que el usuario pueda seguir bajando
// resultados y encontrar esos videos que antes quedaban fuera del top 20.

const https = require('https');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Clave pública de InnerTube (la misma que usa la web de YouTube). Se refresca
// automáticamente leyendo el HTML de youtube.com; esto evita romperse cuando
// YouTube cambia la versión del cliente WEB.
const FALLBACK_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const FALLBACK_VERSION = '2.20250701.00.00';

const FILTER_VIDEOS = 'EgIQAQ%3D%3D'; // protobuf oficial: solo videos
const FILTER_PLAYLISTS = 'EgIQAw%3D%3D'; // protobuf oficial: solo listas de reproducción
const FILTER_SONGS = 'EgWKAQIIAWoKEAUQAxAEEAkQFA%3D%3D'; // protobuf oficial de YouTube Music para canciones

let clientCache = { version: '', key: '', at: 0 };

function parseDuration(durationText) {
  if (!durationText || typeof durationText !== 'string') return 0;
  const parts = durationText.trim().split(':').map((n) => parseInt(n, 10) || 0);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function fetchText(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': UA,
          'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          res.resume();
          return reject(new Error('HTTP ' + res.statusCode));
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => {
          body += c;
          if (body.length > 3 * 1024 * 1024) {
            res.destroy();
            resolve(body);
          }
        });
        res.on('end', () => resolve(body));
      }
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.on('error', reject);
  });
}

function postJson(host, path, payload, timeoutMs = 9000) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(payload);
    const req = https.request(
      {
        hostname: host,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'User-Agent': UA,
          'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
          Origin: 'https://www.youtube.com',
          Referer: 'https://www.youtube.com/',
        },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            return reject(new Error('YouTube InnerTube respondió HTTP ' + res.statusCode));
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error('Respuesta de InnerTube inválida'));
          }
        });
      }
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error('timeout de búsqueda YouTube InnerTube (>' + Math.round(timeoutMs / 1000) + 's)'));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function getClientInfo() {
  const now = Date.now();
  if (clientCache.version && now - clientCache.at < 6 * 3600 * 1000) return clientCache;
  try {
    const html = await fetchText('https://www.youtube.com/?hl=es&gl=AR', 7000);
    const version = /"INNERTUBE_CLIENT_VERSION":"([^"]+)"/.exec(html)?.[1];
    const key = /"INNERTUBE_API_KEY":"([^"]+)"/.exec(html)?.[1];
    if (version) {
      clientCache = { version, key: key || FALLBACK_KEY, at: now };
      return clientCache;
    }
  } catch (_) {}
  clientCache = { version: FALLBACK_VERSION, key: FALLBACK_KEY, at: now };
  return clientCache;
}

function textOf(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (typeof node.simpleText === 'string') return node.simpleText;
  if (typeof node.content === 'string') return node.content;
  if (Array.isArray(node.runs)) return node.runs.map((r) => r.text || '').join('');
  return '';
}

// Busca la primera imagen (con URL) dentro de un subárbol. Los renderers nuevos
// (lockupViewModel) esconden las miniaturas en estructuras muy anidadas.
function firstImageUrl(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 10) return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = firstImageUrl(n, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (Array.isArray(node.sources)) {
    const urls = node.sources.map((s) => s && s.url).filter(Boolean);
    if (urls.length) return urls[urls.length - 1];
  }
  if (Array.isArray(node.thumbnails)) {
    const urls = node.thumbnails.map((s) => s && s.url).filter(Boolean);
    if (urls.length) return urls[urls.length - 1];
  }
  for (const k of Object.keys(node)) {
    const r = firstImageUrl(node[k], depth + 1);
    if (r) return r;
  }
  return null;
}

function pickThumb(vr, videoId) {
  const thumbs =
    vr.thumbnail?.thumbnails ||
    vr.thumbnailOverlays?.map((o) => o.thumbnailOverlayTimeStatusRenderer?.thumbnails).flat() ||
    [];
  const url = thumbs[thumbs.length - 1]?.url;
  return url || 'https://i.ytimg.com/vi/' + videoId + '/mqdefault.jpg';
}

function isLive(vr) {
  const badges = vr.badges || [];
  for (const b of badges) {
    const style = b?.metadataBadgeRenderer?.style || '';
    if (/LIVE/i.test(style)) return true;
  }
  const overlays = vr.thumbnailOverlays || [];
  for (const o of overlays) {
    const st = o?.thumbnailOverlayTimeStatusRenderer?.style || '';
    if (/LIVE/i.test(st)) return true;
  }
  return false;
}

function checkIfAlbumVideo(title, duration) {
  if (!title) return false;
  const t = title.toLowerCase();
  const hasAlbumWord = /(álbum|album)\s+completo|full\s+album|disco\s+completo|disco\s+entero|complete\s+album|\(album\)|\(álbum\)|\[album\]|\[álbum\]/i.test(t);
  if (hasAlbumWord && duration >= 600) return true;
  if (duration >= 1500 && /(álbum|album|disco)/i.test(t)) return true;
  return false;
}

function pushVideo(vr, out, seen, kind) {
  if (!vr || !vr.videoId || seen.has(vr.videoId)) return;
  seen.add(vr.videoId);
  const vid = vr.videoId;
  const title = textOf(vr.title) || textOf(vr.headline) || '(sin título)';
  const channel =
    textOf(vr.ownerText) ||
    textOf(vr.longBylineText) ||
    textOf(vr.shortBylineText) ||
    '';
  const durationText =
    vr.lengthText?.simpleText || (Array.isArray(vr.lengthText?.runs) ? textOf(vr.lengthText) : '');
  const duration = parseDuration(durationText);
  const live = isLive(vr);
  const isAlbum = checkIfAlbumVideo(title, duration);

  out.push({
    id: vid,
    title,
    channel,
    duration: live ? 0 : duration,
    durationText,
    thumb: pickThumb(vr, vid),
    url: 'https://www.youtube.com/watch?v=' + vid,
    kind: kind || 'video',
    live,
    views: textOf(vr.viewCountText) || textOf(vr.shortViewCountText),
    published: textOf(vr.publishedTimeText),
    isAlbumVideo: isAlbum || undefined,
  });
}

// Recorre el árbol de la respuesta y junta los renderers de video en el orden
// en que aparecen (funciona tanto con twoColumn como con singleColumn/shelves).
function collectVideos(node, out, seen, limit, depth) {
  if (!node || typeof node !== 'object' || out.length >= limit || depth > 24) return;
  if (Array.isArray(node)) {
    for (const n of node) {
      if (out.length >= limit) return;
      collectVideos(n, out, seen, limit, depth + 1);
    }
    return;
  }

  const vr = node.videoRenderer || node.compactVideoRenderer || node.gridVideoRenderer;
  if (vr) pushVideo(vr, out, seen, 'video');

  const pr = node.playlistRenderer || node.compactPlaylistRenderer || node.gridPlaylistRenderer;
  if (pr && out.length < limit) {
    const plId = pr.playlistId;
    if (plId && !seen.has(plId)) {
      seen.add(plId);
      const title = textOf(pr.title) || '(sin título)';
      const count = textOf(pr.videoCountText || pr.videoCountShortText) || (pr.videoCount ? `${pr.videoCount} videos` : 'Lista');
      const canal = textOf(pr.shortBylineText || pr.ownerText) || '';
      const isAlbum = plId.startsWith('OLAK') || /álbum|album/i.test(title);
      const firstVid = pr.navigationEndpoint?.watchEndpoint?.videoId;
      const thumb = pr.thumbnails?.[0]?.thumbnails?.slice(-1)?.[0]?.url || (firstVid ? 'https://i.ytimg.com/vi/' + firstVid + '/mqdefault.jpg' : '');
      out.push({
        id: plId,
        title,
        channel: canal,
        duration: 0,
        durationText: count,
        itemCountText: count,
        firstVideoId: firstVid || undefined,
        thumb,
        url: 'https://www.youtube.com/playlist?list=' + plId,
        kind: isAlbum ? 'album' : 'playlist',
        live: false,
      });
    }
  }

  const reel = node.reelItemRenderer;
  if (reel && out.length < limit) {
    const id = reel.videoId;
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push({
        id,
        title: textOf(reel.headline) || '(sin título)',
        channel: '',
        duration: 0,
        durationText: '',
        thumb: pickThumb(reel, id),
        url: 'https://www.youtube.com/watch?v=' + id,
        kind: 'short',
        live: false,
      });
    }
  }

  // Shorts dentro de los estantes "gridShelfViewModel".
  const shortLockup = node.shortsLockupViewModel;
  if (shortLockup && out.length < limit) {
    const id =
      String(shortLockup.entityId || '').replace(/^shorts-shelf-item-/, '') ||
      shortLockup?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ||
      '';
    if (/^[\w-]{11}$/.test(id) && !seen.has(id)) {
      seen.add(id);
      const overlay = shortLockup.overlayMetadata || {};
      out.push({
        id,
        title: textOf(overlay.primaryText) || textOf(shortLockup.accessibilityText) || '(sin título)',
        channel: '',
        duration: 0,
        durationText: '',
        thumb: firstImageUrl(shortLockup.thumbnailViewModel) || 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg',
        url: 'https://www.youtube.com/shorts/' + id,
        kind: 'short',
        live: false,
        views: textOf(overlay.secondaryText),
      });
    }
  }

  // lockupViewModel: formato nuevo de YouTube (videos, playlists, mixes o álbumes).
  const lockup = node.lockupViewModel;
  if (lockup && out.length < limit) {
    const tipo = String(lockup.contentType || '');
    const meta = lockup?.metadata?.lockupMetadataViewModel;
    const title = textOf(meta?.title) || '(sin título)';
    const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows || [];
    const partes = [];
    for (const row of rows) {
      for (const part of row?.metadataParts || []) {
        const t = textOf(part?.text);
        if (t) partes.push(t);
      }
    }

    const esPlaylist =
      tipo === 'LOCKUP_CONTENT_TYPE_PLAYLIST' ||
      tipo === 'LOCKUP_CONTENT_TYPE_ALBUM' ||
      /^((PL|OLAK|RD|UU|FL)[\w-]{10,})$/.test(String(lockup.contentId || ''));

    if (esPlaylist) {
      const plId = String(lockup.contentId || '');
      if (plId && !seen.has(plId)) {
        seen.add(plId);
        const watchId =
          lockup?.itemPlayback?.inlinePlayerData?.onSelect?.innertubeCommand?.watchEndpoint?.videoId ||
          lockup?.onTap?.innertubeCommand?.watchEndpoint?.videoId ||
          lockup?.rendererContext?.commandContext?.onTap?.innertubeCommand?.watchEndpoint?.videoId ||
          '';
        const isAlbum = plId.startsWith('OLAK') || /álbum|album/i.test(title) || partes.some((p) => /álbum|album/i.test(p));
        const countText = partes.find((p) => /\d+\s*(videos?|temas?|canciones?)/i.test(p)) || (isAlbum ? 'Álbum' : 'Lista');
        const canal = partes.find((p) => !/\d+\s*(videos?|temas?|canciones?)/i.test(p) && !/lista de reproducci|album|álbum|mix/i.test(p)) || '';
        out.push({
          id: plId,
          title,
          channel: canal,
          duration: 0,
          durationText: countText,
          itemCountText: countText,
          firstVideoId: watchId || undefined,
          thumb: firstImageUrl(lockup.contentImage) || (watchId ? 'https://i.ytimg.com/vi/' + watchId + '/mqdefault.jpg' : ''),
          url: 'https://www.youtube.com/playlist?list=' + plId,
          kind: isAlbum ? 'album' : 'playlist',
          live: false,
        });
      }
    } else {
      const watchId =
        lockup?.itemPlayback?.inlinePlayerData?.onSelect?.innertubeCommand?.watchEndpoint?.videoId ||
        lockup?.onTap?.innertubeCommand?.watchEndpoint?.videoId ||
        lockup?.rendererContext?.commandContext?.onTap?.innertubeCommand?.watchEndpoint?.videoId ||
        '';
      const esVideo =
        tipo === 'LOCKUP_CONTENT_TYPE_VIDEO' ||
        (!tipo && /^[\w-]{11}$/.test(String(lockup.contentId || '')));
      const id = esVideo ? watchId || String(lockup.contentId || '') : '';
      if (/^[\w-]{11}$/.test(id) && !seen.has(id)) {
        let durationText = '';
        const overlays =
          lockup?.contentImage?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel
            ?.overlays ||
          lockup?.contentImage?.thumbnailViewModel?.overlays ||
          [];
        for (const o of overlays) {
          for (const b of o?.thumbnailOverlayBadgeViewModel?.thumbnailBadges || []) {
            const t = String(b?.thumbnailBadgeViewModel?.text || '').trim();
            if (/^\d+(:\d+)+$/.test(t)) durationText = t;
          }
        }
        if (!durationText) {
          durationText = partes.find((p) => /^\d+(:\d+)+$/.test(p)) || '';
        }
        const canal =
          partes.find((p) => !/^\d+(:\d+)+$/.test(p) && !/visualizaci|views|hace /i.test(p)) || '';
        const durSecs = parseDuration(durationText);
        const isAlbum = checkIfAlbumVideo(title, durSecs);
        seen.add(id);
        out.push({
          id,
          title,
          channel: canal,
          duration: durSecs,
          durationText,
          thumb: firstImageUrl(lockup.contentImage) || 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg',
          url: 'https://www.youtube.com/watch?v=' + id,
          kind: 'video',
          live: false,
          views: partes.find((p) => /visualizaci|views/i.test(p)) || '',
          isAlbumVideo: isAlbum || undefined,
        });
      }
    }
  }

  for (const k of Object.keys(node)) {
    if (out.length >= limit) return;
    if (k === 'videoRenderer' || k === 'compactVideoRenderer' || k === 'gridVideoRenderer') continue;
    if (k === 'reelItemRenderer' || k === 'lockupViewModel' || k === 'shortsLockupViewModel') continue;
    if (k === 'playlistRenderer' || k === 'compactPlaylistRenderer' || k === 'gridPlaylistRenderer') continue;
    collectVideos(node[k], out, seen, limit, depth + 1);
  }
}

function findContinuation(json) {
  // Las páginas siguientes llegan dentro de onResponseReceivedCommands
  // (appendContinuationItemsAction), no en contents.
  const contents = json?.contents || json?.onResponseReceivedCommands;
  if (!contents) return null;

  const two = json?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer;
  const one = json?.contents?.singleColumnSearchResultsRenderer;
  const sectionList = two || one?.contents?.find?.((x) => x?.itemSectionRenderer) || null;

  // 1) continuación explícita del sectionListRenderer
  const direct =
    two?.continuations?.[0]?.nextContinuationData?.continuation ||
    sectionList?.continuations?.[0]?.nextContinuationData?.continuation;
  if (direct) return direct;

  // 2) el clásico "continuationItemRenderer" al final de los items
  const walk = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 20) return null;
    if (Array.isArray(node)) {
      for (const n of node) {
        const r = walk(n, depth + 1);
        if (r) return r;
      }
      return null;
    }
    const cir = node.continuationItemRenderer;
    if (cir) {
      const token =
        cir?.continuationEndpoint?.continuationCommand?.token ||
        cir?.button?.buttonRenderer?.command?.continuationCommand?.token;
      if (token) return token;
    }
    for (const k of Object.keys(node)) {
      const r = walk(node[k], depth + 1);
      if (r) return r;
    }
    return null;
  };
  return walk(contents, 0);
}

async function requestPage(query, continuation, params, clientName, clientVersion, key) {
  const client = {
    clientName,
    clientVersion,
    hl: 'es',
    gl: 'AR',
    userAgent: UA,
  };
  if (clientName === 'ANDROID') {
    client.androidSdkVersion = 30;
    client.osName = 'Android';
    client.osVersion = '11';
  }

  const payload = {
    context: { client },
  };
  if (continuation) {
    payload.continuation = continuation;
  } else {
    payload.query = query;
    if (params) payload.params = params;
  }

  const qs = key ? '?key=' + encodeURIComponent(key) : '';
  const json = await postJson('www.youtube.com', '/youtubei/v1/search' + qs, payload);
  return json;
}

function parsePage(json, limit, seen) {
  const out = [];
  collectVideos(json?.contents, out, seen, limit, 0);
  if (out.length < limit) {
    collectVideos(json?.onResponseReceivedCommands, out, seen, limit, 0);
  }
  return { results: out, continuation: findContinuation(json) };
}

async function searchRaw(query, limit, type, clientName, clientVersion, key) {
  let params = undefined;
  if (type === 'videos') params = FILTER_VIDEOS;
  else if (type === 'playlists') params = FILTER_PLAYLISTS;
  const seen = new Set();
  const results = [];
  let continuation = null;
  let pages = 0;

  while (results.length < limit && pages < 4) {
    const json = await requestPage(
      query,
      continuation,
      params,
      clientName,
      clientVersion,
      key
    );
    const page = parsePage(json, limit - results.length, seen);
    results.push(...page.results);
    continuation = page.continuation;
    pages += 1;
    if (!continuation) break;
  }

  return { results, continuation };
}

async function searchMusic(query, limit = 20) {
  if (!query || !String(query).trim()) return [];
  const client = await getClientInfo();
  const payload = {
    context: {
      client: {
        clientName: 'WEB_REMIX',
        clientVersion: '1.20250701.00.00',
        hl: 'es',
        gl: 'AR',
        userAgent: UA,
      },
    },
    query: String(query).trim(),
    params: FILTER_SONGS,
  };

  const qs = client.key ? '?key=' + encodeURIComponent(client.key) : '';
  let json;
  try {
    json = await postJson('music.youtube.com', '/youtubei/v1/search' + qs, payload, 9000);
  } catch (e) {
    return [];
  }

  const results = [];
  const seen = new Set();
  function walk(node, depth = 0) {
    if (!node || typeof node !== 'object' || results.length >= limit || depth > 20) return;
    if (Array.isArray(node)) {
      for (const n of node) {
        if (results.length >= limit) return;
        walk(n, depth + 1);
      }
      return;
    }
    if (node.musicResponsiveListItemRenderer) {
      const it = node.musicResponsiveListItemRenderer;
      const vid =
        it.playlistItemData?.videoId ||
        it.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId ||
        it.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId;
      const title = it.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text;
      const canal = it.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text;
      const thumbs = it.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
      const thumb = thumbs.slice(-1)[0]?.url || (vid ? 'https://i.ytimg.com/vi/' + vid + '/mqdefault.jpg' : '');
      if (vid && title && !seen.has(vid)) {
        seen.add(vid);

        // Extraer duración de YouTube Music si viene en runs de flexColumns o fixedColumns
        let durText = '';
        const fixedRuns = it.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs || [];
        for (const r of fixedRuns) {
          const txt = String(r?.text || '').trim();
          if (/^\d+(:\d+)+$/.test(txt)) { durText = txt; break; }
        }
        if (!durText) {
          const flexRuns = it.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
          for (const r of flexRuns) {
            const txt = String(r?.text || '').trim();
            if (/^\d+(:\d+)+$/.test(txt)) { durText = txt; break; }
          }
        }
        const durSecs = parseDuration(durText);

        results.push({
          id: vid,
          title,
          channel: canal || '',
          duration: durSecs,
          durationText: durText,
          thumb,
          url: 'https://www.youtube.com/watch?v=' + vid,
          kind: 'song',
          live: false,
        });
      }
    }
    for (const k of Object.keys(node)) {
      if (results.length >= limit) return;
      walk(node[k], depth + 1);
    }
  }
  walk(json);
  return results;
}

async function runSearch(query, limit, type) {
  if (!query || !String(query).trim()) return { results: [], continuation: null };
  const client = await getClientInfo();

  // Si se piden explícitamente canciones, buscar en YouTube Music directamente
  if (type === 'songs') {
    try {
      const songs = await searchMusic(query, limit);
      if (songs.length > 0) return { results: songs, continuation: null };
    } catch (_) {}
  }

  const attempts = [
    { name: 'WEB', version: client.version },
    { name: 'ANDROID', version: '19.29.37' },
  ];

  let lastErr = null;
  for (const a of attempts) {
    try {
      // Si type === 'all', enriquecer la búsqueda de videos con las canciones oficiales del artista
      if (type === 'all') {
        const [rSearch, songs] = await Promise.all([
          searchRaw(String(query).trim(), limit, type, a.name, a.version, client.key).catch(() => ({ results: [], continuation: null })),
          searchMusic(String(query).trim(), Math.min(limit, 10)).catch(() => []),
        ]);
        if (rSearch.results.length > 0 || songs.length > 0) {
          const seen = new Set();
          const out = [];
          // Primero canciones oficiales destacadas
          for (const s of songs.slice(0, 4)) {
            if (!seen.has(s.id)) { seen.add(s.id); out.push(s); }
          }
          // Luego videos y playlists generales
          for (const r of rSearch.results) {
            if (!seen.has(r.id)) { seen.add(r.id); out.push(r); }
          }
          // Luego el resto de canciones oficiales
          for (const s of songs.slice(4)) {
            if (!seen.has(s.id)) { seen.add(s.id); out.push(s); }
          }
          return { results: out.slice(0, limit), continuation: rSearch.continuation };
        }
      } else {
        const r = await searchRaw(
          String(query).trim(),
          limit,
          type,
          a.name,
          a.version,
          client.key
        );
        if (r.results.length > 0) return r;
      }
      lastErr = new Error('Sin resultados con cliente ' + a.name);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('No se pudo buscar en YouTube');
}

// Página siguiente a partir de un token de continuación (mismo cliente WEB).
async function runContinue(token, limit) {
  if (!token) return { results: [], continuation: null };
  const client = await getClientInfo();
  const seen = new Set();
  const json = await requestPage(token ? '' : '', token, undefined, 'WEB', client.version, client.key);
  return parsePage(json, limit, seen);
}

// API con callback (compatible con el resto del server).
function search(query, limit = 15, type = 'all', cb) {
  runSearch(query, limit, type)
    .then((r) => cb(null, r.results, r.continuation || null))
    .catch((e) => cb(e));
}

function continueSearch(token, limit = 15, cb) {
  runContinue(token, limit)
    .then((r) => cb(null, r.results, r.continuation || null))
    .catch((e) => cb(e));
}

// Carga los temas de una playlist o álbum de YouTube vía InnerTube browse
async function fetchPlaylist(playlistId) {
  if (!playlistId) throw new Error('Falta playlistId');
  const client = await getClientInfo();
  const rawId = String(playlistId).trim();
  const browseId = rawId.startsWith('VL') ? rawId : (rawId.startsWith('OLAK') ? rawId : 'VL' + rawId);

  const payload = {
    context: {
      client: {
        clientName: 'WEB',
        clientVersion: client.version,
        hl: 'es',
        gl: 'AR',
        userAgent: UA,
      },
    },
    browseId,
  };

  const qs = client.key ? '?key=' + encodeURIComponent(client.key) : '';
  const json = await postJson('www.youtube.com', '/youtubei/v1/browse' + qs, payload);

  const tracks = [];
  const seen = new Set();
  let playlistTitle =
    json?.metadata?.playlistMetadataRenderer?.title ||
    json?.microformat?.microformatDataRenderer?.title ||
    json?.sidebar?.playlistSidebarRenderer?.items?.[0]?.playlistSidebarPrimaryInfoRenderer?.title?.simpleText ||
    '';
  let playlistChannel =
    json?.sidebar?.playlistSidebarRenderer?.items?.[1]?.playlistSidebarSecondaryInfoRenderer?.videoOwner?.videoOwnerRenderer?.title?.runs?.[0]?.text ||
    '';

  function walk(node, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 24) return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n, depth + 1);
      return;
    }

    if (!playlistTitle && node.pageHeaderViewModel?.pageHeaderTitle?.metadata?.title?.content) {
      playlistTitle = node.pageHeaderViewModel.pageHeaderTitle.metadata.title.content;
    }

    // lockupViewModel
    if (node.lockupViewModel) {
      const l = node.lockupViewModel;
      const vid =
        (l.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' || !l.contentType)
          ? (l.contentId || l.itemPlayback?.inlinePlayerData?.onSelect?.innertubeCommand?.watchEndpoint?.videoId || l.onTap?.innertubeCommand?.watchEndpoint?.videoId)
          : '';
      if (vid && /^[\w-]{11}$/.test(vid) && !seen.has(vid)) {
        seen.add(vid);
        const meta = l.metadata?.lockupMetadataViewModel;
        const title = textOf(meta?.title) || '(sin título)';
        const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows || [];
        const partes = [];
        for (const row of rows) {
          for (const part of row?.metadataParts || []) {
            const t = textOf(part?.text);
            if (t) partes.push(t);
          }
        }
        let durationText = '';
        const overlays =
          l.contentImage?.collectionThumbnailViewModel?.primaryThumbnail?.thumbnailViewModel?.overlays ||
          l.contentImage?.thumbnailViewModel?.overlays ||
          [];
        for (const o of overlays) {
          for (const b of o?.thumbnailOverlayBadgeViewModel?.thumbnailBadges || []) {
            const t = String(b?.thumbnailBadgeViewModel?.text || '').trim();
            if (/^\d+(:\d+)+$/.test(t)) durationText = t;
          }
        }
        if (!durationText) {
          durationText = partes.find((p) => /^\d+(:\d+)+$/.test(p)) || '';
        }
        const canal = partes.find((p) => !/^\d+(:\d+)+$/.test(p) && !/visualizaci|views|hace /i.test(p)) || playlistChannel;
        const thumb = firstImageUrl(l.contentImage) || ('https://i.ytimg.com/vi/' + vid + '/mqdefault.jpg');
        tracks.push({
          id: vid,
          title,
          channel: canal,
          duration: parseDuration(durationText),
          durationText,
          thumb,
          url: 'https://www.youtube.com/watch?v=' + vid,
          kind: 'song',
        });
      }
    }

    // playlistVideoRenderer tradicional
    if (node.playlistVideoRenderer) {
      const pvr = node.playlistVideoRenderer;
      const vid = pvr.videoId;
      if (vid && !seen.has(vid)) {
        seen.add(vid);
        const title = textOf(pvr.title) || '(sin título)';
        const canal = textOf(pvr.shortBylineText) || playlistChannel;
        const durationText = textOf(pvr.lengthText) || '';
        const thumb = pvr.thumbnails?.[0]?.thumbnails?.slice(-1)?.[0]?.url || ('https://i.ytimg.com/vi/' + vid + '/mqdefault.jpg');
        tracks.push({
          id: vid,
          title,
          channel: canal,
          duration: parseDuration(durationText),
          durationText,
          thumb,
          url: 'https://www.youtube.com/watch?v=' + vid,
          kind: 'song',
        });
      }
    }

    for (const k of Object.keys(node)) {
      walk(node[k], depth + 1);
    }
  }

  walk(json);
  return {
    id: rawId,
    title: playlistTitle || 'Lista de reproducción',
    channel: playlistChannel,
    tracks,
  };
}

function getPlaylist(playlistId, cb) {
  fetchPlaylist(playlistId)
    .then((r) => cb(null, r))
    .catch((e) => cb(e));
}

module.exports = { search, continueSearch, parseDuration, getPlaylist };
