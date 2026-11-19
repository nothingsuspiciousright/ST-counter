# Sola Mnemosyne v0.3.12 — GitHub release

Independent SillyTavern RP memory extension with optional cheaper archivist profile.

## Changes

- Adjustable 4K–50K approximate **input** token budget for archivist jobs, independent of RP injection budget and model output token budget.
- Cooperative **Stop indexing** and **Resume from first unprocessed source** controls, per-chat progress, exact failed batch ID and index.
- In-world event-date/time extraction hints and source-header date display without guessing missing dates.
- Canonical location grouping in shelf UI while retaining all individual facts and citations in the archive.
- Splitting large input batches on context-length errors; existing malformed-JSON recovery retained.
- Source and full recap preservation unchanged. Public test data are synthetic.

## Privacy and testing

No personal roleplay exports, stored API keys or user archives are included. The code is suitable for a public GitHub repository; keep memory exports private. Pure JavaScript tests run via `npm test`. Browser integration with your specific SillyTavern build and model proxy must still be tested before relying on automatic memory or disabling Summarize. A provider can still reject or truncate large model requests; 50K is an upper bound, not a guaranteed prompt size.

## Update

Export your archive, replace repository files with the contents of this ZIP (manifest.json must be at repository root), update the SillyTavern extension, and refresh the page. No re-import is needed for this code update.
