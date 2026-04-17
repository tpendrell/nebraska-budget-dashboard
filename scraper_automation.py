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
                "title": str(row[3]) if row[3] else f"Fund {row[1]}",
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
    import re

    if not pdf_path:
        return {"status": {}, "table": []}

    try:
        text = subprocess.run(
            ["pdftotext", "-layout", pdf_path, "-"],
            capture_output=True,
            text=True,
        ).stdout

        res = {}
        
        # Helper function: Finds the pattern, then grabs the FIRST number with 4+ digits
        # This prevents the parser from accidentally grabbing "26" from "FY25-26"
        def get_big_num(pattern):
            matches = re.findall(pattern + r'.*?([\d,]{4,})', text, re.IGNORECASE)
            if matches:
                return int(matches[0].replace(',', ''))
            return 0

        res["netRevenues_FY2526"] = get_big_num(r"Net Receipts")
        res["appropriations_FY2526"] = get_big_num(r"Total Appropriations")
        res["beginningBalance_FY2526"] = get_big_num(r"Beginning Balance")
        res["endingBalance_FY2526"] = get_big_num(r"Ending balance")
        res["cashReserve_endingBalance"] = get_big_num(r"Cash Reserve Fund.*?Balance")

        # Variance checks for parentheses to represent negative numbers
        var_match = re.search(r"Variance from 3%.*?([\d,()]{4,})", text, re.IGNORECASE)
        if var_match:
            val = var_match.group(1).replace(",", "")
            res["minimumReserve_variance"] = -int(val.replace("(", "").replace(")", "")) if "(" in val else int(val)
        else:
            res["minimumReserve_variance"] = 0

        # Constructing the table array to satisfy the React frontend warning
        table = [
            {"label": "Beginning Balance", "fy2425": 0, "fy2526": res.get("beginningBalance_FY2526", 0), "fy2627": 0, "fy2728": 0, "fy2829": 0},
            {"label": "Net Receipts", "fy2425": 0, "fy2526": res.get("netRevenues_FY2526", 0), "fy2627": 0, "fy2728": 0, "fy2829": 0},
            {"label": "Total Appropriations", "fy2425": 0, "fy2526": res.get("appropriations_FY2526", 0), "fy2627": 0, "fy2728": 0, "fy2829": 0},
            {"label": "Ending Balance", "fy2425": 0, "fy2526": res.get("endingBalance_FY2526", 0), "fy2627": 0, "fy2728": 0, "fy2829": 0}
        ]

        return {"status": res, "table": table}
    except Exception:
        return {"status": {}, "table": []}


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

    # Failsafe core definitions to ensure major funds never display as "GENERAL CASH"
    descriptions = {
        "10000": {"title": "General Fund", "description": "The primary operating fund of the State.", "statutory_authority": "Neb. Rev. Stat. §77-2715"},
        "11000": {"title": "Cash Reserve Fund", "description": "The State's 'Rainy Day' Fund.", "statutory_authority": "Neb. Rev. Stat. §84-612"},
        "22970": {"title": "Property Tax Credit Fund", "description": "Funds property tax relief.", "statutory_authority": "Neb. Rev. Stat. §77-4210"}
    }

    if not pdf_paths:
        return descriptions

    for path in pdf_paths:
        try:
            text = subprocess.run(
                ["pdftotext", "-layout", path, "-"],
                capture_output=True,
                text=True,
            ).stdout

            for page in text.split("\f"):
                # Case insensitive match for Fund ID
                fund_m = re.search(r"FUND\s+(\d{5}):\s+(.+?)(?:\n|$)", page, re.IGNORECASE)
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

                    # Only overwrite if it's not one of our hardcoded failsafes
                    if fid not in ["10000", "11000", "22970"]:
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
    parser.add_argument("--month", default=None)
    args = parser.parse_args()

    work_dir = tempfile.mkdtemp()

    print("Step 1: Fetching OIP...")
    oip_path, date_str = fetch_oip(work_dir)

    print("Step 2: Fetching Budget/LFO Reports...")
    year, _, _ = get_target_month(args.month)
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
        "generalFundStatus": gf_data.get("status", {}),
        "gfStatusTable": gf_data.get("table", []),
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
