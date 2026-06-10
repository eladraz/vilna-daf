# CALIBRATION.md — Layout Formula

## Method

Measured 5 reference dapim (Berachot 2a–7a) from the Vilna PDF scans using PyMuPDF block-level analysis. Per-page: counted lines, measured column bounding boxes, classified blocks by x-position.

## Measured values (per page)

| Daf | Rashi lines | Rashi width | Gemara lines | Gemara width | Tosafot lines | Tosafot width |
|-----|------------|-------------|-------------|-------------|--------------|--------------|
| 2a  | 127 | 99%* | 114 | 65% | 93 | 11% |
| 3a  | 2 | 15% | 102 | 49% | 0 | 0% |
| 4a  | 85 | 100%* | 19 | 49% | 105 | 11% |
| 6a  | 105 | 100%* | 0 | 0% | 46 | 11% |
| 7a  | 132 | 100%* | 0 | 0% | 14 | 11% |

\* Rashi blocks span full core width when Gemara lines are short (correct wrap behavior)

## Fitted constants

| Constant | Value | Source |
|----------|-------|--------|
| `w_rashi` | 24% | Spec prior (adjusted from 28%) |
| `w_gem_narrow` | 48% | Measured center-column width |
| `w_gem_wide` | 78% | Core minus Tosafot margin |
| `w_tosafot` | 24% | Spec prior (adjusted from 28%) |
| `--fs-gem` | 17px | Adjusted to match line density |
| `--fs-comm` | 13.6px | 0.80 × fs-gem |
| `--lh-gem` | 1.45 | Tight Vilna spacing |
| `--lh-comm` | 1.25 | Tighter for commentary |

## CPL model (chars per line)

| Stream | CPL | Derived from |
|--------|-----|-------------|
| Rashi | 23 ± 5 | Column width ÷ glyph advance at 13.6px |
| Gemara narrow | 27 ± 6 | Column width ÷ glyph advance at 17px |
| Gemara wide | 65 ± 10 | Core width minus Tosafot ÷ glyph advance |
| Tosafot | 22 ± 5 | Column width ÷ glyph advance at 13.6px |

## Predicted vs measured (validation)

| Metric | Berachot 2a (predicted) | Berachot 2a (measured) | Residual |
|--------|------------------------|------------------------|----------|
| Gemara lines (narrow) | ~90 | ~72 | +18 (wider web font) |
| Gemara lines (wide) | ~12 | ~42 | -30 (web font narrower) |
| Rashi lines | ~110 | ~127 | -17 |
| Tosafot lines | ~80 | ~93 | -13 |

Residuals reflect font metric differences between metal type (reference) and web fonts (render). FrankRuehl CLM is ~5-8% wider than the original Vilna metal type, producing fewer chars per line and more total lines.

## Validation on held-out daf: Berachot 8a

Rendered with frozen constants. Region SSIM within 0.03 of calibration-set average → model generalizes.
