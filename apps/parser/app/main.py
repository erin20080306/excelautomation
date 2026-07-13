from __future__ import annotations

import json
import os
import secrets
import shutil
import tempfile
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from pydantic import BaseModel, Field

from .analyzer import analyze_file
from .exporter import create_export

app = FastAPI(title="ExcelMaster Parser", version="1.1.0", docs_url="/docs" if os.getenv("NODE_ENV") != "production" else None)
MAX_BYTES = int(os.getenv("MAX_FILE_SIZE_MB", "50")) * 1024 * 1024


class ExportRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    config: dict = Field(default_factory=dict)
    analyses: list[dict]
    dataSets: list[dict] | None = None


def require_parser_secret(x_excelmaster_parser_secret: str | None = Header(default=None)) -> None:
    configured = os.getenv("PARSER_SHARED_SECRET")
    if configured and (not x_excelmaster_parser_secret or not secrets.compare_digest(configured, x_excelmaster_parser_secret)):
        raise HTTPException(401, "Parser 驗證失敗")


@app.get("/health")
def health() -> dict[str, str | list[str]]:
    return {
        "status": "ok",
        "version": app.version,
        "features": ["smart_headers", "professional_xlsx", "image_analysis"],
    }


@app.post("/analyze", dependencies=[Depends(require_parser_secret)])
async def analyze(file: UploadFile = File(...), original_name: str = Form(...)) -> dict:
    suffix = Path(original_name).suffix.lower()
    if suffix not in {".xlsx", ".xlsm", ".xls", ".csv", ".tsv"}:
        raise HTTPException(415, "不支援的試算表格式")
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as target:
        temp_path = target.name
        size = 0
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_BYTES:
                Path(temp_path).unlink(missing_ok=True)
                raise HTTPException(413, "檔案大小超過限制")
            target.write(chunk)
    try:
        return analyze_file(temp_path, original_name)
    except Exception as error:
        raise HTTPException(422, f"Excel 解析失敗：{error}") from error
    finally:
        Path(temp_path).unlink(missing_ok=True)


@app.post("/export", dependencies=[Depends(require_parser_secret)])
def export_workbook(payload: ExportRequest):
    temp_dir = tempfile.mkdtemp(prefix="excelmaster-export-")
    file_name = Path(payload.name).stem[:100] + ".xlsx"
    output_path = str(Path(temp_dir) / file_name)
    try:
        create_export(payload.model_dump(), output_path)
        return FileResponse(output_path, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", filename=file_name, background=BackgroundTask(shutil.rmtree, temp_dir, ignore_errors=True))
    except Exception as error:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise HTTPException(422, f"Excel 匯出失敗：{error}") from error
