#!/usr/bin/env python3
"""
Nebraska Public Budget Dashboard — Automated Data Scraper
==========================================================
Fetches all official Nebraska state budget and financial data from:
  DAS (State Accounting), Revenue Department, and the Legislature's Fiscal Office.

Every source has a STABLE URL — no manual entry required.

Data Sources:
  1. OIP Report (Cash Pool)        → das.nebraska.gov/accounting/
  2. Fund Summary (Fund Titles)    → das.nebraska.gov/accounting/
  3. Revenue News Release (PDF)    → revenue.nebraska.gov/about/news-releases/
  4. Revenue Statistics (XLSX)     → revenue.nebraska.gov/research/statistics/
  5. GF Financial Status (PDF)     → nebraskalegislature.gov/FloorDocs/Current/
  6. Biennial Budget Report (PDF)  → nebraskalegislature.gov/pdf/reports/fiscal/{year}budget.pdf
  7. LFO Directory of Programs     → nebraskalegislature.gov/pdf/reports/fiscal/funddescriptions*.pdf
     and Funds (reference)

All Legislature fiscal documents indexed at:
  https://nebraskalegislature.gov/reports/fiscal.php

Usage:
    python3 scraper_automation.py [--month YYYY-MM] [--sheet-id SHEET_ID]
    python3 scraper_automation.py --dry-run          # test without downloading
    python3 scraper_automation.py --stats-only       # fetch only XLSX stats files
    python3 scraper_automation.py --discover-urls    # find XLSX links on stats pages

If --month is omitted, defaults to the prior calendar month.
"""

import os
import re
import sys
import json
import argparse
import tempfile
from datetime import datetime, timedelta
from urllib.request import Request, urlopen, build_opener, HTTPHandler, HTTPSHandler
from urllib.error import HTTPError

# Many state government sites (revenue.nebraska.gov in particular) block requests
# from urllib's default User-Agent with a 403 Forbidden. Use a browser-like UA.
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36"
)

def http_get(url, timeout=30):
    """Fetch a URL with a browser-like User-Agent. Returns bytes."""
    req = Request(url, headers={'User-Agent': USER_AGENT, 'Accept': '*/*'})
    with urlopen(req, timeout=timeout) as response:
        return response.read()

# ─────────────────────────────────────────────
# URL TEMPLATES — verified against live DAS/Revenue sites April 2026
# ─────────────────────────────────────────────

# OIP XLSX (available since ~FY2024 in XLSX; older months are PDF only)
# Pattern: NE_DAS_Accounting-Operating_Investment_Pool_OIP_Report_{YYYY}-{MM}.xlsx
OIP_XLSX_URL = (
    "https://das.nebraska.gov/accounting/docs/"
    "NE_DAS_Accounting-Operating_Investment_Pool_OIP_Report_{year}-{month:02d}.xlsx"
)

# OIP PDF fallback (older format, also still published for some months)
# Pattern: oipMMYY.pdf  (e.g., oip1224.pdf for Dec 2024)
OIP_PDF_URL = (
    "https://das.nebraska.gov/accounting/docs/stip/"
    "oip{month:02d}{year_short}.pdf"
)

# Fund Summary by Fund (PDF) — official fund titles
# Pattern: NE_DAS_Accounting-Monthly_Reports_Fund_Summary_by_Fund_Report_{YYYY}-{MM}.pdf
FUND_SUMMARY_URL = (
    "https://das.nebraska.gov/accounting/docs/"
    "NE_DAS_Accounting-Monthly_Reports_Fund_Summary_by_Fund_Report_{year}-{month:02d}.pdf"
)

# General Fund Receipts News Release (PDF)
# Pattern: General_Fund_Receipts_News_Release_{MonthName}_{YYYY}_Final_Copy.pdf
# NOTE: Month name is full (January, February, etc.), year folder is the calendar year
REVENUE_RELEASE_URL = (
    "https://revenue.nebraska.gov/sites/default/files/doc/news-release/gen-fund/"
    "{year}/General_Fund_Receipts_News_Release_{month_name}_{year}_Final_Copy.pdf"
)

# ── revenue.nebraska.gov site map (corrected per Tim P.) ──
# Landing pages:
#   Research hub:       https://revenue.nebraska.gov/research
#   Statistics hub:     https://revenue.nebraska.gov/research/statistics
#   GF Receipts page:  https://revenue.nebraska.gov/research/general-fund-receipts
#   News releases:      https://revenue.nebraska.gov/about/news-releases/general-fund-receipts-news-releases
#
# Statistics sub-pages (each has XLSX download links):
#   Sales Tax Data:     https://revenue.nebraska.gov/research/statistics/sales-tax-data
#     → "General Fund Sales and Use Tax Cash Receipts (1999-current)" XLSX
#   Income Tax Data:    https://revenue.nebraska.gov/research/statistics/individual-income-tax-data
#     → "General Fund Individual Income Tax Receipts (1999-20XX)" XLSX
#   Corporate Tax Data: https://revenue.nebraska.gov/research/statistics/business-income-tax-data
#     → "General Fund Corporate Income Tax Receipts (1999-20XX)" XLSX
#   Misc Tax Data:      https://revenue.nebraska.gov/research/statistics/miscellaneous-tax-data
#     → "General Fund Miscellaneous Tax Cash Receipts (1999-20XX)" XLSX
REVENUE_NEWS_RELEASES = "https://revenue.nebraska.gov/about/news-releases/general-fund-receipts-news-releases"
REVENUE_RESEARCH = "https://revenue.nebraska.gov/research"
REVENUE_STATISTICS = "https://revenue.nebraska.gov/research/statistics"
REVENUE_GF_RECEIPTS = "https://revenue.nebraska.gov/research/general-fund-receipts"

# Statistics sub-pages with downloadable XLSX files
REVENUE_STATS_PAGES = {
    'sales': "https://revenue.nebraska.gov/research/statistics/sales-tax-data",
    'individual': "https://revenue.nebraska.gov/research/statistics/individual-income-tax-data",
    'corporate': "https://revenue.nebraska.gov/research/statistics/business-income-tax-data",
    'misc': "https://revenue.nebraska.gov/research/statistics/miscellaneous-tax-data",
}

# ── Nebraska Legislature — live budget status ──
# This is a STABLE URL that always points to the current session's GF Financial Status.
# Updated by LFO during session. Contains the same data as the biennial budget PDF
# but may be more current (e.g., reflects floor amendments, enrolled bills).
GF_STATUS_URL = "https://nebraskalegislature.gov/FloorDocs/Current/PDF/Budget/status.pdf"

