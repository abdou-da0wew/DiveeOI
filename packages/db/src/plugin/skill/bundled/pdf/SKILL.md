---
name: pdf
description: Read, summarize, create, or transform PDF documents using tools available in the current project, with clear limits around extraction and visual verification.
category: Documents
tags: [pdf, documents, reading, conversion]
triggers: [read PDF, create PDF, convert PDF, merge PDFs, split PDF, fill PDF]
argument-hint: Describe the source file, requested operation, and desired output
version: "1.0.0"
author: DiveeOI
compatibility: Original DiveeOI guidance. PDF text extraction, OCR, rendering, and generation require suitable tools already installed; do not assume a specific package or runtime.
---

# PDF Documents

Use this skill for PDF reading, summarization, creation, conversion, or basic document operations. First identify whether the user needs extracted text, visual inspection, an accessible digital document, or print-ready output.

## Workflow

1. Confirm the source file, target operation, language, page range, output path, and any layout or accessibility needs.
2. Inspect the PDF with available file tools. For scanned pages, tables, forms, or complex layouts, use OCR or rendering only if available; distinguish extracted text from visual verification.
3. Preserve the original source. Do not overwrite or distribute a document unless the user requested it.
4. For new PDFs, choose an available export path that matches the document's needs. If no PDF-capable tool is installed, provide the source content in a usable format and explain the limitation.
5. Review page order, clipping, links, tables, font coverage, and selectable text where the renderer permits. Do not claim that a PDF is accessible or print-ready without checking.
6. For sensitive, legal, medical, financial, or official documents, preserve source language carefully and identify content that requires human review.

Never run embedded scripts, macros, or attachments from a PDF. Do not install dependencies without the user's approval.
