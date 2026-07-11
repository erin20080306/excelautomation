from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter


INVALID_SHEET_CHARS = re.compile(r"[\\/*?:\[\]]")
FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def safe_sheet_name(name: str, used: set[str]) -> str:
    base = INVALID_SHEET_CHARS.sub("_", name).strip("'")[:31] or "資料"
    candidate, number = base, 2
    while candidate in used:
        suffix = f"_{number}"
        candidate = f"{base[:31-len(suffix)]}{suffix}"
        number += 1
    used.add(candidate)
    return candidate


def safe_value(value: Any) -> Any:
    if isinstance(value, str):
        if value.startswith(FORMULA_PREFIXES):
            return "'" + value
        try:
            if re.fullmatch(r"\d{4}-\d{2}-\d{2}(T.*)?", value):
                return datetime.fromisoformat(value)
        except ValueError:
            pass
    return value


def write_table(ws, headers: list[str], rows: list[dict[str, Any]]) -> None:
    ws.append(headers)
    for row in rows:
        ws.append([safe_value(row.get(header)) for header in headers])
    header_fill = PatternFill("solid", fgColor="0F766E")
    header_font = Font(color="FFFFFF", bold=True)
    thin = Side(style="thin", color="D7E3E1")
    for cell in ws[1]:
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = Border(bottom=thin)
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    for column, header in enumerate(headers, 1):
        values = [str(row.get(header, "")) for row in rows[:200]]
        ws.column_dimensions[get_column_letter(column)].width = min(36, max(10, len(header) + 2, *(len(value) + 2 for value in values)))
        if ws.max_row >= 2:
            for cell in ws.iter_cols(min_col=column, max_col=column, min_row=2):
                item = cell[0]
                if isinstance(item.value, datetime):
                    item.number_format = "yyyy-mm-dd"
                elif isinstance(item.value, (int, float)):
                    item.number_format = "#,##0.00"


