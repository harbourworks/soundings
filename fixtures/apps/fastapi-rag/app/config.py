from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    openai_api_key: str
    database_url: str
    jwt_secret: str
    azure_storage_connection_string: str
    environment: str = "development"


settings = Settings()
