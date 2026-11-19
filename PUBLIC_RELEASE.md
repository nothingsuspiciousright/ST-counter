# Sola Mnemosyne v0.3.7 — Structured Memory Fix (public build)

This distribution contains only extension source, neutral synthetic tests, documentation and static assets. **Do not add** RP logs, Memory Book exports, connection profiles, API tokens or IndexedDB exports to a public repository.

## Changes

- Memory Book originals are now kept under **Inheritance → Stored sources**, not mixed into the semantic shelves. The complete imported text is preserved.
- Promises: explicit `unknown / pending / fulfilled / broken / cancelled` status and stable `entity_key` for updates. Historical versions remain sourced. Never auto-assume fulfillment.
- Independent **Story Arcs** shelf, with planned/active/completed/paused/abandoned/unknown statuses. Ongoing plot threads remain separate.
- NPC knowledge: explicit holder and knows/believes/suspects/unaware; reader-only secrets stay separate. Unsupported knowledge entries are rejected.
- Bullet-sized legacy extraction units, designed to keep inventory items and individual quotes separate; prompts additionally discourage treating an entire paragraph as one item.
- **Re-index entire old book** button: stages new facts in persistent local state and only replaces legacy classifications after every source succeeds. Resumable after API/JSON failure. Original import and live-chat facts are retained.
- Auto processing still counts *new assistant replies*, not complete chat history. Interval 1 causes an extraction attempt after each new answer, raising API usage.
- Original 20 tests plus 5 new tests pass locally. This is not a full SillyTavern integration test; validate injection and model behavior on a copy of a chat before disabling Summarize.

## Upgrade from v0.3.5

1. Export your archive as a private JSON backup from within the extension. Never upload it to GitHub.
2. Replace repository files from this ZIP, update the extension, reload SillyTavern.
3. Under Inheritance choose **Re-index entire old book**. This makes paid requests and can take multiple calls; the old facts remain visible until it finishes.
4. Review Promises, NPC Knowledge, Items, Secrets, Quotes, Story Arcs and Diagnostics. "Unknown" is intentional when the source is silent.
5. Keep Summarize enabled until the new indexing and context injection have been verified with your real RP.

- Per-chat shelf read receipts; silver new and gold changed badges.
- Preserve status revisions even if model repeats identical promise wording.
- No RP excerpts, names, chat data or API keys bundled.


### v0.3.8 — Full source recaps
The read-only **Full recap** shelf displays archived recap bodies unchanged; this costs no model calls and does not overwrite source messages or Memory Book. 30 records per page; per-chat unread markers use short signatures.
