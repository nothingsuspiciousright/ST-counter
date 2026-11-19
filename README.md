# ✦ Sola Mnemosyne · Deep Memory

**Independent, structured, vector-free RP memory for SillyTavern.** A browser-side extension designed for long-running roleplay, with an optional *separate, cheaper* Connection Profile to extract facts from chat messages. It does **not** replace or modify your RP preset, chat text, Summarize, or world books.

> Version 0.3.5 — installable preview. Pure archive logic has automated tests. The SillyTavern integration and your provider's Connection Profile must be verified in your own installation before you disable existing memory. **Keep Summarize enabled until the migration check passes.**

## Key features

- **Independent archives per saved chat** with original user/assistant messages and all known swipes; only active swipes are considered in retrieved facts.
- **Memory inheritance:** import existing Summarize Memory Book from detected text, paste, or a `.txt` / `.md` file. The exact original file text is preserved; its paragraphs are indexed into chronology, people, relationships, promises, items, knowledge, locations, secrets, quotes, and other shelves. Reimporting the same content is idempotent. For deeper extraction, use the separate **Глубокая разметка** action after choosing your archivist profile; this may incur additional model fees.
- **An independent archivist model:** choose an existing SillyTavern **Connection Profile**. The extension calls it separately; your active RP model stays unchanged. Without a profile, archive import and deterministic retrieval can still be used, but new AI-extracted facts won't be generated.
- **Automatic AI extraction in batches:** every N new assistant replies (default 40), archive the new messages and extract source-linked, structured facts. Auto-update is enabled by default after selecting a separate archivist profile. Only **new replies written after Mnemosyne is first enabled in a chat** enter automatic processing; manually processing older history is available with a separate button to avoid unplanned API charges.
- **Context injection with a fixed approximate budget:** deterministic keyword/field matching, no vectors or lorebooks. In automatic RP mode retrieval is **silent continuity**: it supports present behavior rather than prompting flashbacks. A character-name match may supply one short, optional **character-texture** detail from a sourced event, but never the entire old scene. Full historical records require specific scene cues or a request to remember. Retrieved history is never an instruction to narrate a recollection. Historical records remain in the immutable archive even when not injected.
- **Separate knowledge:** extracted records distinguish confirmed events, NPC beliefs and possible future developments; `reader-only` secrets do not automatically become NPC knowledge.
- **GitHub-installable UI:** subtle silver panels with browsable shelves, full-text source search, import, diagnostics, JSON export and recovery.
- **Quiet success toast:** three-second silver notification for committed extracted facts, Memory Book import, or manual archive sync. No sound, vibration or toast after ordinary RP turns; can be disabled in settings.
- **No external archive cloud:** the data lives in browser IndexedDB with full JSON export and optional snapshots to your own SillyTavern server under `data/<user>/user/files/` (the server must support its built-in upload endpoint). Only your chosen archivist API receives content for extraction.

## Install via your own GitHub repository

1. Create a **new repository** on GitHub named, for example, `Sola-Mnemosyne`.
2. Upload **the contents of this folder to the repository root** (`manifest.json`, `index.js`, `settings.html`, `style.css`, `src/` etc.). Do not commit personal RP text, keys or exported archives.
3. In SillyTavern: **Extensions → Install Extension** (wording varies) → paste your repository's `https://github.com/<account>/Sola-Mnemosyne` address.
4. Open a saved chat; in Extensions settings, expand **Sola Mnemosyne**.
5. Select the connection profile of a cheap model and adjust budget, batch interval, backups and notifications.
6. For an existing RP, first use **Наследие → Найти Memory Book** or import a saved `.md` / `.txt`. Review indexed shelves and **Диагностика → Проверить** before enabling prompt injection. Export a full backup.
7. Turn on **Добавлять память в контекст RP**. Only after reviewing the output and testing old memories should you disable Summarize's competing prompt injection. Mnemosyne never modifies Summarize itself.

**Important:** Install the entire folder to repository root. Do not upload just the ZIP as a single asset; SillyTavern expects `manifest.json` in the repository root. You can also copy the directory into the local SillyTavern third-party extensions folder if preferred.

## How data flows

```text
Saved chat (including active/alternate swipes)
         │
         ├── raw source archive, immutable records
         ├── existing Memory Book → one-time inheritance shelves
         │
         └── cheap model / Connection Profile → sourced fact batches
                                       │
                    deterministic lookup + source checking
                                       │
                              bounded RP prompt injection
                                       │
                              your original RP model
```

## Silent continuity, not constant flashbacks

