---
name: xlsx
description: Create, inspect, or transform spreadsheets while preserving data, formulas, and the user's requested workbook structure.
category: Documents
tags: [spreadsheets, xlsx, csv, data-analysis]
triggers: [spreadsheet, Excel, XLSX, CSV, pivot table, formulas]
argument-hint: Describe the input data, calculations, workbook structure, and desired output
version: "1.0.0"
author: DiveeOI
compatibility: Original DiveeOI guidance. Spreadsheet operations require compatible tooling already installed; do not assume Python, LibreOffice, or an Office application is available.
---

# Spreadsheets

Use this skill when a spreadsheet is the primary input or output. Respect the user's requested format, sheets, columns, formulas, and data definitions.

## Workflow

1. Confirm the source file, goal, audience, output format, important sheets/columns, and whether formulas or displayed values should be preserved.
2. Inspect the workbook using available tools. Do not assume a parser, spreadsheet engine, or Excel application is installed. Ask before installing a dependency.
3. Plan transformations and calculations before editing. Preserve source data; do not silently remove rows, change units, coerce identifiers, or overwrite formulas.
4. Make the smallest changes needed. Use clear sheet and field names, consistent units, appropriate number/date formats, and formulas where requested.
5. Validate row and column counts, key totals, formula references, missing values, and output format. Recalculate formulas only if a calculation engine is available; otherwise state that cached formula values may be stale.
6. Save the output to the requested location, keep the original unchanged unless authorized, and summarize checks and any limitations.

Never infer missing data as fact. Flag assumptions and preserve privacy when handling personal or financial spreadsheets.
