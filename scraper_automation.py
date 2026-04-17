#!/usr/bin/env python3
"""
Nebraska Public Budget Dashboard — Automated Data Scraper
==========================================================

CHANGELOG — Final Fix
---------------------
Root cause of production bugs (min reserve variance showing +$6.3M instead of
-$125.6M, GF ending balance showing $829.5M instead of $375.3M):

    The old parse_gf_status_pdf() matched rows labeled "Beginning Balance" and
    "Ending Balance" — but those labels appear in BOTH the General Fund
    Financial Status table (page 4) AND the Cash Reserve Fund Table 1 (page 5).
    The regex grabbed whichever matched last, which was the CRF table.

    The GF Status table actually uses these distinctive labels:
      - "Unobligated Beginning Balance"         (not just "Beginning Balance")
      - "General Fund Net Revenues"             (subtotal row)
      - "General Fund Appropriations"           (post-adjustment subtotal)
      - "Ending balance (per Financial Status)" (note: lowercase 'b')
      - "Excess (shortfall) from Minimum Reserve"
    The old parser never matched any of these exactly, so it silently fell
    back to the CRF rows.

This version:
    1. parse_gf_status_pdf() uses distinctive row labels that only exist in
       the GF Financial Status table. Isolates the section between the GF
       Status header and the Cash Reserve Fund header. Fails loud via sanity
       checks if output still looks like CRF data.
    2. parse_revenue_pdf() parses NEFAB Table 3 from the biennial budget PDF
       directly. Removes the pro-rata fallback that fabricated fake identical
       forecasts across categories.
    3. parse_biennial_budget_agencies() anchors to Table 12 "Total" rows to
       avoid mixing Enacted and Committee Rec columns.
"""

import os
import re
import json
import argparse
import tempfile
import datetime
import subprocess
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


# ---------------------------------------------------------------------------
# Fetch helpers (unchanged from original — these work correctly)
# ---------------------------------------------------------------------------

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


def fetch_lfo_directory(work_dir):
    paths = []
    for year in [2023, 2025]:
        for vol in ["1", "2"]:
            url = f"https://nebraskalegislature.gov/pdf/reports/fiscal/funddescriptions{vol}_{year}.pdf"
            path = os.path.join(work_dir, f"lfo_{vol}_{year}.pdf")
            if download_file(url, path):
                paths.append(path)
    return paths


def fetch_revenue_release(work_dir):
    now = datetime.datetime.now()
    for i in range(1, 4):
        target = now - datetime.timedelta(days=30 * i)
        month_name = target.strftime("%B")
        year = target.year
        url = REVENUE_RELEASE_URL.format(year=year, month_name=month_name)
        path = os.path.join(work_dir, f"revenue_{year}_{month_name}.pdf")
        if download_file(url, path):
            return path, f"{month_name} {year}"
    return None, "Unknown"


# ---------------------------------------------------------------------------
# OIP parser
# ---------------------------------------------------------------------------

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

        fid = str(int(row[1]))
        title = str(row[3]).strip() if row[3] else f"Fund {fid}"

        if fid == "10000":
            title = "General Fund"
        elif fid == "11000":
            title = "Cash Reserve Fund"

        funds.append({
            "id": fid,
            "title": title,
            "balance": bal,
            "interest": interest,
        })

    # Compute effective yield from the data rather than hardcoding.
    # totalInterest in OIP is typically a single-month figure; annualize ×12.
    yield_pct = "0.00%"
    if total_bal > 0 and total_interest != 0:
        annualized = abs(total_interest) * 12
        yield_pct = f"{annualized / total_bal * 100:.2f}%"

    return {
        "macro": {
            "totalBalance": total_bal,
            "totalInterest": total_interest,
            "activeFunds": active_count,
            "effectiveYield": yield_pct,
        },
        "funds": funds,
    }


# ---------------------------------------------------------------------------
# Shared PDF helpers
# ---------------------------------------------------------------------------

def _pdf_to_text(pdf_path):
    """Run pdftotext -layout; return stdout or '' on failure."""
    try:
        return subprocess.run(
            ["pdftotext", "-layout", pdf_path, "-"],
            capture_output=True,
            text=True,
            timeout=60,
        ).stdout
    except Exception as e:
        print(f"pdftotext failed on {pdf_path}: {e}")
        return ""