Mnemosyne is the archivist, **not a second director**. Retrieved records should influence how an NPC reacts, what they know, the state of an object, existing promises or ongoing relationships, **without** being retold aloud. The injected prompt explicitly forbids gratuitous flashbacks, nostalgia, quoted memories and lore lectures. Full old events are retrieved only when concrete scene cues justify them or the player explicitly asks to remember; one brief associative cue may support character consistency. A five-generation cooldown prevents sending character-texture reminders on every turn, without delaying directly relevant factual retrieval. Manual archive search remains broader. This is a prompt and retrieval safeguard, not a guarantee that every downstream model will always obey.

## Auto-update and quiet notification

Mnemosyne stores each new answer immediately in the local raw-source archive. When **40 new assistant answers** have accumulated since the last extraction (adjustable), it asynchronously calls the selected cheaper Connection Profile to write sourced memories. If the API fails, none of the failed batch is marked done; it will retry on a subsequent trigger or manual run. The counter is based on pending unprocessed answers, not overall chat length. New incoming RP replies are not blocked waiting for indexing.

To stop automatic extraction, untick **Автоматически обновлять воспоминания**. Prompt injection has its own switch. The two controls are independent.

## Quiet update notification

Notification: **✦ Мнемозина обновила память · +12 фактов**. It appears in the bottom corner for about 3 seconds and can be dismissed with a tap. It respects reduced-motion OS settings, works on narrow mobile screens and does not use sounds or haptics. You can switch it off under `Тихое уведомление об успешном обновлении памяти`.

A failed batch never triggers the success notification. If extraction has committed to the local archive but a remote snapshot fails, the facts remain saved and the log explains that the backup still needs attention. Server snapshots are not encrypted; use a private SillyTavern server and keep your exports private.

## Reliability and limitations

- Imported books are preserved in their full original text, but automatic **semantic classification of every paragraph is not guaranteed**. The deterministic importer categorizes by headings/keywords and may put uncertain fragments on `Прочее`. Review your shelves before retiring old memory.
- Plain deterministic lookup cannot guarantee retrieval of every old nuance on an unrelated future turn. It avoids the uncertainty of vector similarity but cannot magically expose unlimited text to a fixed context.
- The **token budget is approximate**, derived from character length, not a provider tokenizer. Check actual provider prompt itemization for precise costs.
- Historical memory snapshots are **not encrypted** by the extension. Access to SillyTavern/browser storage and access to the selected archivist provider are relevant to confidentiality. Back up your archive before clearing Chrome app data or replacing devices.
- The current version stores raw sources and prompt data in IndexedDB; server snapshot syncing uploads the **entire** archive. Very large histories incur storage / upload costs; do not assume unlimited phone storage.
- APIs differ between SillyTavern releases and proxies. The `ConnectionManagerRequestService` and interception integration are designed against current public APIs but are not live-tested against your specific installation.
- The initial chat archive may be large; use **Обработать новые события** manually for existing chats to control initial API consumption.

## Diagnostics

In **Диагностика**, you can inspect link consistency, counts, server sync state and whether your archivist profile is selected. The journal records extraction failures and backup failures. Failed batches are not marked processed, so they can be retried.

## Developer checks

Node.js 20+:

```bash
npm test
```

No third-party JS packages or build step are needed.

## License

MIT. This repository contains extension code only. **Never commit your RP transcript or Memory Book to a public GitHub repository.**

## v0.3.4 — Deep-inheritance JSON recovery

Deep Memory Book indexing now sends small legacy-fragment jobs (no more than two short paragraphs), requires compact valid JSON, and retries invalid model responses twice. If a two-fragment batch cannot be parsed, Mnemosyne retries each fragment individually. Successful results are committed per job; a failed job remains pending for the next run. The original Memory Book text, stored source fragments and already completed jobs are not replaced. No generated text from failed model responses is persisted in logs.

**After an error in v0.3.3:** update the installed GitHub extension, reload SillyTavern, return to the same chat, and click “Глубокая разметка старой Memory Book” again. Do **not** import the book a second time and do **not** disable Summarize until health checks and live generation tests succeed. Repeated API calls may cost extra; this patch improves recovery but cannot guarantee every provider follows JSON syntax.

## v0.3.7 — Long memory text UI fix

Memory shelves and source search now use scoped, accessible expandable rows instead of browser-native `<details>` elements. Long imported paragraphs remain scrollable within each row and can no longer overlap the following records/footer when a SillyTavern theme overrides native disclosure styles. Archive storage, parsing, retrieval and prompt injection are unchanged. No migration or re-import is needed.


## Структурированная память (v0.3.7)

Тематические полочки показывают **только отдельные факты** архивариуса. Исходные фрагменты старой Memory Book доступны во вкладке «Наследие» → «Сохранённые первоисточники». Сведения из исходника не теряются. Отдельная кнопка «Переразметить ВСЮ старую книгу» заново индексирует старый импорт небольшими порциями и заменяет прежние классификации только при полном успехе. Учитывай возможную стоимость запросов к архивариусу.

