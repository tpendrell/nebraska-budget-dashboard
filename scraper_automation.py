```python
#!/usr/bin/env python3
"""
Nebraska Public Budget Dashboard — Automated Data Scraper
==========================================================
"""

import os
import re
import json
import argparse
import tempfile
import datetime
import requests
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36"
)

REVENUE_RELEASE_URL = (
    "https://revenue.nebraska.gov/sites/default/files/doc/news-release/gen-fund/"
    "{year}/General_Fund_Receipts_News_Release_{month_name}_{year}_Final_Copy.pdf"
)

GF_STATUS_URL = "https://nebraskalegislature.gov/FloorDocs/Current/PDF/Budget/status.pdf"
LEG_BUDGET_URL_TEMPLATE = "https://nebraskalegislature.gov/pdf/reports/fiscal/{year}budget.pdf"
LFO_DIRECTORY_VOL1_URL = "https://nebraskalegislature.gov/pdf/reports/fiscal/funddescriptions1_{year}.pdf"
LFO_DIRECTORY_VOL2_URL = "https://nebraskalegislature.gov/pdf/reports/fiscal/funddescriptions2_{year}.pdf"


def download_file(url, dest_path):
    try:
        resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=30)
        if resp.status_code == 200:
            with open(dest_path, "wb") as f:
                f.write(resp.content)
            return True
        return False
    except Exception:
        return False


def get_target_month(month_str=None):
    if month_str:
        dt = datetime.datetime.strptime(month_str, "%Y-%m")
    else:
        today = datetime.datetime.today()
        first_of_month = today.replace(day=1)
        dt = first_of_month - datetime.timedelta(days=1)
    return dt.year, dt.month, dt.strftime("%B")


def get_latest_oip_url():
    now = datetime.datetime.now()
    for i in range(1, 4):
        target_date = now - datetime.timedelta(days=30 * i)
        cal_month = target_date.month
        cal_year = target_date.year
        fiscal_month = cal_month - 6 if cal_month >= 7 else cal_month + 6
        fm_str = f"{fiscal_month:02d}"
        url = (
            "https://das.nebraska.gov/accounting/docs/"
            f"NE_DAS_Accounting-Operating_Investment_Pool_OIP_Report_{cal_year}-{fm_str}.xlsx"
        )
        try:
            head = requests.head(url, headers={"User-Agent": USER_AGENT}, timeout=5)
            if head.status_code == 200:
                return url, target_date.strftime("%m/%d/%Y")
        except Exception:
            continue
    return None, "Unknown"


def fetch_oip(work_dir):
    url, date_str = get_latest_oip_url()
    if not url:
        return None, "Unknown"
    path = os.path.join(work_dir, "oip.xlsx")
    if download_file(url, path):
        return path, date_str
    return None, "Unknown"


def fetch_gf_status(work_dir):
    path = os.path.join(work_dir, "status.pdf")
    return path if download_file(GF_STATUS_URL, path) else None


def fetch_biennial_budget(year, work_dir):
    url = LEG_BUDGET_URL_TEMPLATE.format(year=year)
    path = os.path.join(work_dir, f"budget_{year}.pdf")
    return path if download_file(url, path) else None


def fetch_lfo_directory(year, work_dir):
    paths = []
    for template, name in [(LFO_DIRECTORY_VOL1_URL, "vol1"), (LFO_DIRECTORY_VOL2_URL, "vol2")]:
        url = template.format(year=year)
        path = os.path.join(work_dir, f"lfo_{name}_{year}.pdf")
        if download_file(url, path):
            paths.append(path)
    return paths


def parse_oip_for_dashboard(xlsx_path):
    import openpyxl

    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    ws = wb.active
    funds = []
    total_bal = 0
    active_count = 0
    total_interest = 0

    for row in ws.iter_rows(min_row=8, values_only=True):
        if not row[1] or not isinstance(row[1], (int, float)):
            continue

        bal = row[4] if isinstance(row[4], (int, float)) else 0
        interest = row[6] if isinstance(row[6], (int, float)) else 0

        total_bal += bal
        total_interest += interest

        if bal > 0:
            active_count += 1

        funds.append(
            {
                "id": str(int(row[1])),
                "title": row[3],
                "balance": bal,
                "interest": interest,
            }
        )

    return {
        "macro": {
            "totalBalance": total_bal,
            "totalInterest": total_interest,
            "activeFunds": active_count,
            "effectiveYield": "3.08%",
        },
        "funds": funds,
    }


def parse_gf_status_pdf(pdf_path):
    import subprocess

    if not pdf_path:
        return {}

    try:
        text = subprocess.run(
            ["pdftotext", "-layout", pdf_path, "-"],
            capture_output=True,
            text=True,
        ).stdout

        res = {}
        patterns = {
            "netRevenues_FY2526": r"Net Receipts.*?([\d,]+)",
            "appropriations_FY2526": r"Total Appropriations.*?([\d,]+)",
            "beginningBalance_FY2526": r"Beginning Balance.*?([\d,]+)",
            "endingBalance_FY2526": r"Ending Balance.*?\$?\s*([\d,]+)",
            "minimumReserve_variance": r"Variance from 3% Reserve.*?\(([\d,]+)\)",
            "cashReserve_endingBalance": r"Cash Reserve Fund Ending Balance.*?([\d,]+)",
        }

        for key, pattern in patterns.items():
            match = re.search(pattern, text, re.I)
            if match:
                val = int(match.group(1).replace(",", ""))
                if "(" in match.group(0):
                    val = -val
                res[key] = val

        return res
    except Exception:
        return {}


def parse_biennial_budget_agencies(pdf_path):
    import subprocess

    if not pdf_path:
        return []

    try:
        text = subprocess.run(
            ["pdftotext", "-layout", pdf_path, "-"],
            capture_output=True,
            text=True,
        ).stdout

        agencies = []
        pattern = re.compile(
            r"^\s*#(\d{2,3})\s+([A-Za-z\s&,./\-]+?)\s+(?:Oper|Aid|Const|Total)\s+([\d,()]+)",
            re.M,
        )

        for match in pattern.finditer(text):
            val = int(match.group(3).replace(",", "").replace("(", "-").replace(")", ""))
            agencies.append(
                {
                    "id": match.group(1),
                    "name": match.group(2).strip(),
                    "appropriation": val,
                }
            )

        return agencies
    except Exception:
        return []


def parse_lfo_directory(pdf_paths):
    import subprocess

    if not pdf_paths:
        return {}

    descriptions = {}

    for path in pdf_paths:
        try:
            text = subprocess.run(
                ["pdftotext", "-layout", path, "-"],
                capture_output=True,
                text=True,
            ).stdout

            for page in text.split("\f"):
                fund_m = re.search(r"FUND\s+(\d{5}):\s+(.+?)(?:\n|$)", page)
                if fund_m:
                    fid = fund_m.group(1)
                    desc_m = re.search(
                        r"PERMITTED USES:\s*(.+?)(?=\n\s*FUND SUMMARY|\Z)",
                        page,
                        re.S,
                    )
                    stat_m = re.search(
                        r"STATUTORY AUTHORITY:\s*(.+?)(?=\n\s*REVENUE|\Z)",
                        page,
                        re.S,
                    )

                    descriptions[fid] = {
                        "title": fund_m.group(2).strip(),
                        "description": re.sub(r"\s+", " ", desc_m.group(1)).strip() if desc_m else "",
                        "statutory_authority": re.sub(r"\s+", " ", stat_m.group(1)).strip() if stat_m else "",
                    }
        except Exception:
            continue

    return descriptions


def push_to_sheet(data, sheet_id, sheet_name="Sheet1", credentials_path="credentials.json"):
    output_path = "dashboard_data.json"

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False, default=str)

    creds = service_account.Credentials.from_service_account_file(
        credentials_path,
        scopes=["https://www.googleapis.com/auth/spreadsheets"],
    )

    try:
        service = build("sheets", "v4", credentials=creds, cache_discovery=False)

        json_str = json.dumps(
            data,
            separators=(",", ":"),
            ensure_ascii=False,
            default=str,
        )

        chunk_size = 40000
        chunks = [json_str[i:i + chunk_size] for i in range(0, len(json_str), chunk_size)]
        if not chunks:
            chunks = ["{}"]

        service.spreadsheets().values().clear(
            spreadsheetId=sheet_id,
            range=f"{sheet_name}!A:A",
        ).execute()

        service.spreadsheets().values().update(
            spreadsheetId=sheet_id,
            range=f"{sheet_name}!A1",
            valueInputOption="RAW",
            body={"values": [[chunk] for chunk in chunks]},
        ).execute()

        return output_path

    except FileNotFoundError:
        raise FileNotFoundError(f"Credentials file not found: {credentials_path}")
    except HttpError as e:
        raise RuntimeError(f"Google Sheets API error: {e}") from e
    except Exception as e:
        raise RuntimeError(f"Unexpected error pushing to Google Sheets: {e}") from e


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sheet-id", required=True)
    parser.add_argument("--sheet-name", default="Sheet1")
    parser.add_argument("--credentials-path", default="credentials.json")
    args = parser.parse_args()

    work_dir = tempfile.mkdtemp()

    print("Step 1: Fetching OIP...")
    oip_path, date_str = fetch_oip(work_dir)

    print("Step 2: Fetching Budget/LFO Reports...")
    year, _, _ = get_target_month()
    budget_year = year if year % 2 != 0 else year - 1

    status_path = fetch_gf_status(work_dir)
    budget_path = fetch_biennial_budget(budget_year, work_dir)
    lfo_paths = fetch_lfo_directory(budget_year, work_dir)

    print("Step 3: Parsing Data...")
    oip_data = parse_oip_for_dashboard(oip_path) if oip_path else {"funds": [], "macro": {}}
    gf_data = parse_gf_status_pdf(status_path)
    agency_data = parse_biennial_budget_agencies(budget_path)
    lfo_data = parse_lfo_directory(lfo_paths)

    dashboard = {
        "lastUpdated": {
            "cash": date_str,
            "budget": "March 2026",
        },
        "macro": oip_data["macro"],
        "funds": oip_data["funds"],
        "generalFundStatus": gf_data,
        "agencies": agency_data,
        "fundDescriptions": lfo_data,
    }

    print("Step 4: Uploading...")
    push_to_sheet(
        dashboard,
        args.sheet_id,
        sheet_name=args.sheet_name,
        credentials_path=args.credentials_path,
    )
    print(f"✅ Scrape Complete. Data Period: {date_str}")


if __name__ == "__main__":
    main()
```