def _extract_numbers(line):
    """Extract integers; parenthesized values become negative."""
    matches = re.findall(r'\(([\d,]{4,})\)|(-?[\d,]{4,})', line)
    out = []
    for neg, pos in matches:
        if neg:
            out.append(-int(neg.replace(",", "")))
        elif pos:
            out.append(int(pos.replace(",", "")))
    return out


# ---------------------------------------------------------------------------
# GF Financial Status parser — REWRITTEN
# ---------------------------------------------------------------------------

def _isolate_gf_status_section(full_text):
    """
    Return the portion of the PDF text between the GF Status section header
    and the Cash Reserve Fund section header. This is the critical step that
    prevents the parser from mistakenly reading CRF rows.
    """
    start_idx = 0
    for m in re.finditer(r"General Fund Financial Status", full_text):
        # Require the match to be followed by actual table content, not a TOC entry
        window = full_text[m.start():m.start() + 800]
        if re.search(r"BEGINNING BALANCE|Appropriations Committee Recommendation", window):
            start_idx = m.start()
            break

    section = full_text[start_idx:]
    crf_match = re.search(r"\n\s*Cash Reserve Fund\s*\n", section)
    if crf_match:
        section = section[:crf_match.start()]

    return section


def parse_gf_status_pdf(pdf_paths):
    """
    Parse the General Fund Financial Status 5-year table.

    Accepts a list of candidate PDFs. Tries each in order and returns the
    first one that passes sanity checks. In practice we pass
    [status.pdf, biennial_budget.pdf] — the standalone status.pdf if
    available, falling back to the full biennial budget PDF which contains
    the same table on page 4.
    """
    if isinstance(pdf_paths, str):
        pdf_paths = [pdf_paths]
    pdf_paths = [p for p in pdf_paths if p]

    empty = {"status": {}, "table": []}
    if not pdf_paths:
        return empty

    # These patterns ONLY match rows in the GF Financial Status table.
    # None of them matches anything in the Cash Reserve Fund table.
    row_patterns = {
        "UnobligatedBeg":   r"Unobligated\s+Beginning\s+Balance",
        "NetRevenues":      r"General\s+Fund\s+Net\s+Revenues",
        "Appropriations":   r"General\s+Fund\s+Appropriations(?!\s+by|\s+Adjustment)",
        "EndingBalance":    r"Ending\s+balance\s*\(per\s+Financial\s+Status\)",
        "ReserveVariance":  r"Excess\s*\(shortfall\)\s*from\s+Minimum\s+Reserve",
    }

    def empty_row():
        return {"fy2425": 0, "fy2526": 0, "fy2627": 0, "fy2728": 0, "fy2829": 0}

    for pdf_path in pdf_paths:
        text = _pdf_to_text(pdf_path)
        if not text:
            continue

        section = _isolate_gf_status_section(text)
        if not section.strip():
            continue

        td = {k: empty_row() for k in row_patterns}
        found_anything = False

        for line in section.split("\n"):
            clean = line.strip()
            if not clean:
                continue
            for key, pattern in row_patterns.items():
                if re.search(pattern, clean, re.IGNORECASE):
                    nums = _extract_numbers(clean)
                    if not nums:
                        continue

                    # Reserve Variance row is special: the PDF shows dashes
                    # ("--") for FY24-25, FY25-26, and FY27-28 because the
                    # variance is only calculated at the end of each biennium.
                    # Two numbers on this row correspond to FY26-27 and FY28-29.
                    if key == "ReserveVariance":
                        row = {"fy2425": 0, "fy2526": 0, "fy2627": 0, "fy2728": 0, "fy2829": 0}
                        if len(nums) >= 2:
                            row["fy2627"] = nums[-2]
                            row["fy2829"] = nums[-1]
                        elif len(nums) == 1:
                            row["fy2627"] = nums[0]
                        td[key] = row
                        found_anything = True
                        break

                    if len(nums) < 2:
                        continue
                    # Other rows have all 5 fiscal-year columns populated.
                    # Take last 5 numbers; leading numbers like row indices
                    # get discarded.
                    fy_nums = nums[-5:]
                    while len(fy_nums) < 5:
                        fy_nums = [0] + fy_nums
                    td[key] = dict(zip(
                        ["fy2425", "fy2526", "fy2627", "fy2728", "fy2829"],
                        fy_nums,
                    ))
                    found_anything = True
                    break

        if not found_anything:
            continue

        # Build the 4-row table the dashboard expects
        table = [
            {"label": "Beginning Balance", **td["UnobligatedBeg"]},
            {"label": "Net Receipts", **td["NetRevenues"]},
            {"label": "Total Appropriations", **td["Appropriations"]},
            {"label": "Ending Balance", **td["EndingBalance"]},
        ]

        # Variance is reported in FY26/27 (biennial) and FY28/29 (following biennium)
        variance_fy2627 = td["ReserveVariance"]["fy2627"]
        variance_fy2829 = td["ReserveVariance"]["fy2829"]

        status = {
            "beginningBalance_FY2526": td["UnobligatedBeg"]["fy2526"],
            "netRevenues_FY2526": td["NetRevenues"]["fy2526"],
            "appropriations_FY2526": td["Appropriations"]["fy2526"],
            "endingBalance_FY2526": td["EndingBalance"]["fy2526"],
            "minimumReserve_variance": variance_fy2627,
            "minimumReserve_variance_FY2829": variance_fy2829,
        }

        # SANITY CHECKS — fail loud if output looks like Cash Reserve data
        warnings = []

        # Known CRF values to reject against
        if abs(status["beginningBalance_FY2526"] - 877_079_779) < 100_000:
            warnings.append(
                "beginningBalance_FY2526 matches Cash Reserve FY24-25 ending "
                "— parser is reading the wrong table"
            )
        if abs(status["endingBalance_FY2526"] - 828_032_779) < 2_000_000:
            warnings.append(
                "endingBalance_FY2526 matches Cash Reserve FY25-26 ending "
                "— parser is reading the wrong table"
            )
        if variance_fy2627 > 0:
            warnings.append(
                f"minimumReserve_variance is positive ({variance_fy2627:,}) "
                "— Nebraska has been projected below minimum reserve in every "
                "Committee recommendation since July 2025; positive variance "
                "is almost certainly a misread"
            )
        if not (100_000_000 <= abs(status["endingBalance_FY2526"]) <= 900_000_000):
            warnings.append(
                f"endingBalance_FY2526 ({status['endingBalance_FY2526']:,}) "
                "outside plausible range $100M–$900M"
            )

        if warnings:
            print(f"⚠️  GF Status parser warnings for {os.path.basename(pdf_path)}:")
            for w in warnings:
                print(f"   - {w}")
            # Try the next candidate PDF instead of returning bad data
            continue

        print(f"✅ GF Status parsed from {os.path.basename(pdf_path)}:")
        print(f"   Beginning FY25-26: ${status['beginningBalance_FY2526']:>15,}")
        print(f"   Net Revenues FY25-26: ${status['netRevenues_FY2526']:>15,}")
        print(f"   Approp FY25-26:    ${status['appropriations_FY2526']:>15,}")
        print(f"   Ending FY25-26:    ${status['endingBalance_FY2526']:>15,}")
        print(f"   Reserve Variance FY26/27: ${variance_fy2627:>15,}")
        return {"status": status, "table": table}

    print("❌ GF Status parser failed sanity checks on all candidate PDFs")
    return empty


