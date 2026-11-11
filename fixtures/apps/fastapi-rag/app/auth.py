import jwt
from fastapi.security import OAuth2PasswordBearer

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")


def decode(token: str, secret: str):
    return jwt.decode(token, secret, algorithms=["HS256"])
