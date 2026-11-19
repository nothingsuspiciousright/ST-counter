# Sola Mnemosyne v0.3.9 — safe extraction failure handling

This is a publicly shareable CODE-ONLY release. It does **not** contain user archives, private messages, keys, or real roleplay examples.

- Provider content policy refusal: mark the affected batch as `blocked`, preserve all original sources unmodified, continue processing subsequent batches. This never attempts to bypass the provider's refusal.
- A generic `API request failed` is **not** classified as a policy block, because the provider's underlying cause might be transient.
- New button: **Пропустить ошибочный пакет (оригинал сохранить)**. Explicit user confirmation; works only for a batch that has already failed. The skipped batch remains visibly counted and can still be searched locally.
- Diagnostics now include structural validation and a separate quality-audit summary (facts derived from imported sources vs chat, blocked batches, unprocessed selected sources, potential key variants, short imported documents).
- Classification instructions distinguish promises from offers, objects from events, and knowledge from ordinary observed actions. Existing erroneous imported facts are **not automatically rewritten**.
- Source archive, original recap texts, and all conversation swipe variants remain unchanged. No automatic reindex on upgrade.

**Important:** The quality warnings do not determine the correct canonical state automatically. Review suspicious promise statuses and NPC knowledge against original messages. Archive consistency and literary correctness are different tests.

Update via GitHub extension repository, preserving your local archive; export a backup before upgrading. Do not upload personal archive JSON files into the public repository. Run `npm test` to validate the pure logic. Real provider/SillyTavern integration remains unverified.