# ---------------------------------------------------------------------------
# NEFAB Revenue Forecasts — parse Table 3 from the biennial budget PDF
# ---------------------------------------------------------------------------

def parse_nefab_forecasts(budget_pdf_path):
    """
    Parse Table 3 (General Fund Revenue Forecasts) from the biennial budget
    PDF. Returns a list of four category dicts with FY25-26 and FY26-27
    forecast amounts plus adjusted growth rates.
    """
    if not budget_pdf_path:
        return []

    text = _pdf_to_text(budget_pdf_path)
    if not text:
        return []

    table3_match = re.search(
        r"Table 3\s*[-–]?\s*General Fund Revenue Forecasts"
        r"(.*?)(?=Table 4|Historical General Fund Revenues)",
        text,
        re.DOTALL | re.IGNORECASE,
    )
    if not table3_match:
        print("⚠️  Could not locate Table 3 in biennial budget PDF")
        return []

    section = table3_match.group(1)

    categories = [
        ("Sales & Use",       r"Sales\s+and\s+Use\s+Tax"),
        ("Individual Income", r"Individual\s+Income\s+Tax"),
        ("Corporate Income",  r"Corporate\s+Income\s+Tax"),
        ("Miscellaneous",     r"Miscellaneous\s+receipts"),
    ]

    # The section contains each category row twice: once with dollar amounts,
    # once with growth percentages. We match the dollar-amount row first, then
    # the percentage row.
    forecasts = []
    for display_name, anchor_pattern in categories:
        # Dollar-amount line: category name followed by 5 large numbers
        dollar_match = re.search(
            anchor_pattern + r"\s+([\d,]{7,}(?:\s+[\d,]{7,}){2,4})",
            section,
            re.IGNORECASE,
        )
        if not dollar_match:
            continue

        nums = _extract_numbers(dollar_match.group(1))
        if len(nums) < 3:
            continue

        # Columns: FY24-25 actual, FY25-26, FY26-27, FY27-28, FY28-29
        fy2526 = nums[1]
        fy2627 = nums[2]

        # Growth-rate line: category name followed by percent values.
        # The row has five % columns: FY24-25 actual, FY25-26, FY26-27,
        # FY27-28, FY28-29. We want the FY25-26 adjusted growth (the second
        # percentage), which is what the dashboard shows for current year.
        growth_match = re.search(
            anchor_pattern + r"\s+-?\d+\.\d+%\s+(-?\d+\.\d+%)",
            section,
            re.IGNORECASE,
        )
        growth = growth_match.group(1) if growth_match else "N/A"

        forecasts.append({
            "name": display_name,
            "fy2526": fy2526,
            "fy2627": fy2627,
            "growth": growth,
        })

    if forecasts:
        print(f"✅ NEFAB Table 3 parsed: {len(forecasts)} categories")

    return forecasts


