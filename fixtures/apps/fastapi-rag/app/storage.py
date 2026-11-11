from azure.storage.blob import BlobServiceClient

from app.config import settings

blob_service = BlobServiceClient.from_connection_string(settings.azure_storage_connection_string)