# ── Nebraska Legislature Fiscal Reports — all stable URLs ──
# Index page: https://nebraskalegislature.gov/reports/fiscal.php
# Every budget-related PDF is published under /pdf/reports/fiscal/ with predictable names.
LEG_FISCAL_INDEX = "https://nebraskalegislature.gov/reports/fiscal.php"

# Biennial budget reports — one per legislative session (odd years typically = full biennial,
# even years = mid-biennium adjustment)
LEG_BUDGET_URL_TEMPLATE = "https://nebraskalegislature.gov/pdf/reports/fiscal/{year}budget.pdf"
LEG_PRELIM_BUDGET_URL_TEMPLATE = "https://nebraskalegislature.gov/pdf/reports/fiscal/{year}prelim.pdf"

# LFO Directory of State Agency Programs and Funds (biennial)
# Published in two volumes since 2021: funddescriptions1_{YYYY}.pdf (Agencies 03-33)
# and funddescriptions2_{YYYY}.pdf (Agencies 34-97 & Capital Construction)
# A "supplement" volume was added in 2025.
# Earlier years used a combined single-volume naming: funddescriptions_{YYYY}.pdf
LFO_DIRECTORY_VOL1_URL = "https://nebraskalegislature.gov/pdf/reports/fiscal/funddescriptions1_{year}.pdf"
LFO_DIRECTORY_VOL2_URL = "https://nebraskalegislature.gov/pdf/reports/fiscal/funddescriptions2_{year}.pdf"
LFO_DIRECTORY_SUPPLEMENT_URL = "https://nebraskalegislature.gov/pdf/reports/fiscal/funddescriptions_supplement_{year}.pdf"
LFO_DIRECTORY_COMBINED_URL = "https://nebraskalegislature.gov/pdf/reports/fiscal/funddescriptions_{year}.pdf"

# Tax Rate Review Committee Report (annual)
TAX_RATE_REVIEW_URL = "https://nebraskalegislature.gov/pdf/reports/fiscal/taxratereview_annual_{year}.pdf"

# Budget Stress Test Report (annual since 2025)
BUDGET_STRESS_TEST_URL = "https://nebraskalegislature.gov/pdf/reports/fiscal/{year}_Budget_Stress_Test_Report.pdf"

# Nebraska Legislative Fiscal Office — home page
LFO_HOME_URL = "https://nebraskalegislature.gov/divisions/fiscal.php"


# ─────────────────────────────────────────────
# DATA SOURCE → DASHBOARD TAB MAPPING
# ─────────────────────────────────────────────
"""
┌───────────────────────────────┬─────────────────────────────────────────────────────┬──────────────┐
│ Dashboard Tab                 │ Data Source                                         │ Auto-Scrape? │
├───────────────────────────────┼─────────────────────────────────────────────────────┼──────────────┤
│ State of the State (macro)    │ OIP XLSX: total balance, interest, yield, fund cnt  │ ✅ YES       │
│ Revenue Tracker               │ Revenue News Release PDF + Statistics XLSX files    │ ✅ YES       │
│                               │  → news: revenue.nebraska.gov/about/news-releases/ │              │
│                               │           general-fund-receipts-news-releases       │              │
│                               │  → xlsx: revenue.nebraska.gov/research/statistics   │              │
│ General Fund Spotlight        │ OIP (balance) + GF Financial Status PDF             │ ✅ YES       │
│                               │  → nebraskalegislature.gov/FloorDocs/Current/       │              │
│                               │     PDF/Budget/status.pdf (LIVE, updated by LFO)    │              │
│ Agency Rollups                │ Biennial Budget PDF (agency appropriations)         │ ⚠️ SEMI-AUTO │
│                               │  → Can parse from status.pdf for top-line numbers   │              │
│ Fund Explorer                 │ OIP XLSX: all fund balances + Fund Summary titles   │ ✅ YES       │
└───────────────────────────────┴─────────────────────────────────────────────────────┴──────────────┘

KEY FINDINGS (updated with corrected URLs from Tim P.):
  ✅ OIP scraping targets are CORRECT — build_oip_tracker.py properly reads the XLSX
  ✅ Revenue news releases URL confirmed: revenue.nebraska.gov/about/news-releases/
     general-fund-receipts-news-releases
  ✅ Revenue statistics XLSX files available at: revenue.nebraska.gov/research/statistics
     (sub-pages for sales, individual, corporate, misc tax data — each with XLSX downloads)
  ✅ BONUS: Live GF Financial Status at nebraskalegislature.gov/FloorDocs/Current/PDF/Budget/status.pdf
     — this is a stable URL updated by LFO during session, more current than biennial budget PDF
  ⚠️ Agency-level detail still requires biennial budget PDF (no machine-readable API)
"""


# ─────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────

def download_file(url, dest_path):
    """Download a file with a browser User-Agent. Returns True if successful."""
    try:
        print(f"  Downloading: {url}")
        data = http_get(url)
        with open(dest_path, 'wb') as f:
            f.write(data)
        return True
    except HTTPError as e:
        print(f"  ⚠️  HTTP {e.code}: {url}")
        return False
    except Exception as e:
        print(f"  ⚠️  {type(e).__name__}: {e}")
        return False


def get_target_month(month_str=None):
    """Parse --month arg or default to prior calendar month."""
    if month_str:
        dt = datetime.strptime(month_str, "%Y-%m")
    else:
        today = datetime.today()
        first_of_month = today.replace(day=1)
        dt = first_of_month - timedelta(days=1)  # last day of prior month
    return dt.year, dt.month, dt.strftime("%B")  # (2026, 3, "March")

# ─────────────────────────────────────────────
# STEP 1: FETCH OIP REPORT (WITH FISCAL MONTH FIX)
# ─────────────────────────────────────────────

def get_latest_oip_url():
    import datetime
    now = datetime.datetime.now()
    
    # Nebraska Fiscal Year starts in July.
    # To get the latest report, we usually look back 1-2 months.
    # We'll target the previous month to ensure the data is finalized.
    target_date = now - datetime.timedelta(days=32)
    
    cal_month = target_date.month
    cal_year = target_date.year
    
    # Convert Calendar Month to Nebraska Fiscal Month
    # July (7) -> 1, August (8) -> 2 ... January (1) -> 7, March (3) -> 9
    if cal_month >= 7:
        fiscal_month = cal_month - 6
    else:
        fiscal_month = cal_month + 6
        
    # Format fiscal month as 01, 02, etc.
    fm_str = f"{fiscal_month:02d}"
    
    # The URL uses the CALENDAR YEAR of the report and the FISCAL MONTH
    url = f"https://das.nebraska.gov/accounting/docs/NE_DAS_Accounting-Operating_Investment_Pool_OIP_Report_{cal_year}-{fm_str}.xlsx"
    
    return url, f"{target_date.strftime('%B %Y')}"

