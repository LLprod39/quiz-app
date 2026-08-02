from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite:///./celebration_quiz.db"
    secret_key: str = "local-development-key-change-me"
    organizer_email: str = "organizer@example.local"
    organizer_password: str = "celebrate"
    deployment_mode: str = "lan"
    public_base_url: str = "http://localhost:5173"
    media_dir: str = "./media"
    cors_origins: str = "http://localhost:5173,http://localhost"
    max_upload_mb: int = 25
    azure_speech_key: str = ""
    azure_speech_region: str = ""
    azure_speech_voice: str = "ru-RU-SvetlanaNeural"
    azure_speech_timeout_seconds: float = 8.0
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def media_path(self) -> Path:
        path = Path(self.media_dir).resolve()
        path.mkdir(parents=True, exist_ok=True)
        return path


settings = Settings()
