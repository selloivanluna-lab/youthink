import sys
import json
import subprocess

def find_video_id(yt, seed):
    seed = (seed or "").strip()
    if not seed:
        return None
    # Si ya parece un videoId de YouTube (11 chars base64url), usarlo directo.
    import re
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", seed):
        return seed
    try:
        res = yt.search(seed, filter="songs", limit=1)
        if not res:
            res = yt.search(seed, limit=1)
        if res:
            return res[0].get("videoId")
    except Exception:
        pass
    return None

def main():
    seed = sys.argv[1] if len(sys.argv) > 1 else ""
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 25
    try:
        from ytmusicapi import YTMusic
    except Exception as e:
        print(json.dumps({"ok": False, "error": "ytmusicapi no instalado: %s" % e}))
        return
    try:
        yt = YTMusic()
        vid = find_video_id(yt, seed)
        if not vid:
            print(json.dumps({"ok": False, "error": "seed sin resultados"}))
            return
        wp = yt.get_watch_playlist(videoId=vid, limit=limit)
        tracks = []
        for t in (wp.get("tracks") or []):
            if not t.get("videoId"):
                continue
            sec = t.get("length_seconds") or t.get("duration_seconds") or 0
            if not sec:
                raw_len = t.get("length") or t.get("duration") or ""
                if raw_len:
                    try:
                        parts = [int(p) for p in str(raw_len).split(":")]
                        if len(parts) == 1:
                            sec = parts[0]
                        elif len(parts) == 2:
                            sec = parts[0] * 60 + parts[1]
                        elif len(parts) == 3:
                            sec = parts[0] * 3600 + parts[1] * 60 + parts[2]
                    except Exception:
                        sec = 0
            tracks.append({
                "id": t.get("videoId"),
                "title": t.get("title") or "(sin título)",
                "channel": (t.get("artists") or [{}])[0].get("name", "") if t.get("artists") else "",
                "duration": int(sec) if sec else 0,
                "thumb": ((t.get("thumbnail") or [{}]) or [{}])[-1].get("url", ""),
                "url": "https://www.youtube.com/watch?v=" + t.get("videoId"),
            })
        out = {"ok": True, "seed": vid, "tracks": tracks}
        print(json.dumps(out, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))

if __name__ == "__main__":
    main()
