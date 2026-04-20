import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext

# Configuration from environment variables
AUTH_USERNAME = os.environ.get("AUTH_USERNAME", "admin")
AUTH_PASSWORD_HASH = os.environ.get("AUTH_PASSWORD_HASH", None)
AUTH_SECRET_KEY = os.environ.get("AUTH_SECRET_KEY", "change-me-in-production")
AUTH_TOKEN_EXPIRE_HOURS = int(os.environ.get("AUTH_TOKEN_EXPIRE_HOURS", "8"))
ALGORITHM = "HS256"

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# On startup, if no password hash is set, use a default and warn
if not AUTH_PASSWORD_HASH:
    AUTH_PASSWORD_HASH = pwd_context.hash("changeme")
    print("\n" + "=" * 70)
    print("WARNING: Using default password 'changeme' for user 'admin'")
    print("Set AUTH_PASSWORD_HASH or AUTH_PASSWORD env var in production!")
    print("=" * 70 + "\n")

# Bearer token security scheme (for Authorization header)
security = HTTPBearer()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(hours=AUTH_TOKEN_EXPIRE_HOURS)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, AUTH_SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    bearer: Optional[HTTPAuthorizationCredentials] = Depends(security),
    token_query: Optional[str] = Query(None, alias="token"),
) -> str:
    """
    Validate JWT token from either:
    - Authorization: Bearer <token> header
    - ?token=<token> query parameter

    Returns the username on success, raises HTTPException on failure.
    """
    token = None
    if bearer:
        token = bearer.credentials
    elif token_query:
        token = token_query
    else:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        payload = jwt.decode(token, AUTH_SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token",
                headers={"WWW-Authenticate": "Bearer"},
            )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return username
