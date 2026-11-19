# Sola Mnemosyne v0.3.11 — safe per-chat full reset

- Adds a destructive **full reset** for only the currently opened RP chat,
  with a warning and mandatory `СБРОС` typed confirmation.
- Creates and binds a brand-new empty archive before deleting the old one.
  Removes all per-chat facts, imported books, sources, original recaps, processing
  markers, error records and read flags from Mnemosyne. Does not delete ST chat
  history or other chats. The main preset and archivist Connection Profile persist.
- Attempts to delete this exact archive's last known server backup. An error is
  surfaced if IndexedDB or server cleanup is incomplete. Existing private JSON
  exports downloaded on the user's device cannot be removed by the extension.
- A reset remains empty across reloads: no automatic refill or paid extraction starts until the first explicit rescan.
- To rebuild, explicitly scan the current chat and start extracting facts, then
  optionally reimport the old Memory Book. No silent mass API operation begins
  after reset.
- Full reset cannot be undone except by importing a prior private backup.

**Public code contains no private RP content, personal names or API keys.**
