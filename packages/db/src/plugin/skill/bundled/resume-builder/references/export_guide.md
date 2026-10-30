# Resume Export Guide

## Recommended Combination

- **Primary for applications**: docx (the format HR accepts directly) + pdf (the final version, to protect the layout)
- **Backup**: md (for your own iteration, and for GitHub)

## docx Export (default)

Call the docx skill. Template priority:
1. User-provided template → use the user's
2. `assets/resume_template.docx` exists → use this skill's
3. Neither → use the docx skill's default styles (watch font, line spacing, margins)

Style parameters (recommended defaults):
- Serif fonts: Source Han Serif / SimSun / Microsoft YaHei (very likely installed on HR machines)
- Latin fonts: Arial / Helvetica / Calibri
- Font size: body 10.5-11pt, headings 12-14pt, name 16-18pt
- Line spacing: 1.15-1.3
- Margins: 1.5cm top/bottom, 1.8cm left/right
- Color: all black + one low-saturation accent color (dark blue / dark gray)

## pdf Export

**Recommended**: docx → libreoffice headless → pdf

```bash
libreoffice --headless --convert-to pdf <input.docx> --outdir <out_dir>
```

**Not recommended**: drawing from scratch with reportlab / weasyprint — the result looks bad and font pitfalls abound.

## markdown Export

The simplest option: suggested file name `resume_<yourname>_<YYYYMM>.md`, e.g. `resume_zhangsan_202605.md`.

## File Naming Advice

The file name matters enormously when applying (many HR search by file name):

`<Name>_<TargetRole>_<X Years Experience>.<ext>`

Example: `Zhang_San_Senior_Product_Manager_5years.pdf`

Never name it `final.pdf`, `final_v2.pdf`, or `revised.docx` — HR will find it unprofessional.

## Metadata Cleanup (pdf)

Call the pdf skill to clean metadata (author, creating tool), avoiding leakage of the original Word template's origin (some templates leave strings like "WPS resume template v3.2").

## Privacy & Safety

- Resumes **should not include ID numbers, home addresses, or emergency contacts by default**
- Only add them if the role (investment banking / civil service / state-owned enterprises, etc.) explicitly requires it
- If the user's uploaded resume contains these, **proactively delete them and notify the user** when exporting the new version
