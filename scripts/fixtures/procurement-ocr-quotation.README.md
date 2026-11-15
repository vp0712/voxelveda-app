# Immutable procurement OCR fixture

`procurement-ocr-quotation.png` contains synthetic test text only:

```text
FIXTURE QUOTATION
Description        Quantity
Fixture steel plate       2
```

It is a 1100 × 340 white PNG with black 42-pixel DejaVu Sans text, drawn at
`(35,65)`, `(35,140)` and `(35,215)` using the existing canvas fixture layout.
The image was generated once with an explicitly registered DejaVu Sans font.
No font file is distributed or embedded in the PNG. DejaVu Sans permits
redistribution of rendered output; the fixture contains no third-party logo,
company data or employee/customer information.

SHA-256: `fb072f0097ebc4b49be5d4f0f2c1c0bd2d5386c8a44e5821fa295890ec033edb`.
The reviewed source contains 10,645 pixels with all RGB channels below 128.

The test reads these exact checked-in bytes, checks their hash and dimensions,
and still runs the real local OCR decoder, Tesseract, confidence/word-position
assertions, image-only PDF, mixed native/scanned PDF and page-limit tests.
There is no mocked OCR result or weakened unreadable-source validation.

The failing CI run reported `IMPORT_OCR_NO_TEXT` for its runtime-rendered PNG.
The exact runner-specific cause has not been established. Pinning the source
removes runtime font rendering as an unrelated variable; a successful local
fixture or the prior fixture's success does not establish the failed runner's
font state or constitute a production OCR repair.
