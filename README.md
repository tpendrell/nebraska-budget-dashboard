# Nebraska Public Budget Dashboard

A React/Vite dashboard built from official Nebraska budget publications. The data
pipeline writes `public/dashboard_data.json`, so the site can run on GitHub Pages
without a database, Google Sheet, Apps Script, or paid web host.

## Official sources

- DAS State Accounting: monthly Operating Investment Pool average daily balances
  and allocated interest
- Nebraska Department of Revenue: monthly General Fund net receipts
- Nebraska Legislature: General Fund Financial Status, biennial budget report,
  and Legislative Fiscal Office fund directory
- Nebraska State Spending: current fiscal-year agency appropriations by fund type
- U.S. Census Bureau: the population estimate used for per-capita calculations

Each section carries its own source URL and reporting period. Source failures retain
the last known-good section and add a visible warning instead of replacing valid data
with zeros or guessed values.

## Local development

```bash
npm ci
npm run dev
```

Run parser tests:

```bash
python -m unittest discover -s tests -v
```

Refresh the public JSON (requires `pdftotext` and `openpyxl`):

```bash
python scraper_automation.py --output public/dashboard_data.json
```

Use `--month YYYY-MM` for a reproducible historical cutoff. Google Sheets export is
still available as an optional compatibility path through `--sheet-id`, but it is no
longer required by the application.

## Free deployment

`deploy_pages.yml` builds and deploys the site to GitHub Pages on each push to
`main`. `monthly_scraper.yml` checks official sources every Friday, validates the
data and production build, and commits a changed snapshot back to the repository.

In repository settings, choose **GitHub Actions** as the Pages source. A custom
domain can then point at the GitHub Pages site; GitHub Pages supports HTTPS at no
hosting charge.
