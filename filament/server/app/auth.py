"""Who may call /api: Cloudflare Access (people) or Bearer API_TOKEN (printers, scripts). Fails closed."""
from __future__ import annotations

import hmac

import jwt
from fastapi import HTTPException, Request

from .config import Config

_jwks: dict[str, jwt.PyJWKClient] = {}


def verify_access_jwt(token: str | None, cfg: Config, jwk_client: jwt.PyJWKClient | None = None) -> str | None:
    if not token or not cfg.access_team_domain or not cfg.access_aud:
        return None
    team = cfg.access_team_domain
    client = jwk_client or _jwks.setdefault(team, jwt.PyJWKClient(f"https://{team}/cdn-cgi/access/certs", cache_keys=True, lifespan=3600))
    try:
        key = client.get_signing_key_from_jwt(token)
        claims = jwt.decode(token, key.key, algorithms=["RS256"], audience=cfg.access_aud,
                            issuer=f"https://{team}", options={"require": ["exp", "aud"]})
    except jwt.PyJWKClientConnectionError as e:
        raise HTTPException(503, "Sign-in check is unavailable right now. Try again in a minute.") from e
    except jwt.PyJWTError:
        return None
    return claims.get("email") or claims.get("common_name") or "access"


def require_auth(request: Request) -> str:
    cfg: Config = request.app.state.cfg
    if cfg.dev_open:
        return "dev"
    auth = request.headers.get("authorization", "")
    if auth.startswith("Bearer ") and cfg.api_token and hmac.compare_digest(auth[7:].strip(), cfg.api_token):
        return "token"
    who = verify_access_jwt(request.headers.get("cf-access-jwt-assertion"), cfg)
    if who:
        return who
    raise HTTPException(401, "Sign in through filament.juplifestudio.com, or send a valid API token.")
