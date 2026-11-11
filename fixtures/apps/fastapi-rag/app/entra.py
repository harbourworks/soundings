import msal

from app.config import settings


def build_app(client_id: str, authority: str):
    return msal.ConfidentialClientApplication(client_id, authority=authority, client_credential=settings.jwt_secret)
