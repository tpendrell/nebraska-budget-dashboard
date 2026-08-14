import tempfile
import unittest
from datetime import date
from pathlib import Path

from openpyxl import Workbook

import scraper_automation as scraper


class DiscoveryTests(unittest.TestCase):
    def test_fiscal_period_converts_to_calendar_month(self):
        self.assertEqual(scraper.fiscal_period_to_calendar(2026, 12), date(2026, 6, 30))
        self.assertEqual(scraper.fiscal_period_to_calendar(2027, 1), date(2026, 7, 31))

    def test_oip_discovery_uses_latest_real_link(self):
        links = [
            scraper.Link('https://das.nebraska.gov/x/Operating_Investment_Pool_OIP_Report_2026-11.xlsx', 'May'),
            scraper.Link('https://das.nebraska.gov/x/Operating_Investment_Pool_OIP_Report_2026-12.xlsx', 'June'),
            scraper.Link('https://das.nebraska.gov/x/Operating_Investment_Pool_OIP_Report_2026-12.pdf', 'June PDF'),
        ]
        period, documents = scraper.discover_oip(links)
        self.assertEqual(period, date(2026, 6, 30))
        self.assertEqual(set(documents), {'xlsx', 'pdf'})


class ParserTests(unittest.TestCase):
    def test_oip_uses_allocated_interest_column_not_business_unit(self):
        workbook = Workbook()
        sheet = workbook.active
        sheet.append(['Interest Rate', '3.14175%'])
        sheet.append([])
        sheet.append(['Fund', 'Fund Title', 'Average Daily Balance', 'Allocated Interest', 'Interest Business Unit'])
        for index in range(10):
            sheet.append([10000 + index, f'Fund {index}', 1_000_000 + index, -2_500 - index, 99_000_000 + index])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'oip.xlsx'
            workbook.save(path)
            result = scraper.parse_oip_xlsx(path)
        self.assertEqual(result['funds'][0]['interest'], -2509)
        self.assertLess(abs(result['macro']['totalInterest']), 100_000)
        self.assertEqual(result['macro']['effectiveYield'], '3.14175%')

    def test_gf_status_accepts_positive_current_reserve_variance(self):
        text = '''
General Fund Financial Status
                             FY24-25 FY25-26 FY26-27 FY27-28 FY28-29
Unobligated Beginning Balance 1,804,550,647 515,325,828 321,501,557 337,014,453 (85,322,462)
General Fund Net Revenues 4,462,629,700 5,253,552,022 5,330,135,495 5,028,339,930 5,343,102,103
General Fund Appropriations 5,474,665,244 5,428,345,624 5,314,622,599 5,445,676,845 5,577,802,362
Ending Balance 792,515,104 340,532,226 337,014,453 (80,322,462) (320,022,721)
Minimum Reserve at 3% 0 0 330,763,183 0 311,896,791
Excess / (Shortfall) 0 0 6,251,270 0 (631,919,511)
'''
        result = scraper.parse_gf_status_text(text, date(2026, 8, 14))
        self.assertEqual(result['status']['fiscalYear'], 'FY2026-27')
        self.assertEqual(result['status']['minimumReserveVariance'], 6_251_270)
        self.assertEqual(result['status']['followingBienniumVariance'], -631_919_511)

    def test_gf_status_parses_numbered_current_status_rows_and_dash_cells(self):
        text = '''
General Fund Financial Status
FY2024-25 FY2025-26 FY2026-27 FY2027-28 FY2028-29
7 Unobligated Beginning Balance 1,804,550,647 792,515,104 100,248,458 115,761,354 (306,575,561)
18 General Fund Net Revenues 4,462,629,700 5,012,261,589 5,330,135,495 5,028,339,930 5,343,102,103
21 General Fund Appropriations 5,474,665,244 5,506,214,791 5,314,622,599 5,445,676,845 5,577,802,362
23 $ Ending Balance 792,515,104 298,561,902 115,761,354 (301,575,561) (541,275,820)
25 Excess (shortfall) from Minimum Reserve -- (208,556,477) -- (846,728,346) --
6 Projected Unobligated Ending Balance 877,079,779 829,532,779 526,032,779 476,032,779 426,032,779
'''
        result = scraper.parse_gf_status_text(text, date(2026, 8, 14))
        self.assertEqual(result['status']['fiscalYear'], 'FY2026-27')
        self.assertEqual(result['status']['minimumReserveVariance'], -208_556_477)
        self.assertEqual(result['status']['followingBienniumVariance'], -846_728_346)
        self.assertEqual(result['status']['cashReserveProjectedEndingBalance'], 526_032_779)

    def test_revenue_parser_uses_net_cumulative_columns(self):
        text = '''
Gross Receipts
Sales and Use Tax 300,000,000 250,000,000 50,000,000
Net Receipts
Sales and Use Tax 256,910,556 231,325,000 25,585,556 256,910,556 231,325,000 25,585,556
Individual Income Tax 84,104,984 101,764,000 (17,659,016) 84,104,984 101,764,000 (17,659,016)
Corporate Income Tax 13,063,554 21,963,000 (8,899,446) 13,063,554 21,963,000 (8,899,446)
Miscellaneous 19,175,941 18,605,000 570,941 19,175,941 18,605,000 570,941
Total Net Receipts 373,255,035 373,657,000 (401,965) 373,255,035 373,657,000 (401,965)
The estimates use the February 27, 2026 NEFAB forecast.
'''
        result = scraper.parse_revenue_text(text, 'July 2026')
        self.assertEqual(result['ytdActual'], 373_255_035)
        self.assertEqual(result['ytdForecast'], 373_657_000)
        self.assertEqual(result['categories'][0]['actual'], 256_910_556)

    def test_agencies_include_all_fund_types(self):
        rows = ''.join(
            f'<tr><td>Agency {i}</td><td>$1,000,000</td><td>$200,000</td><td>$10,000</td>'
            f'<td>$500,000</td><td>$50,000</td><td>$1,760,000</td></tr>'
            for i in range(12)
        )
        html = f'''<h1>Fiscal Year 2026-2027</h1><table><tr><th>Agency</th><th>General</th>
        <th>Cash</th><th>Construction</th><th>Federal</th><th>Revolving</th><th>Total</th></tr>{rows}</table>'''
        agencies, fiscal_year = scraper.parse_agency_budget_html(html)
        self.assertEqual(fiscal_year, 'FY2026-27')
        self.assertEqual(agencies[0]['all_funds'], 1_760_000)
        self.assertEqual(agencies[0]['federal_fund'], 500_000)


if __name__ == '__main__':
    unittest.main()