# ─────────────────────────────────────────────
# STEP 2: FETCH REVENUE DATA
# ─────────────────────────────────────────────

def fetch_revenue_release(year, month, month_name, work_dir):
    """
    Download the General Fund Receipts News Release PDF from revenue.nebraska.gov.

    NOTE: This is the ONLY publicly available source for monthly YTD actual vs. forecast.
    The PDF contains tables that must be parsed to extract:
      - Gross receipts by category (Sales & Use, Individual Income, Corporate, Misc)
      - Net receipts (after refunds)
      - YTD totals vs. NEFAB certified forecast
      - Monthly vs. forecast comparison

    The URL pattern uses the report month name. For the December report (released ~Jan 15),
    year=2025, month_name="December", but the URL folder is /2025/.
    """
    url = REVENUE_RELEASE_URL.format(year=year, month_name=month_name)
    path = os.path.join(work_dir, f"revenue_{year}_{month:02d}.pdf")

    if download_file(url, path):
        return path

    # Try alternate naming conventions
    alt_names = [
        month_name,
        month_name.upper(),
        month_name.lower(),
    ]
    for name in alt_names:
        alt_url = REVENUE_RELEASE_URL.format(year=year, month_name=name)
        if alt_url != url and download_file(alt_url, path):
            return path

    print("  ❌  Revenue release not yet available for this period")
    return None


def fetch_gf_status(work_dir):
    """
    Download the LIVE General Fund Financial Status from the Legislature.

    This is a STABLE URL that always points to the current session's status:
      https://nebraskalegislature.gov/FloorDocs/Current/PDF/Budget/status.pdf

    Updated by LFO during session — may be more current than the biennial budget PDF.
    Contains: beginning balance, net receipts, transfers, appropriations, ending balance,
    minimum reserve variance, and revenue growth rates.
    """
    path = os.path.join(work_dir, "gf_status.pdf")
    if download_file(GF_STATUS_URL, path):
        return path
    print("  ❌  GF Financial Status not available")
    return None


def fetch_biennial_budget(year, work_dir, preliminary=False):
    """
    Download the Appropriations Committee Biennial Budget Report.

    Published once per legislative session. Odd-numbered years typically contain
    the full biennial budget; even-numbered years contain mid-biennium adjustments.

    Args:
        year: session year (e.g., 2026)
        preliminary: if True, fetch the Preliminary Report instead of the final

    Returns local file path or None.
    """
    template = LEG_PRELIM_BUDGET_URL_TEMPLATE if preliminary else LEG_BUDGET_URL_TEMPLATE
    url = template.format(year=year)
    label = 'prelim' if preliminary else 'budget'
    path = os.path.join(work_dir, f"{year}{label}.pdf")

    if download_file(url, path):
        return path
    print(f"  ❌  {year} {label} report not available")
    return None


def fetch_lfo_directory(year, work_dir):
    """
    Download the LFO Directory of State Agency Programs and Funds.

    Published biennially (odd years). Since 2021, published as two volumes plus an
    optional supplement. Earlier years used a single combined volume.

    Returns a list of local file paths (may be 1-3 files).
    """
    paths = []

    # Try two-volume format first (2021+)
    for vol_num, template in [(1, LFO_DIRECTORY_VOL1_URL), (2, LFO_DIRECTORY_VOL2_URL)]:
        url = template.format(year=year)
        path = os.path.join(work_dir, f"lfo_directory_vol{vol_num}_{year}.pdf")
        if download_file(url, path):
            paths.append(path)

    # Try supplement (2025+)
    sup_url = LFO_DIRECTORY_SUPPLEMENT_URL.format(year=year)
    sup_path = os.path.join(work_dir, f"lfo_directory_supplement_{year}.pdf")
    if download_file(sup_url, sup_path):
        paths.append(sup_path)

    # Fall back to combined format (pre-2021)
    if not paths:
        url = LFO_DIRECTORY_COMBINED_URL.format(year=year)
        path = os.path.join(work_dir, f"lfo_directory_{year}.pdf")
        if download_file(url, path):
            paths.append(path)

    if not paths:
        print(f"  ❌  LFO Directory {year} not found")
    return paths