def parse_revenue_pdf(rev_pdf_path, budget_pdf_path, rev_period_str):
    """
    Assemble the revenue section of the dashboard JSON.

    NEFAB forecasts always come from the biennial budget PDF (Table 3) because
    those are the authoritative numbers that the dashboard compares against.
    YTD actuals come from the monthly revenue release PDF if available.

    IMPORTANT: the old behavior fabricated pro-rata "forecasts" when the
    revenue release fetch failed. That produced identical split percentages
    across all categories, which was mathematically impossible. We now leave
    arrays empty rather than ship fake data — the dashboard handles missing
    revenue data gracefully.
    """
    rev = {
        "period": rev_period_str,
        "ytdActual": 0,
        "ytdForecast": 0,
        "categories": [],
        "monthlySeries": [],
        "nefabForecasts": [],
    }

    rev["nefabForecasts"] = parse_nefab_forecasts(budget_pdf_path)

    if rev_pdf_path:
        text = _pdf_to_text(rev_pdf_path)
        if text:
            # YTD totals
            tot_m = re.search(
                r"Total\s+Net\s+Receipts[^\n]*?([\d,]{9,})\s+([\d,]{9,})",
                text,
                re.IGNORECASE,
            )
            if tot_m:
                rev["ytdActual"] = int(tot_m.group(1).replace(",", ""))
                rev["ytdForecast"] = int(tot_m.group(2).replace(",", ""))

            # Category YTD actuals
            cat_map = [
                ("Sales & Use",       r"Sales\s+(?:and|&)\s+Use\s+Tax"),
                ("Individual Income", r"Individual\s+Income\s+Tax"),
                ("Corporate Income",  r"Corporate\s+Income\s+Tax"),
                ("Miscellaneous",     r"Miscellaneous"),
            ]
            for name, pattern in cat_map:
                m = re.search(
                    pattern + r"[^\n]*?([\d,]{7,})\s+([\d,]{7,})",
                    text,
                    re.IGNORECASE,
                )
                if m:
                    rev["categories"].append({
                        "name": name,
                        "actual": int(m.group(1).replace(",", "")),
                        "forecast": int(m.group(2).replace(",", "")),
                    })

    return rev


# ---------------------------------------------------------------------------
# Agency parser — anchored to Table 12 "Total" rows
# ---------------------------------------------------------------------------

