# Tesseract language data

`tel.traineddata` (Telugu, 2.7 MB) and `eng.traineddata` (English, 4.0 MB) are the **tessdata_fast** integer models from
https://github.com/tesseract-ocr/tessdata_fast (Apache-2.0). They are bundled so OCR runs fully offline inside Lambda.

* `tessdata_best` (float) models were tried and do **not** work with the tesseract.js 7 WASM core
  (`missing function DotProductSSE`), so they are not used.
* English is required alongside Telugu: Telugu-only recognition garbled Latin labels such as "Case ID" (24.9% error vs 0.0%).