def parse_biennial_budget_agencies(pdf_path):
    """
    Extract agency-level appropriation data from the biennial budget report.

    The budget PDF contains multiple tables with the same agencies:
      - Table 12: GF Appropriation Adjustments by Agency  (General Fund)
      - Table 19: Cash Fund Appropriation Adjustments by Agency  (Cash Fund)

    Both use the same row format: "#XX Agency Name  Type  FY25-26  FY26-27  adj  adj..."
    We separate them by tracking which table context we're in.

    Returns list of dicts per agency, with separate GF and CF totals.
    """
    import subprocess

    result = subprocess.run(
        ['pdftotext', '-layout', pdf_path, '-'],
        capture_output=True, text=True
    )
    text = result.stdout

    # Split into sections by table header to track which fund source we're in
    # Table 12 header: "Table 12 General Fund Appropriation Adjustments by Agency"
    # Table 19 header: "Table 19 Cash Fund Appropriation Adjustments by Agency"
    gf_start = text.find('Table 12')
    cf_start = text.find('Table 19')

    # Fallback: look for the column header signature of each table
    if gf_start < 0:
        gf_start = text.find('General Fund Appropriation Adjustments by Agency')
    if cf_start < 0:
        cf_start = text.find('Cash Fund Appropriation Adjustments by Agency')

    gf_text = text[gf_start:cf_start] if (gf_start >= 0 and cf_start > gf_start) else ''
    cf_text = text[cf_start:] if cf_start >= 0 else ''

    def parse_num(s):
        s = s.replace(',', '').replace('(', '-').replace(')', '')
        try:
            return int(s)
        except ValueError:
            return 0

    def extract_agency_rows(section_text):
        """Extract agency appropriation rows from a table section."""
        agencies_in_section = {}
        # Allow leading whitespace — PDF layout often indents table rows
        pattern = re.compile(
            r'^\s*#(\d{2,3})\s+([A-Za-z][A-Za-z\s&,./\'()-]+?)\s+(Oper|Aid|Const|Total)\s+'
            r'([\d,()]+)\s+([\d,()]+)',
            re.MULTILINE
        )
        for match in pattern.finditer(section_text):
            agency_id = match.group(1)
            name = match.group(2).strip()
            row_type = match.group(3)
            if row_type == 'Total':
                continue

            fy2526 = parse_num(match.group(4))
            fy2627 = parse_num(match.group(5))

            if agency_id not in agencies_in_section:
                agencies_in_section[agency_id] = {
                    'id': agency_id,
                    'name': name,
                    'total_fy2526': 0,
                    'total_fy2627': 0,
                    'by_type': {},
                }
            agencies_in_section[agency_id]['total_fy2526'] += fy2526
            agencies_in_section[agency_id]['total_fy2627'] += fy2627
            by_type = agencies_in_section[agency_id]['by_type']
            by_type[row_type] = by_type.get(row_type, 0) + fy2526
        return agencies_in_section

    gf_agencies = extract_agency_rows(gf_text)
    cf_agencies = extract_agency_rows(cf_text)

    # Merge: build a unified list keyed by agency ID
    all_ids = set(gf_agencies.keys()) | set(cf_agencies.keys())
    result_list = []
    for aid in sorted(all_ids, key=int):
        gf = gf_agencies.get(aid, {})
        cf = cf_agencies.get(aid, {})
        name = gf.get('name') or cf.get('name', f'Agency {aid}')

        result_list.append({
            'id': aid,
            'name': name,
            'gf_fy2526': gf.get('total_fy2526', 0),
            'gf_fy2627': gf.get('total_fy2627', 0),
            'cf_fy2526': cf.get('total_fy2526', 0),
            'cf_fy2627': cf.get('total_fy2627', 0),
            'gf_by_type': gf.get('by_type', {}),
            'cf_by_type': cf.get('by_type', {}),
        })

    return result_list


def parse_lfo_directory(pdf_paths):
    """
    Parse one or more LFO Directory PDF volumes to extract fund descriptions.

    Returns a flat dict mapping fund_id → description info:
      {'22970': {'title': 'PERKINS COUNTY CANAL...', 'description': '...', 'statutory_authority': '...'}, ...}

    The LFO Directory (published biennially at nebraskalegislature.gov/reports/fiscal.php)
    contains three types of pages per agency:
      1. Agency overview (description + expenditure table)
      2. Program pages (purpose text + expenditure table)
      3. Fund pages (statutory authority, revenue sources, permitted uses, balance sheet)

    Of ~1,500 OIP funds, ~400 have LFO descriptions. These are the named cash, revolving,
    and trust funds. Federal clearing accounts and sub-fund variants are excluded.
    """
    import subprocess

    full_text = ''
    for path in pdf_paths:
        result = subprocess.run(
            ['pdftotext', '-layout', path, '-'],
            capture_output=True, text=True
        )
        full_text += result.stdout + '\n\f'

    fund_descriptions = {}
    current_agency_id = None
    current_agency_name = None

    for page in full_text.split('\f'):
        page = page.strip()
        if not page:
            continue

        # Detect agency header
        agency_match = re.search(r'AGENCY\s+(\d{2,3})\s*[–\-]\s*(.+?)(?:\n|$)', page)
        if agency_match:
            current_agency_id = agency_match.group(1).lstrip('0').zfill(2)
            current_agency_name = agency_match.group(2).strip().rstrip(',.')

        if not current_agency_id:
            continue

        # Detect fund page
        fund_match = re.search(r'FUND\s+(\d{5}):\s+(.+?)(?:\n|$)', page)
        if not fund_match:
            continue

        fund_id = fund_match.group(1)
        fund_name = fund_match.group(2).strip()

        # Extract statutory authority
        stat_match = re.search(
            r'STATUTORY AUTHORITY:\s*(.+?)(?=\n\s*REVENUE SOURCES|\n\s*PERMITTED|\Z)',
            page, re.DOTALL
        )
        statutory = re.sub(r'\s+', ' ', stat_match.group(1)).strip() if stat_match else ''

        # Extract revenue sources
        rev_match = re.search(
            r'REVENUE SOURCES:\s*(.+?)(?=\n\s*PERMITTED USES|\n\s*FUND SUMMARY|\Z)',
            page, re.DOTALL
        )
        revenue = re.sub(r'\s+', ' ', rev_match.group(1)).strip() if rev_match else ''

        # Extract permitted uses (primary description for tooltips)
        uses_match = re.search(
            r'PERMITTED USES:\s*(.+?)(?=\n\s*FUND SUMMARY|\n\s*TRANSFERS|\Z)',
            page, re.DOTALL
        )
        uses = re.sub(r'\s+', ' ', uses_match.group(1)).strip() if uses_match else ''

        # Extract program linkage
        prog_match = re.search(r'EXPENDED IN PROGRAM[S]?\s+(.+?)(?:\n|$)', page, re.IGNORECASE)
        program = prog_match.group(1).strip() if prog_match else ''

        # Extract ending balance (rightmost column = most recent FY)
        bal_match = re.search(
            r'ENDING BALANCE\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)', page
        )
        balance = None
        if bal_match:
            try:
                balance = int(bal_match.group(4).replace(',', ''))
            except ValueError:
                pass

        fund_descriptions[fund_id] = {
            'title': fund_name,
            'agency_id': current_agency_id,
            'agency_name': current_agency_name,
            'program': program,
            'description': uses or revenue,  # fall back to revenue sources if no uses
            'statutory_authority': statutory,
            'ending_balance': balance,
        }

    return fund_descriptions


def discover_stats_xlsx_urls(category='sales'):
    """
    Scrape a revenue statistics page to find the XLSX download link for
    "General Fund {Category} Tax Cash Receipts".

    The page HTML contains <a href="/sites/default/files/doc/research/..."> links
    to the XLSX files. Filenames follow patterns like:
       general_fund_sales_and_use_tax_cash_receipts.xlsx
       general_fund_individual_income_tax_receipts.xlsx
       general_fund_corporate_income_tax_receipts.xlsx
       general_fund_miscellaneous_tax_cash_receipts.xlsx
    but the Revenue Department sometimes renames them or appends years, so
    discover by scraping rather than hardcoding.

    Returns list of absolute URLs to XLSX files found on the page.
    """
    page_url = REVENUE_STATS_PAGES.get(category)
    if not page_url:
        return []

    try:
        html = http_get(page_url).decode('utf-8', errors='ignore')
    except Exception as e:
        print(f"  ⚠️ Could not fetch {page_url}: {e}")
        return []

    # Find all XLSX links on the page
    # Pattern matches both relative (/sites/default/files/...) and absolute URLs
    xlsx_pattern = re.compile(
        r'href=["\']([^"\']*\.xlsx[^"\']*)["\']',
        re.IGNORECASE
    )

    links = []
    for match in xlsx_pattern.finditer(html):
        url = match.group(1)
        if url.startswith('/'):
            url = 'https://revenue.nebraska.gov' + url
        if 'general_fund' in url.lower() or 'general-fund' in url.lower():
            links.append(url)

    return list(dict.fromkeys(links))  # dedupe, preserve order