def parse_biennial_budget_agencies(pdf_path):
    """
    Parse Table 12 (General Fund Appropriation Adjustments by Agency).

    Row format in the PDF:
       #25  DHHS  Total  2,023,307,450  2,051,562,444  (14,058,698)  ...

    We take the first number after "Total" as the Enacted FY2025-26
    appropriation. Cash fund totals come from the "Cash Funds" subsection of
    the "All Fund Appropriations" section.
    """
    if not pdf_path:
        return []

    text = _pdf_to_text(pdf_path)
    if not text:
        return []

    agencies = {}

    # Table 12 section for GF
    t12 = re.search(
        r"Table 12.*?General Fund Appropriation Adjustments by Agency"
        r"(.*?)(?=All Fund Appropriations|CAPITAL CONSTRUCTION|\Z)",
        text,
        re.DOTALL | re.IGNORECASE,
    )
    gf_section = t12.group(1) if t12 else text

    total_row = re.compile(
        r"^\s*#?(\d{2,3})\s+([A-Za-z][A-Za-z\s&,./\-']+?)\s+Total\s+([\d,()\s\-]+)$",
        re.MULTILINE,
    )

    for m in total_row.finditer(gf_section):
        aid = m.group(1)
        name = m.group(2).strip()
        nums = _extract_numbers(m.group(3))
        if not nums:
            continue
        gf_val = nums[0]  # first column = Enacted FY2025-26
        if gf_val <= 0:
            continue
        if aid not in agencies:
            agencies[aid] = {"name": name, "gf": gf_val, "cf": 0}
        else:
            agencies[aid]["gf"] = max(agencies[aid]["gf"], gf_val)

    # Cash Fund subsection
    cf_match = re.search(
        r"All Fund Appropriations.*?Cash Funds"
        r"(.*?)(?=Federal Funds|Revolving Funds|\Z)",
        text,
        re.DOTALL | re.IGNORECASE,
    )
    if cf_match:
        for m in total_row.finditer(cf_match.group(1)):
            aid = m.group(1)
            name = m.group(2).strip()
            nums = _extract_numbers(m.group(3))
            if not nums or nums[0] <= 0:
                continue
            if aid not in agencies:
                agencies[aid] = {"name": name, "gf": 0, "cf": nums[0]}
            else:
                agencies[aid]["cf"] = max(agencies[aid]["cf"], nums[0])

    # Loose fallback — only used if Table 12 anchor completely failed
    if not agencies:
        print("⚠️  Agency parser: Table 12 anchor failed, using loose fallback")
        loose = re.compile(
            r"^\s*#?(\d{2,3})\s+([A-Za-z\s&,./\-']+?)\s+(Oper|Aid|Const|Total)\s+([\d,()]+)",
            re.MULTILINE,
        )
        max_by_type = {}
        names = {}
        for m in loose.finditer(text):
            aid = m.group(1)
            name = m.group(2).strip()
            rtype = m.group(3)
            nums = _extract_numbers(m.group(4))
            if not nums or nums[0] <= 0:
                continue
            key = (aid, rtype)
            if key not in max_by_type or nums[0] > max_by_type[key]:
                max_by_type[key] = nums[0]
                names[aid] = name

        for (aid, rtype), val in max_by_type.items():
            if aid not in agencies:
                agencies[aid] = {"name": names[aid], "gf": 0, "cf": 0}
            if rtype in ("Oper", "Aid", "Const"):
                agencies[aid]["gf"] += val

    result = []
    for aid, data in agencies.items():
        if data["gf"] > 0 or data["cf"] > 0:
            result.append({
                "id": aid,
                "name": data["name"],
                "appropriation": data["gf"],
                "cash_fund": data["cf"],
            })

    # Sanity: top 3 agencies by GF should be DHHS (#25), Education (#13),
    # University (#51) in that order
    top3 = sorted(result, key=lambda a: a["appropriation"], reverse=True)[:3]
    top3_ids = [a["id"] for a in top3]
    if top3_ids != ["25", "13", "51"]:
        print(f"⚠️  Agency parser: top 3 by GF are {top3_ids}, expected ['25', '13', '51']")

    return result


# ---------------------------------------------------------------------------
# LFO Directory parser (unchanged — works correctly)
# ---------------------------------------------------------------------------

