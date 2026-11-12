# Ingestion fixtures

All fixtures are **synthetic** (no citizen data). Generated once and committed so tests are deterministic.

| File | How it was made | Purpose |
|---|---|---|
| `searchable-english-3page.pdf` | pdfkit | multi-page text PDF; complaint continues across pages |
| `searchable-telugu-2page.pdf` | pdfkit + Noto Sans Telugu (conjunct-free text) | clean Telugu text layer; complaint p1, response p2 |
| `damaged-conjunct-telugu-1page.pdf` | pdfkit + Noto Sans Telugu | Telugu conjuncts: glyphs have no Unicode mapping → must go to OCR |
| `chrome-damaged-telugu-2page.pdf` | headless Chrome print-to-PDF | same hazard from a different producer (silently lost letters) |
| `scanned-telugu-2page.pdf` | Chrome screenshot → image-only PDF (no text layer) | scanned printed Telugu incl. conjuncts, for OCR |
| `encrypted.pdf` | pdfkit, user password | password-protected PDF must be rejected |
