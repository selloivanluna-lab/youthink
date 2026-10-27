import sys
import json

def main():
    query = sys.argv[1] if len(sys.argv) > 1 else ""
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 15
    if not query.strip():
        print(json.dumps({"ok": True, "results": []}))
        return
    try:
        from ytmusicapi import YTMusic
    except Exception as e:
        print(json.dumps({"ok": False, "error": "ytmusicapi no disponible: %s" % e}))
        return

    try:
        yt = YTMusic()
        items = yt.search(query, limit=limit)
        results = []
        for it in (items or []):
            vid = it.get("videoId")
            if not vid:
                continue
            title = it.get("title") or "(sin título)"
            artists = it.get("artists") or []
            channel = artists[0].get("name", "") if artists else (it.get("author") or "")
            thumbs = it.get("thumbnails") or []
            thumb = thumbs[-1].get("url", "") if thumbs else ("https://i.ytimg.com/vi/" + vid + "/mqdefault.jpg")
            duration = it.get("duration_seconds") or 0
            results.append({
                "id": vid,
                "title": title,
                "channel": channel,
                "duration": duration,
                "thumb": thumb,
                "url": "https://www.youtube.com/watch?v=" + vid,
            })
        print(json.dumps({"ok": True, "results": results}, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))

if __name__ == "__main__":
    main()