def create_export(payload: dict[str, Any], output_path: str) -> None:
    wb = Workbook()
    wb.remove(wb.active)
    used: set[str] = set()
    config = payload.get("config", {})
    analyses = payload.get("analyses", [])

    if config.get("includeOverview", True):
        ws = wb.create_sheet(safe_sheet_name("01_檔案總覽", used))
        headers = ["來源檔案", "工作表數", "報表類型", "信心度", "資料筆數", "需確認"]
        rows = []
        for analysis in analyses:
            rows.append({
                "來源檔案": analysis["fileName"], "工作表數": analysis["workbook"]["sheetCount"],
                "報表類型": analysis["classification"]["type"], "信心度": analysis["classification"]["confidence"],
                "資料筆數": sum(sheet["dataRowCount"] for sheet in analysis["workbook"]["sheets"]),
                "需確認": "是" if analysis["requiresReview"] else "否",
            })
        write_table(ws, headers, rows)
        for cell in ws["D"][1:]:
            cell.number_format = "0.0%"

    if config.get("includeMappings", True):
        ws = wb.create_sheet(safe_sheet_name("02_欄位對應", used))
        headers = ["來源檔案", "工作表", "來源欄位", "標準欄位", "資料型態", "信心度", "判斷依據"]
        rows = []
        for analysis in analyses:
            for sheet in analysis["workbook"]["sheets"]:
                for field in sheet["fields"]:
                    rows.append({"來源檔案": analysis["fileName"], "工作表": sheet["name"], "來源欄位": field["sourceName"], "標準欄位": field.get("targetKey") or "未對應", "資料型態": field["dataType"], "信心度": field["confidence"], "判斷依據": "、".join(field["evidence"])})
        write_table(ws, headers, rows)
        for cell in ws["F"][1:]:
            cell.number_format = "0.0%"

    if config.get("includeExceptions", True):
        ws = wb.create_sheet(safe_sheet_name("03_異常資料", used))
        headers = ["來源檔案", "類型", "說明", "位置"]
        rows = []
        for analysis in analyses:
            rows.extend({"來源檔案": analysis["fileName"], "類型": "warning", "說明": warning, "位置": ""} for warning in analysis.get("warnings", []))
            for sheet in analysis["workbook"]["sheets"]:
                rows.extend({"來源檔案": analysis["fileName"], "類型": row["type"], "說明": "已排除非明細列", "位置": f"{sheet['name']}!{row['row']}"} for row in sheet.get("excludedRows", []))
        write_table(ws, headers, rows)

    grouped: dict[str, list[dict[str, Any]]] = {}
    output_sets: list[dict[str, Any]] = []
    data_sets = payload.get("dataSets") or []
    if data_sets:
        for data_set in data_sets:
            rows = data_set.get("rows", [])
            headers = list(dict.fromkeys(key for row in rows for key in row.keys()))
            write_table(wb.create_sheet(safe_sheet_name(data_set.get("name", "整合資料"), used)), headers, rows)
            output_sets.append({"name": data_set.get("name", "整合資料"), "rows": rows})
    elif config.get("mergeByType", True):
        for analysis in analyses:
            grouped.setdefault(analysis["classification"]["type"], []).extend(row for sheet in analysis["workbook"]["sheets"] for row in sheet["normalizedRows"])
        for report_type, rows in grouped.items():
            headers = list(dict.fromkeys(key for row in rows for key in row.keys()))
            write_table(wb.create_sheet(safe_sheet_name(f"{report_type}_總表", used)), headers, rows)
            output_sets.append({"name": f"{report_type}_總表", "rows": rows})

    if config.get("separateSourceSheets", True) or (not data_sets and not config.get("mergeByType", True)):
        for analysis in analyses:
            for sheet in analysis["workbook"]["sheets"]:
                rows = sheet["normalizedRows"]
                headers = list(dict.fromkeys(key for row in rows for key in row.keys()))
                write_table(wb.create_sheet(safe_sheet_name(f"{Path(analysis['fileName']).stem}_{sheet['name']}", used)), headers, rows)

    if config.get("preserveRaw", False):
        for analysis in analyses:
            for sheet in analysis["workbook"]["sheets"]:
                rows = sheet.get("rawRows", [])
                headers = list(dict.fromkeys(key for row in rows for key in row.keys()))
                write_table(wb.create_sheet(safe_sheet_name(f"原始_{Path(analysis['fileName']).stem}_{sheet['name']}", used)), headers, rows)

    split_by = config.get("splitBy")
    if split_by:
        split_sources = grouped.items() if grouped else ((data_set["name"], data_set["rows"]) for data_set in output_sets)
        for report_type, rows in split_sources:
            groups: dict[str, list[dict[str, Any]]] = {}
            for row in rows:
                groups.setdefault(str(row.get(split_by, "未分類")), []).append(row)
            for key, split_rows in groups.items():
                headers = list(dict.fromkeys(field for row in split_rows for field in row.keys()))
                write_table(wb.create_sheet(safe_sheet_name(f"{report_type}_{key}", used)), headers, split_rows)

    if config.get("includeStatistics", False):
        ws = wb.create_sheet(safe_sheet_name("統計報表", used))
        stats = []
        for data_set in output_sets:
            rows = data_set["rows"]
            fields = list(dict.fromkeys(key for row in rows for key in row.keys()))
            numeric_cells = sum(isinstance(value, (int, float)) and not isinstance(value, bool) for row in rows for value in row.values())
            stats.append({"資料集": data_set["name"], "資料筆數": len(rows), "欄位數": len(fields), "數值儲存格": numeric_cells})
        write_table(ws, ["資料集", "資料筆數", "欄位數", "數值儲存格"], stats)

    if config.get("includeAudit", True):
        ws = wb.create_sheet(safe_sheet_name("處理紀錄", used))
        headers = ["時間", "來源檔案", "清洗儲存格", "原始值", "標準值", "規則", "人工修改"]
        rows = []
        now = datetime.now()
        for analysis in analyses:
            for sheet in analysis["workbook"]["sheets"]:
                rows.extend({"時間": now, "來源檔案": analysis["fileName"], "清洗儲存格": change["cell"], "原始值": change["raw"], "標準值": change["standard"], "規則": change["rule"], "人工修改": "是" if change["humanModified"] else "否"} for change in sheet.get("changes", []))
        write_table(ws, headers, rows)

    if not wb.worksheets:
        wb.create_sheet("整合結果")
    wb.save(output_path)