def fetch_revenue_stats_xlsx(work_dir, categories=None):
    """
    Download General Fund tax receipt XLSX files from revenue statistics pages.

    These files contain monthly gross/net receipts going back to 1999, organized
    in yearly tabs. Much easier to parse than the news release PDFs.

    Args:
        work_dir: directory to save downloads
        categories: list of categories to fetch ('sales', 'individual', 'corporate',
                    'misc'). Defaults to all four.

    Returns dict mapping category → local file path (or None if not found).
    """
    if categories is None:
        categories = ['sales', 'individual', 'corporate', 'misc']

    results = {}
    for cat in categories:
        print(f"  Scanning {cat} tax data page...")
        urls = discover_stats_xlsx_urls(cat)
        if not urls:
            print(f"    ⚠️ No XLSX links found on {cat} page")
            results[cat] = None
            continue

        # Take the first matching URL (pages typically have one primary XLSX)
        url = urls[0]
        fname = f"revenue_stats_{cat}.xlsx"
        path = os.path.join(work_dir, fname)

        if download_file(url, path):
            results[cat] = path
        else:
            results[cat] = None

    return results


def parse_revenue_stats_xlsx(xlsx_path, category):
    """
    Parse a General Fund tax receipts XLSX file.

    Sheet structure (typical):
      - One sheet per calendar year (e.g., '2024', '2025', '2026')
      - Rows: months (January through December, plus fiscal year totals)
      - Columns: Gross Receipts, Refunds, Net Receipts (or similar)

    Returns a list of monthly records for the most recent year:
      [{'month': 'January', 'gross': 250000000, 'net': 240000000}, ...]
    """
    import openpyxl

    try:
        wb = openpyxl.load_workbook(xlsx_path, data_only=True, read_only=True)
    except Exception as e:
        print(f"    ❌ Could not open {xlsx_path}: {e}")
        return []

    # Pick the most recent year sheet (highest numeric sheet name)
    year_sheets = []
    for name in wb.sheetnames:
        if name.isdigit() and len(name) == 4:
            year_sheets.append(int(name))

    if not year_sheets:
        print(f"    ⚠️ No year-named sheets found in {xlsx_path}")
        return []

    latest = str(max(year_sheets))
    ws = wb[latest]

    # Scan for month rows — the structure varies by category, so look for
    # rows where column A contains a month name
    months = {'January', 'February', 'March', 'April', 'May', 'June',
              'July', 'August', 'September', 'October', 'November', 'December'}

    records = []
    for row in ws.iter_rows(values_only=True):
        if not row or not row[0]:
            continue
        label = str(row[0]).strip()
        if label in months:
            # Grab the numeric cells; the exact column depends on file layout
            numeric = [c for c in row[1:] if isinstance(c, (int, float))]
            if numeric:
                records.append({
                    'month': label,
                    'year': latest,
                    'values': numeric,  # raw numbers — interpret based on file
                })

    return records


def parse_gf_status_pdf(pdf_path):
    """
    Extract General Fund financial status from the Legislature's status.pdf.

    Returns dict with key GF financial status figures.
    """
    import subprocess

    result = subprocess.run(
        ['pdftotext', '-layout', pdf_path, '-'],
        capture_output=True, text=True
    )
    text = result.stdout

    status = {}

    # Look for key line items by row label
    # The status PDF uses a table with labels on the left and FY columns
    patterns = {
        'net_receipts': r'Net Receipts.*?([\d,]+,\d{3})',
        'appropriations': r'General Fund Appropriations.*?([\d,]+,\d{3})',
        'ending_balance': r'Ending balance.*?\$?\s*([\d,]+,\d{3})',
        'minimum_reserve': r'Excess.*?shortfall.*?\(([\d,]+,\d{3})\)',
    }

    for key, pattern in patterns.items():
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            try:
                status[key] = int(match.group(1).replace(',', ''))
            except ValueError:
                pass

    return status


def parse_revenue_pdf(pdf_path):
    """
    Extract key revenue figures from the General Fund Receipts news release.

    The PDF typically contains two key tables:
      Table 1: Monthly comparison (Gross receipts, refunds, net by category)
      Table 2: Fiscal Year-to-Date comparison (YTD actual vs forecast by category)

    Returns dict with:
      ytdActual, ytdForecast, categories: [{name, actual, forecast}, ...]
    """
    import subprocess

    result = subprocess.run(
        ['pdftotext', '-layout', pdf_path, '-'],
        capture_output=True, text=True
    )
    text = result.stdout

    revenue = {
        'ytdActual': None,
        'ytdForecast': None,
        'categories': []
    }

    # Parse YTD net receipts from the "Fiscal Year Net Receipts" section
    # Pattern varies slightly by month but generally looks like:
    #   "Net General Fund receipts for fiscal year 20XX-YY were $X.XXX billion"
    #   or from the table: "Net Receipts ... $X,XXX,XXX,XXX ... $X,XXX,XXX,XXX"

    # Try to find the YTD summary table
    # Look for patterns like: "Individual Income Tax    1,850,000,000    1,820,000,000"
    categories_map = {
        'individual income': 'Net Individual Income',
        'sales and use': 'Net Sales & Use',
        'corporate income': 'Net Corporate Income',
        'miscellaneous': 'Miscellaneous Taxes',
    }

    # Extract dollar amounts from the text
    money_pattern = re.compile(r'\$?([\d,]+(?:\.\d+)?)\s+(?:million|billion)?', re.IGNORECASE)

    # NOTE: Full PDF table parsing requires more sophisticated logic.
    # For production, consider using tabula-py or camelot for table extraction.
    # This is a simplified pattern matcher.

    lines = text.split('\n')
    for line in lines:
        lower = line.lower()
        for key, label in categories_map.items():
            if key in lower:
                amounts = re.findall(r'[\d,]{6,}', line)
                if len(amounts) >= 2:
                    try:
                        actual = int(amounts[-2].replace(',', ''))
                        forecast = int(amounts[-1].replace(',', ''))
                        revenue['categories'].append({
                            'name': label,
                            'actual': actual,
                            'forecast': forecast,
                        })
                    except ValueError:
                        pass

        # Look for total net receipts
        if 'total' in lower and ('net' in lower or 'receipt' in lower):
            amounts = re.findall(r'[\d,]{8,}', line)
            if len(amounts) >= 2:
                try:
                    revenue['ytdActual'] = int(amounts[-2].replace(',', ''))
                    revenue['ytdForecast'] = int(amounts[-1].replace(',', ''))
                except ValueError:
                    pass

    return revenue


