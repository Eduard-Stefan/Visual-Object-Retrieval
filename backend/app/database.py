"""SQLite storage, foreign keys, and short-lived transaction sessions."""

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .core.config import Settings


class Base(DeclarativeBase):
    pass


class Database:
    def __init__(self, settings: Settings):
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        settings.images_dir.mkdir(parents=True, exist_ok=True)
        settings.thumbnails_dir.mkdir(parents=True, exist_ok=True)
        self.engine = create_engine(
            settings.sqlite_url,
            connect_args={"check_same_thread": False, "timeout": 30},
        )

        @event.listens_for(self.engine, "connect")
        def configure_sqlite(connection, _record):
            cursor = connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA synchronous=NORMAL")
            cursor.close()

        self.session = sessionmaker(self.engine, expire_on_commit=False)

    def initialize(self) -> None:
        from . import models as models  # Register all tables before creating the schema.

        Base.metadata.create_all(self.engine)