def parse_lfo_directory(pdf_paths):
    descriptions = {
        "10000": {
            "title": "General Fund",
            "description": "The primary operating fund of the State.",
            "statutory_authority": "Neb. Rev. Stat. §77-2715",
            "agency_name": "Multiple Agencies",
            "program": "Multiple Programs",
        },
        "11000": {
            "title": "Cash Reserve Fund",
            "description": "The State's 'Rainy Day' Fund.",
            "statutory_authority": "Neb. Rev. Stat. §84-612",
            "agency_name": "State Treasurer",
            "program": "N/A",
        },
    }

    if not pdf_paths:
        return descriptions

    for path in pdf_paths:
        text = _pdf_to_text(path)
        if not text:
            continue

        for page in text.split("\f"):
            fund_m = re.search(r"FUND\s*:?\s*(\d{5})[\s\:\-]+([^\n]+)", page, re.IGNORECASE)
            if not fund_m:
                continue

            fid = fund_m.group(1)
            if fid in ("10000", "11000"):
                continue

            title = fund_m.group(2).strip()
            desc_m = re.search(
                r"PERMITTED USES\s*:?\s*(.+?)(?=\n\s*FUND SUMMARY|\n\s*REVENUE|\Z)",
                page, re.S | re.IGNORECASE,
            )
            stat_m = re.search(
                r"STATUTORY AUTHORITY\s*:?\s*(.+?)(?=\n\s*REVENUE|\n\s*PERMITTED|\Z)",
                page, re.S | re.IGNORECASE,
            )
            agency_m = re.search(
                r"AGENCY\s*:?\s*(?:#?\d+)?[\s\-\:]*([^\n]+)",
                page, re.IGNORECASE,
            )
            prog_m = re.search(
                r"PROGRAM\s*:?\s*(?:#?\d+)?[\s\-\:]*([^\n]+)",
                page, re.IGNORECASE,
            )

            desc_text = re.sub(r"\s+", " ", desc_m.group(1)).strip() if desc_m else ""
            stat_text = re.sub(r"\s+", " ", stat_m.group(1)).strip() if stat_m else ""
            agency_text = agency_m.group(1).strip() if agency_m else ""
            prog_text = prog_m.group(1).strip() if prog_m else ""

            existing = descriptions.get(fid, {})
            descriptions[fid] = {
                "title": title or existing.get("title", ""),
                "description": desc_text or existing.get("description", ""),
                "statutory_authority": stat_text or existing.get("statutory_authority", ""),
                "agency_name": agency_text or existing.get("agency_name", ""),
                "program": prog_text or existing.get("program", ""),
            }

    return descriptions


# ---------------------------------------------------------------------------
# Sheet upload (unchanged)
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# main()
# ---------------------------------------------------------------------------

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

    print("Step 2: Fetching Budget/LFO Reports & Revenue...")
    year, _, _ = get_target_month(args.month)
    budget_year = year if year % 2 != 0 else year - 1

    status_path = fetch_gf_status(work_dir)
    budget_path = fetch_biennial_budget(budget_year, work_dir)
    # Try the other budget year as fallback in case of off-cycle publication
    alt_budget_path = None
    if not budget_path:
        alt_budget_path = fetch_biennial_budget(budget_year + 1, work_dir)
    effective_budget = budget_path or alt_budget_path

    lfo_paths = fetch_lfo_directory(work_dir)
    rev_path, rev_period = fetch_revenue_release(work_dir)

    print("Step 3: Parsing Data...")
    oip_data = parse_oip_for_dashboard(oip_path) if oip_path else {"funds": [], "macro": {}}

    # Pass both candidates to the GF Status parser — the standalone status.pdf
    # is preferred, but if it fails sanity checks the full biennial budget PDF
    # contains the same table and will be tried next.
    gf_data = parse_gf_status_pdf([status_path, effective_budget])

    agency_data = parse_biennial_budget_agencies(effective_budget)
    lfo_data = parse_lfo_directory(lfo_paths)

    status_dict = gf_data.get("status", {})

    cr_fund = next((f for f in oip_data["funds"] if f["id"] == "11000"), None)
    if cr_fund:
        status_dict["cashReserve_endingBalance"] = cr_fund["balance"]

    revenue_data = parse_revenue_pdf(rev_path, effective_budget, rev_period)

    dashboard = {
        "lastUpdated": {
            "cash": date_str,
            "budget": "March 2026",
        },
        "macro": oip_data["macro"],
        "funds": oip_data["funds"],
        "revenue": revenue_data,
        "generalFundStatus": status_dict,
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