# ─────────────────────────────────────────────
# STEP 3: PARSE OIP DATA (reuses build_oip_tracker logic)
# ─────────────────────────────────────────────

def parse_oip_for_dashboard(xlsx_path):
    """
    Parse OIP XLSX and return dashboard-ready JSON structure.
    This is a simplified version of build_oip_tracker.parse_oip_xlsx()
    that outputs the shape the React dashboard expects.
    """
    import openpyxl

    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    ws = wb['Sheet1']

    period_ending = None
    interest_rate = None

    for row in ws.iter_rows(min_row=1, max_row=6, values_only=True):
        for cell in row:
            if cell and isinstance(cell, str):
                m = re.search(r'Period Ending\s*=\s*(.+)', cell)
                if m:
                    period_ending = m.group(1).strip()
                m2 = re.search(r'Interest rate\s*=\s*(.+)', cell)
                if m2:
                    interest_rate = m2.group(1).strip()

    funds = []
    total_balance = 0
    total_interest = 0
    active_count = 0

    for row in ws.iter_rows(min_row=8, max_row=ws.max_row, values_only=True):
        if not any(cell is not None for cell in row):
            continue

        fund_num = row[1]
        description = row[3]
        avg_balance = row[4]
        alloc_interest = row[6]

        if fund_num is None or not isinstance(fund_num, (int, float)):
            continue
        if description and 'Exception' in str(description):
            continue

        fn = int(fund_num)
        bal = avg_balance if isinstance(avg_balance, (int, float)) else 0
        interest = alloc_interest if isinstance(alloc_interest, (int, float)) else 0

        if bal > 0:
            active_count += 1
        total_balance += bal
        total_interest += interest

        funds.append({
            'id': str(fn),
            'balance': bal,
            'interest': interest,
        })

    return {
        'period_ending': period_ending,
        'interest_rate': interest_rate,
        'macro': {
            'totalBalance': total_balance,
            'totalInterest': total_interest,
            'effectiveYield': interest_rate,
            'activeFunds': active_count,
        },
        'funds': funds,
    }


# ─────────────────────────────────────────────
# STEP 4: BUILD DASHBOARD JSON
# ─────────────────────────────────────────────

def build_dashboard_json(oip_data, revenue_data, fund_titles, gf_status=None,
                         budget_agencies=None, lfo_descriptions=None):
    """
    Assemble the final JSON structure that the React dashboard expects.

    Data sources:
      oip_data          — from OIP XLSX (fund balances, yields)
      revenue_data      — from Revenue News Release PDF (YTD actuals vs forecast)
      fund_titles       — from Fund Summary PDF (official fund names)
      gf_status         — from Legislature's live status.pdf (GF financial status)
      budget_agencies   — from biennial budget PDF Table 12 (agency appropriations)
      lfo_descriptions  — from LFO Directory PDFs (fund descriptions, statutory authority)
    """

    if lfo_descriptions is None:
        lfo_descriptions = {}

    # Merge fund titles and LFO descriptions into OIP fund data
    for fund in oip_data.get('funds', []):
        fid = fund['id']

        # Title: prefer Fund Summary title, fall back to LFO, then generic
        if fid in fund_titles and fund_titles[fid]:
            fund['title'] = fund_titles[fid]
        elif fid in lfo_descriptions:
            fund['title'] = lfo_descriptions[fid]['title']
        else:
            fund['title'] = f"Fund {fid}"

        # Description: from LFO Directory (permitted uses / revenue sources)
        if fid in lfo_descriptions:
            lfo = lfo_descriptions[fid]
            fund['description'] = lfo.get('description', '')
            fund['statutory_authority'] = lfo.get('statutory_authority', '')
            fund['agency_id'] = lfo.get('agency_id', '')
            fund['agency_name'] = lfo.get('agency_name', '')
            fund['program'] = lfo.get('program', '')

    # Hardcode descriptions for special funds that either aren't in the LFO Directory
    # or whose LFO entry is generic (Fund 10000 appears under multiple agencies with
    # "Money in the General Fund is unrestricted..." which is less useful than a real summary)
    special_fund_descriptions = {
        '10000': {
            'description': (
                'The primary operating fund of the State. Receives major tax revenues '
                '(income, sales) not earmarked for specific purposes. Used for education, '
                'health and human services, and general government operations.'
            ),
            'statutory_authority': 'Neb. Rev. Stat. §77-2715 et seq.',
        },
        '11000': {
            'description': (
                "Also known as the 'Rainy Day Fund.' Created as a separate and distinct fund "
                'to cover cash flow needs and to cushion the state against unexpected economic '
                'downturns and revenue shortfalls. Revenues in excess of the certified forecast '
                'are transferred from the General Fund at fiscal year-end.'
            ),
            'statutory_authority': 'Neb. Rev. Stat. §84-612.',
        },
    }
    for fund in oip_data.get('funds', []):
        if fund['id'] in special_fund_descriptions:
            for key, val in special_fund_descriptions[fund['id']].items():
                fund[key] = val

    # Build agencies list from scraped budget data, falling back to defaults
    if budget_agencies:
        agencies = []
        for a in budget_agencies:
            # Use GF FY25-26 total (Oper + Aid + Const from the Enacted 2025 columns)
            agencies.append({
                'id': a['id'],
                'name': a['name'],
                'appropriation': a['gf_fy2526'],
                'appropriation_next_fy': a['gf_fy2627'],
                'cash_fund': a['cf_fy2526'],
                'expended': None,  # Not available until end of fiscal year
                'category': 'operating',  # Could be refined by checking gf_by_type
            })
    else:
        # Fallback: 2026 biennial budget FY25-26 enacted amounts (manual)
        # Source: Table 12, 2026budget.pdf — "Enacted 2025 Session" column
        agencies = [
            {'id': '25', 'name': 'Health & Human Services',
             'appropriation': 2023307450, 'expended': None, 'category': 'operating'},
            {'id': '13', 'name': 'Education',
             'appropriation': 1344047035, 'expended': None, 'category': 'operating'},
            {'id': '51', 'name': 'University of Nebraska',
             'appropriation': 703683768, 'expended': None, 'category': 'operating'},
            {'id': '46', 'name': 'Correctional Services',
             'appropriation': 370355826, 'expended': None, 'category': 'operating'},
            {'id': '05', 'name': 'Supreme Court',
             'appropriation': 239362551, 'expended': None, 'category': 'operating'},
            {'id': '16', 'name': 'Revenue',
             'appropriation': 193621887, 'expended': None, 'category': 'operating'},
            {'id': '83', 'name': 'Community Colleges',
             'appropriation': 119116711, 'expended': None, 'category': 'operating'},
            {'id': '64', 'name': 'State Patrol',
             'appropriation': 90972703, 'expended': None, 'category': 'operating'},
            {'id': '50', 'name': 'State Colleges',
             'appropriation': 75078448, 'expended': None, 'category': 'operating'},
            {'id': '28', 'name': 'Veterans Affairs',
             'appropriation': 56368794, 'expended': None, 'category': 'operating'},
        ]

    # Build GF financial status — merge scraped data with defaults from biennial budget
    status_defaults = {
        'beginningBalance_FY2526': 515574973,
        'netRevenues_FY2526': 5292257023,
        'appropriations_FY2526': 5432560355,
        'endingBalance_FY2526': 375271641,
        'minimumReserve_variance': -125646757,
        'cashReserve_endingBalance': 828032779,
        'revenueGrowth_adjusted': '5.8%',
        'appropriationGrowth': '0.3%',
    }
    if gf_status:
        # Overlay any fields successfully parsed from the live status.pdf
        for k, v in gf_status.items():
            status_defaults[k] = v

    dashboard = {
        'lastUpdated': {
            'cash': oip_data.get('period_ending', 'Unknown'),
            'budget': 'March 2026',
            'revenue': revenue_data.get('period', 'Unknown') if revenue_data else 'N/A',
        },
        'macro': oip_data.get('macro', {}),
        'revenue': revenue_data or {},
        'funds': oip_data.get('funds', []),
        'gfTransfers': [
            {'target': 'School Property Tax Relief Fund', 'amount': 780000000,
             'note': 'LB 34 (2024 Sp. Session)'},
            {'target': 'Property Tax Credit Fund', 'amount': 422000000,
             'note': 'Property Tax Credit Act'},
            {'target': 'Community College Future Fund', 'amount': 271446476,
             'note': 'LB 243 (2023) certified amount'},
            {'target': 'Education Future Fund', 'amount': 242000000,
             'note': 'Constitutional allocation'},
        ],
        'agencies': agencies,
        'generalFundStatus': status_defaults,
        # LFO Directory fund descriptions — lookup table for Fund Explorer tooltips
        # Keys are fund IDs, values have title, description, statutory_authority, agency info
        'fundDescriptions': lfo_descriptions,
    }

    return dashboard


