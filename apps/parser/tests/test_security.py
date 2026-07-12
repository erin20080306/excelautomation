import pytest
from fastapi import HTTPException

from app.main import require_parser_secret


def test_parser_secret_is_optional_for_local_development(monkeypatch):
    monkeypatch.delenv("PARSER_SHARED_SECRET", raising=False)
    require_parser_secret(None)


def test_parser_secret_rejects_wrong_value(monkeypatch):
    monkeypatch.setenv("PARSER_SHARED_SECRET", "a" * 32)
    with pytest.raises(HTTPException) as error:
        require_parser_secret("b" * 32)
    assert error.value.status_code == 401


def test_parser_secret_accepts_matching_value(monkeypatch):
    monkeypatch.setenv("PARSER_SHARED_SECRET", "a" * 32)
    require_parser_secret("a" * 32)