Обещания теперь имеют статусы `unknown`, `pending`, `fulfilled`, `broken`, `cancelled`, а арки — `planned`, `active`, `completed`, `paused`, `abandoned`, `unknown`. Статусы привязываются к конкретному событию и его источнику; без свидетельств завершения обещание не помечается выполненным. Knowledge NPC хранится отдельно от reader-only секретов. Прежде чем отключать Summarize, проверь результат на копии чата.

## Непрочитанные обновления (v0.3.7)

В полочках для каждого чата раздельно показываются новые записи (серебристая ✦) и изменения прежних состояний (золотистый ◆). При открытии полочки записи подсвечиваются; отметки «непрочитано» только этой полочки исчезают, но подсветка в текущем просмотре остаётся. Отслеживание опирается на стабильный `entity_key`, если архивариус его возвращает. Если модель не привязала исправление к прежнему объекту, запись может определиться как новая. Исходные факты и старые версии статусов сохраняются.


## v0.3.9 — Полные recap снова на полочках

- Новая самостоятельная полочка **«Полные recap»** показывает целиком тело каждого recap из сохранённых ответов ассистента. Никакого пересказа и новых платных запросов.
- Записи связаны с конкретным сообщением и выбранным свайпом; просмотр исходников доступен отдельно через поиск и полный архив.
- Просмотр по 30 записей с кнопкой загрузки следующих 30, чтобы не создавать десятки тысяч элементов интерфейса сразу.
- Серебристые/золотистые индикаторы новых и изменённых recap работают отдельно для каждого чата; снимок прочитанного хранит только контрольную подпись, не копию текста.
- Это **виртуальная полочка** из `archive.sources[].raw`: повторно импортировать Memory Book или запускать дешёвую модель не требуется.
- Если старые recap не были захвачены архивом, нажмите **«Обновить архив из чата»**. Сведения, отсутствовавшие в оригинальном чате, расширение восстановить не может.
- Полные recap хранятся вне постоянного промпта; только небольшой контекстный фрагмент может быть извлечён при достаточно конкретной связи с текущей сценой. Он подчиняется общему бюджету.


### v0.3.9 — when an archivist provider refuses source content

A provider may return an explicit safety/content-policy refusal. Mnemosyne **does not bypass** that response: it archives the full original source locally, marks the batch `blocked`, continues with the other batches, and reports the missed coverage in Diagnostics. This is not a success status and no model-generated facts are fabricated for blocked messages. A generic API error is treated as unknown and processing pauses.

If your provider only exposes `API request failed` and the same batch cannot be processed, download a backup first, then use **Пропустить ошибочный пакет (оригинал сохранить)**. It intentionally leaves a gap in *structured* memory but does not destroy raw story text or complete recap. The manual action is available only for a batch that failed previously, and requires confirmation. Diagnostics show the number of such gaps.

**Quality audit:** Open Diagnostics → Check. Besides archive integrity, the `quality` field describes imported-vs-chat fact counts and source processing gaps. These warnings do not automatically edit or merge RP canon.

## v0.3.10 — independent archivist output limit

The *RP context budget* (`contextTokens`) limits injection into your RP model. The *archivist output limit* (`maxTokens`) limits tokens the separate model can use to produce reasoning plus structured JSON, as enforced by the API/provider. These are different. The archivist output setting is now visible, default 8192. Older hidden 2200-token settings are automatically raised once; user-configured RP context limits are not modified. Chat source batches are smaller and malformed JSON receives a larger-token retry, then is split into separate messages if needed. Never record incomplete results as successful extraction. API refusal still leaves affected originals safely archived and unprocessed.


## Full memory reset for the current chat (v0.3.11)

In **Diagnostics**, click **Очистить ВСЮ память текущего чата**. First download
(and verify) a private full-archive JSON backup. Confirm the warning, then enter
`СБРОС` exactly. The command creates a new empty archive identity for that chat,
detaches and deletes the old local IndexedDB archive and removes its known
SillyTavern server snapshot (where accessible). Deletion failures are explicitly
reported, not hidden. Downloaded JSON backups must be deleted manually if desired.

This removes ALL Mnemosyne information for the selected chat: imported Memory
Books, atomic facts, full raw sources (and their virtual complete recap shelf),
processing states and blocked batches, staged reindex work, read receipts and
diagnostics. It does **not** delete messages/swipes in SillyTavern, affect other
chat archives, change the main RP preset, erase the archivist profile, or disable
Summarize. Any persistent historic server backups that are not referenced by
the old archive pointer must be handled separately.

A reset stays empty even after reloading SillyTavern: scanning and model requests are paused until you explicitly rescan.

To start over: click **Обновить архив из чата** to read all accessible raw chat
messages (no API calls), then **Обработать новые события** to extract facts using
the selected archivist model (may consume paid quota). If you want the previous
Memory Book too, import it again on the **Наследие** tab.
