"""
Post the next queued item from content/queue.json to @loopclub on X.

Skips items whose media.type == "manual" (need a human or unbuilt
automation to supply real data/media first) unless --allow-text-only is
passed, in which case it posts the text without the image.

Usage:
    python3 post_next.py            # post next postable item
    python3 post_next.py --dry-run  # print what would be posted, don't post
    python3 post_next.py --allow-text-only   # also post "manual" items as text-only
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import x_client  # noqa: E402

QUEUE_PATH = Path(__file__).parent.parent / "content" / "queue.json"


def load_queue():
    return json.loads(QUEUE_PATH.read_text())


def save_queue(queue):
    QUEUE_PATH.write_text(json.dumps(queue, indent=2) + "\n")


def find_next(queue, allow_text_only: bool):
    for post in queue["posts"]:
        if post["status"] != "queued":
            continue
        media = post.get("media")
        if media and media.get("type") == "manual" and not allow_text_only:
            continue
        return post
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--allow-text-only", action="store_true")
    args = ap.parse_args()

    queue = load_queue()
    post = find_next(queue, args.allow_text_only)

    if not post:
        print("[post_next] no postable item queued (remaining items are all 'manual' — "
              "run with --allow-text-only to post them as text, or fill in real data first)",
              file=sys.stderr)
        sys.exit(0)

    text = post["text"]
    media_path = None
    media = post.get("media")
    if media and media.get("type") == "grid_image":
        media_path = str(Path(__file__).parent.parent / media["path"])
        if not Path(media_path).exists():
            print(f"[post_next] media file missing: {media_path}", file=sys.stderr)
            media_path = None

    print(f"[post_next] day {post['day']} — {post['angle']}", file=sys.stderr)
    print(text, file=sys.stderr)
    if media_path:
        print(f"[post_next] media: {media_path}", file=sys.stderr)

    if args.dry_run:
        print("[post_next] --dry-run, not posting", file=sys.stderr)
        return

    result = x_client.post(text, media_path=media_path)
    post["status"] = "posted"
    post["posted_id"] = result.get("id")
    post["posted_at"] = datetime.now(timezone.utc).isoformat()
    save_queue(queue)
    print(f"[post_next] posted: https://x.com/loopclub/status/{result.get('id')}", file=sys.stderr)


if __name__ == "__main__":
    main()