# ─────────────────────────────────────────────
# STEP 5: PUSH TO GOOGLE SHEET
# ─────────────────────────────────────────────

def push_to_sheet(dashboard_json, sheet_id=None):
    """
    Write dashboard JSON to a local file, and optionally push to Google Sheets.
    """
    output_path = 'dashboard_data.json'
    with open(output_path, 'w') as f:
        # Keep the local file nicely formatted for human reading
        json.dump(dashboard_json, f, indent=2, default=str)

    print(f"\n✅ Dashboard JSON written to: {output_path}")
    print(f"   Total funds: {len(dashboard_json.get('funds', []))}")
    print(f"   Total balance: ${dashboard_json['macro'].get('totalBalance', 0):,.2f}")
    print(f"   Revenue data: {'✅ Included' if dashboard_json.get('revenue', {}).get('ytdActual') else '⚠️ Not available'}")
    print(f"   Agency data: {len(dashboard_json.get('agencies', []))} agencies (from biennial budget)")
    print(f"   Fund descriptions: {len(dashboard_json.get('fundDescriptions', {}))} (from LFO Directory)")

    if sheet_id:
        print(f"\n📊 Pushing data to Google Sheet {sheet_id}...")
        try:
            from google.oauth2 import service_account
            from googleapiclient.discovery import build

            SCOPES = ['https://www.googleapis.com/auth/spreadsheets']
            creds = service_account.Credentials.from_service_account_file(
                'credentials.json', scopes=SCOPES)

            service = build('sheets', 'v4', credentials=creds)

            # 1. Minify the JSON to save massive amounts of space (removes indenting/spaces)
            json_string = json.dumps(dashboard_json, separators=(',', ':'), default=str)

            # 2. Chop the string into chunks of 40,000 characters to bypass the 50k limit
            chunk_size = 40000
            chunks = [json_string[i:i+chunk_size] for i in range(0, len(json_string), chunk_size)]
            
            # 3. Format as rows for Column A: [[chunk1], [chunk2], [chunk3]...]
            values = [[chunk] for chunk in chunks]

            # 4. Clear the sheet first to remove any old trailing chunks
            service.spreadsheets().values().clear(
                spreadsheetId=sheet_id, 
                range='Sheet1'
            ).execute()

            # 5. Push the new chunks into the sheet starting at A1
            body = {'values': values}
            result = service.spreadsheets().values().update(
                spreadsheetId=sheet_id,
                range='Sheet1!A1',
                valueInputOption='RAW',
                body=body
            ).execute()

            print(f"  ✅ Successfully updated {result.get('updatedCells')} cells with data chunks.")

        except ImportError:
            print("  ❌ Missing Google API libraries. Run: pip install google-api-python-client google-auth")
        except Exception as e:
            print(f"  ❌ Failed to update Google Sheet: {e}")

    return output_path


