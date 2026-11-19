# Sola Mnemosyne v0.3.10 — configurable archivist output budget

Public source-code-only release. No private character names, RP excerpts, archives, or keys are included.

- The `Бюджет контекста` input controls ONLY how much memory the main roleplay model receives; any user-customized value is preserved.
- A new separate `Лимит вывода архивариуса` input controls the separate model's completion budget, default 8192. Existing hidden default of 2200 migrates once to 8192; custom values are preserved.
- Chat extraction now processes pairs of source messages, requests no more than 20 concise atomic facts per job, and retries malformed JSON once with a larger completion budget. If a paired request is still malformed, the two original messages are tried separately. Successful jobs are committed independently and never erased on later failure.
- No truncated/empty JSON is marked processed. The provider's content-policy refusals are not circumvented. Archive text and original recaps remain untouched.
- If a provider uses extensive hidden/visible reasoning, even 8192 completion tokens may be insufficient. Consider a non-reasoning archival model or increase the output limit only to what the provider supports.

**Back up your archive JSON locally, never upload it to public GitHub.** Update extension source files and reload. No re-import, reindex or reset is needed. Real provider integration remains to be validated in SillyTavern.
