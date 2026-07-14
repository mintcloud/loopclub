"""
X (Twitter) client for the @loopclub growth bot.

Single-account bot, so this uses OAuth 1.0a user-context (4 keys from the
X Developer Portal) rather than the OAuth2 PKCE dance in telegram-agent's
twitter-digest — one app, no interactive auth flow, and OAuth1.0a is what
the v1.1 media upload endpoint still requires.

Env vars (see deploy/env.example):
    LOOPCLUB_X_API_KEY
    LOOPCLUB_X_API_SECRET
    LOOPCLUB_X_ACCESS_TOKEN
    LOOPCLUB_X_ACCESS_SECRET
"""

import os
import sys
from pathlib import Path
from typing import Optional

import tweepy
from dotenv import load_dotenv

_ENV_PATH = Path(__file__).parent.parent / "config" / "bot.env"
load_dotenv(_ENV_PATH)
load_dotenv()  # also allow process-level env (systemd EnvironmentFile)


def _creds():
    keys = {
        "consumer_key": os.environ.get("LOOPCLUB_X_API_KEY"),
        "consumer_secret": os.environ.get("LOOPCLUB_X_API_SECRET"),
        "access_token": os.environ.get("LOOPCLUB_X_ACCESS_TOKEN"),
        "access_token_secret": os.environ.get("LOOPCLUB_X_ACCESS_SECRET"),
    }
    missing = [k for k, v in keys.items() if not v]
    if missing:
        raise RuntimeError(
            f"Missing X credentials: {missing}. Set them in x-bot/config/bot.env "
            "(see deploy/env.example) — the bot cannot post without them."
        )
    return keys


def get_v2_client() -> tweepy.Client:
    """v2 client for creating tweets."""
    keys = _creds()
    return tweepy.Client(
        consumer_key=keys["consumer_key"],
        consumer_secret=keys["consumer_secret"],
        access_token=keys["access_token"],
        access_token_secret=keys["access_token_secret"],
    )


def get_v1_api() -> tweepy.API:
    """v1.1 API — needed only for media upload (v2 has no media endpoint yet)."""
    keys = _creds()
    auth = tweepy.OAuth1UserHandler(
        keys["consumer_key"],
        keys["consumer_secret"],
        keys["access_token"],
        keys["access_token_secret"],
    )
    return tweepy.API(auth)


def post(text: str, media_path: Optional[str] = None) -> dict:
    """Post a tweet, optionally with one image/GIF attached. Returns the API response data."""
    media_ids = None
    if media_path:
        api = get_v1_api()
        media = api.media_upload(media_path)
        media_ids = [media.media_id]

    client = get_v2_client()
    resp = client.create_tweet(text=text, media_ids=media_ids)
    return resp.data


def whoami() -> dict:
    client = get_v2_client()
    me = client.get_me()
    return me.data


if __name__ == "__main__":
    # smoke test: verify credentials resolve to an account, post nothing
    try:
        me = whoami()
        print(f"[x_client] authenticated as @{me['username']} (id {me['id']})", file=sys.stderr)
    except Exception as e:
        print(f"[x_client] auth check failed: {e}", file=sys.stderr)
        sys.exit(1)