# ─────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Nebraska Budget Dashboard Scraper')
    parser.add_argument('--month', type=str, help='Target month as YYYY-MM (default: prior month)')
    parser.add_argument('--sheet-id', type=str, help='Google Sheet ID to push data to')
    parser.add_argument('--dry-run', action='store_true', help='Skip downloads, test with existing files')
    parser.add_argument('--stats-only', action='store_true',
                        help='Fetch only revenue statistics XLSX files (skip OIP, PDFs)')
    parser.add_argument('--discover-urls', action='store_true',
                        help='Print XLSX URLs found on each stats page, then exit')
    args = parser.parse_args()

    # ── URL discovery mode (quick diagnostic) ──
    if args.discover_urls:
        print("═══════════════════════════════════════════════════")
        print("  Revenue Statistics XLSX Discovery")
        print("═══════════════════════════════════════════════════\n")
        for cat, page_url in REVENUE_STATS_PAGES.items():
            print(f"📊 {cat.upper()} — {page_url}")
            urls = discover_stats_xlsx_urls(cat)
            if urls:
                for url in urls:
                    print(f"   → {url}")
            else:
                print(f"   (no XLSX links found)")
            print()
        return

    year, month, month_name = get_target_month(args.month)
    print(f"═══════════════════════════════════════════════════")
    print(f"  Nebraska Public Budget Dashboard — Data Scraper")
    print(f"  Target period: {month_name} {year}")
    print(f"═══════════════════════════════════════════════════\n")

    work_dir = tempfile.mkdtemp(prefix='ne_budget_')
    print(f"Working directory: {work_dir}\n")

    oip_path = None
    fund_path = None
    rev_path = None
    gf_status_path = None
    stats_files = {}

    if not args.stats_only:
        # ── Fetch OIP ──
        print("📊 Step 1: Fetching OIP Report...")
        oip_path = fetch_oip(year, month, work_dir) if not args.dry_run else None

        # ── Fetch Fund Summary ──
        print("\n📋 Step 2: Fetching Fund Summary...")
        fund_path = fetch_fund_summary(year, month, work_dir) if not args.dry_run else None

        # ── Fetch Revenue News Release ──
        print("\n💰 Step 3a: Fetching Revenue Release PDF...")
        rev_path = fetch_revenue_release(year, month, month_name, work_dir) if not args.dry_run else None

        # ── Fetch GF Financial Status ──
        print("\n🏛️  Step 3c: Fetching GF Financial Status (Legislature)...")
        gf_status_path = fetch_gf_status(work_dir) if not args.dry_run else None

    # ── Fetch Revenue Statistics XLSX ──
    print("\n📈 Step 3b: Fetching Revenue Statistics XLSX files...")
    if not args.dry_run:
        stats_files = fetch_revenue_stats_xlsx(work_dir)
        successful = sum(1 for p in stats_files.values() if p)
        print(f"  ✅ Downloaded {successful}/{len(stats_files)} stats files")

    # ── Fetch Biennial Budget Report ──
    budget_path = None
    print("\n📑 Step 3d: Fetching Biennial Budget Report...")
    if not args.dry_run:
        budget_path = fetch_biennial_budget(year, work_dir)
        if not budget_path:
            budget_path = fetch_biennial_budget(year - 1, work_dir)

    # ── Fetch LFO Directory (fund descriptions) ──
    lfo_paths = []
    print("\n📖 Step 3e: Fetching LFO Directory of Programs and Funds...")
    if not args.dry_run:
        # LFO Directory is published in odd years; try current year then prior
        for try_year in [year, year - 1, year - 2]:
            lfo_paths = fetch_lfo_directory(try_year, work_dir)
            if lfo_paths:
                break

    # ── Parse ──
    print("\n🔧 Step 4: Parsing data...")
    oip_data = {}
    fund_titles = {}
    revenue_data = {}
    gf_status = {}
    stats_data = {}
    budget_agencies = []
    lfo_fund_descriptions = {}

    if oip_path and oip_path.endswith('.xlsx'):
        try:
            oip_data = parse_oip_for_dashboard(oip_path)
            print(f"  ✅ OIP: {len(oip_data.get('funds', []))} funds parsed")
        except Exception as e:
            print(f"  ❌ OIP parse error: {e}")

    if fund_path:
        try:
            from build_oip_tracker import extract_fund_titles
            fund_titles = extract_fund_titles(fund_path)
            print(f"  ✅ Fund titles: {len(fund_titles)} titles extracted")
        except ImportError:
            print("  ⚠️ build_oip_tracker.py not in path — skipping title extraction")

    if rev_path:
        try:
            revenue_data = parse_revenue_pdf(rev_path)
            if revenue_data.get('ytdActual'):
                print(f"  ✅ Revenue: YTD actual ${revenue_data['ytdActual']:,}")
            else:
                print("  ⚠️ Revenue PDF parsed but no YTD totals extracted")
                print("     → PDF table parsing may need manual review")
        except Exception as e:
            print(f"  ❌ Revenue parse error: {e}")

    if gf_status_path:
        try:
            gf_status = parse_gf_status_pdf(gf_status_path)
            if gf_status:
                print(f"  ✅ GF Status: {len(gf_status)} fields extracted from Legislature PDF")
            else:
                print("  ⚠️ GF Status PDF parsed but no fields extracted")
        except Exception as e:
            print(f"  ❌ GF Status parse error: {e}")

    if budget_path:
        try:
            budget_agencies = parse_biennial_budget_agencies(budget_path)
            print(f"  ✅ Budget: {len(budget_agencies)} agency appropriations extracted")
        except Exception as e:
            print(f"  ❌ Budget parse error: {e}")

    if lfo_paths:
        try:
            lfo_fund_descriptions = parse_lfo_directory(lfo_paths)
            print(f"  ✅ LFO Directory: {len(lfo_fund_descriptions)} fund descriptions extracted")
        except Exception as e:
            print(f"  ❌ LFO Directory parse error: {e}")

    if stats_files:
        for cat, fpath in stats_files.items():
            if not fpath:
                continue
            try:
                records = parse_revenue_stats_xlsx(fpath, cat)
                stats_data[cat] = records
                print(f"  ✅ Stats ({cat}): {len(records)} monthly records")
            except Exception as e:
                print(f"  ❌ Stats ({cat}) parse error: {e}")

    # ── Build JSON ──
    print("\n📦 Step 5: Building dashboard JSON...")
    dashboard = build_dashboard_json(oip_data, revenue_data, fund_titles,
                                     gf_status=gf_status,
                                     budget_agencies=budget_agencies,
                                     lfo_descriptions=lfo_fund_descriptions)

    # ── Output ──
    print("\n📤 Step 6: Writing output...")
    push_to_sheet(dashboard, args.sheet_id)

    print(f"\n{'═' * 51}")
    print(f"  Done! Review dashboard_data.json before deploying.")
    print(f"{'═' * 51}")


if __name__ == '__main__':
    main()
