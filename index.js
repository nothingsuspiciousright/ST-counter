
import { getContext } from "../../../extensions.js";
import { eventSource, event_types } from "../../../../script.js";
import { getTokenCountAsync } from "../../../tokenizers.js";

function cleanModelName(model) {
    if (!model) return "";
    return String(model).split('/').pop();
}

// 1. Подсветка транзишенов внутри рекапа
function highlightRecapBrackets(mesElement) {
    const detailsList = mesElement.querySelectorAll('.mes_text details');

    detailsList.forEach(details => {
        if (details.dataset.bracketsHighlighted === "true") return;

        const walker = document.createTreeWalker(
            details,
            NodeFilter.SHOW_TEXT,
            null
        );

        const textNodes = [];
        let node;

        while ((node = walker.nextNode())) {
            if (
                node.parentElement &&
                node.parentElement.tagName !== 'SUMMARY' &&
                /\[[^\]]+\]/.test(node.nodeValue)
            ) {
                textNodes.push(node);
            }
        }

        textNodes.forEach(textNode => {
            const frag = document.createDocumentFragment();
            const parts = textNode.nodeValue.split(/(\[[^\]]+\])/g);

            parts.forEach(part => {
                if (part.startsWith('[') && part.endsWith(']')) {
                    const span = document.createElement('span');
                    span.className = 'st-recap-bracket';
                    span.textContent = part;
                    frag.appendChild(span);
                } else if (part) {
                    frag.appendChild(document.createTextNode(part));
                }
            });

            textNode.parentNode.replaceChild(frag, textNode);
        });

        details.dataset.bracketsHighlighted = "true";
    });
}

// 2. Форматирование переходов, дневников и записок
function formatMainTextTransitions(mesElement) {
    const mesText = mesElement.querySelector('.mes_text');
    if (!mesText) return;

    const TRANSITION_KEYS =
        "TIMESKIP|DATE CHANGE|TIME OF DAY CHANGE|" +
        "WEATHER CHANGE|LOCATION CHANGE|POV CHANGE|" +
        "INTERLUDE|MEANWHILE|FLASHBACK|DREAM|MEMORY|" +
        "DISPLAY|WORLDBUILDING|RUMOR|NEWS|FORESHADOW|" +
        "SPECULATION|FACTS|TRIVIA|DIARY|NOTE|LETTER";

    const walker = document.createTreeWalker(
        mesText,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode(node) {
                if (!node.parentElement) {
                    return NodeFilter.FILTER_REJECT;
                }

                if (
                    node.parentElement.closest(
                        'details, pre, code, .st-scene-divider, .st-paper-card'
                    )
                ) {
                    return NodeFilter.FILTER_REJECT;
                }

                // Поддержка обычных пробелов и U+2800 от Gemini
                if (
                    /\[[A-Z\s\u2800]+|\{(?:diary|letter|note)/i.test(
                        node.nodeValue
                    )
                ) {
                    return NodeFilter.FILTER_ACCEPT;
                }

                return NodeFilter.FILTER_SKIP;
            }
        }
    );

    const nodesToProcess = [];
    let current;

    while ((current = walker.nextNode())) {
        nodesToProcess.push(current);
    }

    const transRegex = new RegExp(
        `(\\[(?:${TRANSITION_KEYS})\\]?\\s*[-–—:]\\s*END\\]|\\[(?:${TRANSITION_KEYS})\\s*[-–—:]\\s*[^\\]]+\\]|\\[(?:${TRANSITION_KEYS})\\]|\\{(?:diary|letter)\\|[^}]+\\}|\\{note\\s+[^}]+\\})`,
        "gi"
    );

    nodesToProcess.forEach(textNode => {
        // FIX: Gemini использует U+2800 вместо пробелов.
        // Нормализуем только содержимое квадратных скобок.
        // Обычный литературный текст не затрагиваем.
        const text = textNode.nodeValue.replace(
            /\[[^\]\r\n]*\]/g,
            tag => tag.replace(/\u2800/g, ' ')
        );

        transRegex.lastIndex = 0;

        if (!transRegex.test(text)) return;

        transRegex.lastIndex = 0;

        const frag = document.createDocumentFragment();
        const parts = text.split(transRegex);

        parts.forEach(part => {
            if (!part) return;

            const trimmed = part.trim();

            // А) Закрывающий тег [MEANWHILE - END]
            if (/^\[.*[-–—:]\s*END\]$/i.test(trimmed)) {
                const div = document.createElement('div');
                div.className = 'st-scene-divider st-scene-end';
                div.innerHTML = `<span>✦</span>`;
                frag.appendChild(div);
            }

            // Б) Открывающий переход [TYPE - описание]
            else if (
                /^\[([A-Z\s]+?)\s*[-–—:]\s*([^\]]+)\]$/i.test(trimmed)
            ) {
                const m = trimmed.match(
                    /^\[([A-Z\s]+?)\s*[-–—:]\s*([^\]]+)\]$/i
                );

                const type = m[1].trim().toUpperCase();
                const desc = m[2].trim();

                const div = document.createElement('div');
                div.className = 'st-scene-divider';

                const showTypeTag = ![
                    'TIMESKIP',
                    'LOCATION CHANGE',
                    'TIME OF DAY CHANGE',
                    'DATE CHANGE',
                    'WEATHER CHANGE'
                ].includes(type);

                const tagHtml = showTypeTag
                    ? `<span class="st-trans-tag">${type} ·</span>`
                    : '';

                div.innerHTML = `<span>✦ ${tagHtml}${desc} ✦</span>`;
                frag.appendChild(div);
            }

            // В) Одиночный переход [FLASHBACK]
            else if (
                new RegExp(`^\\[(${TRANSITION_KEYS})\\]$`, 'i')
                    .test(trimmed)
            ) {
                const label = trimmed.slice(1, -1).trim();

                if (
                    ['DIARY', 'NOTE', 'LETTER']
                        .includes(label.toUpperCase())
                ) {
                    return;
                }

                const div = document.createElement('div');
                div.className = 'st-scene-divider';

                div.innerHTML =
                    `<span>✦ <span class="st-trans-tag">${label}</span> ✦</span>`;

                frag.appendChild(div);
            }

            // Г) Дневник или письмо
            else if (/^\{(diary|letter)\|([^}]+)\}$/i.test(trimmed)) {
                const m = trimmed.match(
                    /^\{(diary|letter)\|([^}]+)\}$/i
                );

                const fields = m[2].split('|').map(s => s.trim());
                const [
                    date = '',
                    content = '',
                    loc = '',
                    sign = ''
                ] = fields;

                const card = document.createElement('div');
                card.className = 'st-paper-card';

                card.innerHTML = `
                    <div class="st-paper-header">
                        <span>✦ ${date}</span>
                        <span>${loc}</span>
                    </div>
                    <div class="st-paper-body">${content}</div>
                    ${sign ? `<div class="st-paper-sign">— ${sign}</div>` : ''}
                `;

                frag.appendChild(card);
            }

            // Д) Записка
            else if (/^\{note\s+([^}]+)\}$/i.test(trimmed)) {
                const m = trimmed.match(
                    /^\{note\s+([^}]+)\}$/i
                );

                const card = document.createElement('div');
                card.className = 'st-paper-card';

                card.innerHTML =
                    `<div class="st-paper-body">✦ ${m[1].trim()}</div>`;

                frag.appendChild(card);
            }

            else {
                frag.appendChild(document.createTextNode(part));
            }
        });

        textNode.parentNode.replaceChild(frag, textNode);
    });
}

// 3. Счётчик токенов, рекапа и модель
async function renderMessageStats(messageId) {
    const context = getContext();

    if (
        !context ||
        !context.chat ||
        !context.chat[messageId]
    ) return;

    const message = context.chat[messageId];
    if (message.is_user) return;

    const mesElement = document.querySelector(
        `.mes[mesid="${messageId}"]`
    );

    if (!mesElement) return;

    highlightRecapBrackets(mesElement);
    formatMainTextTransitions(mesElement);

    const rawText = message.mes || "";

    // Общее количество токенов
    let totalTokens = message.extra?.token_count;

    if (!totalTokens || totalTokens <= 2) {
        try {
            totalTokens = await getTokenCountAsync(rawText);
        } catch {
            totalTokens = Math.round(rawText.length / 3.5);
        }
    }

    // Рекап <en>...</en>
    const enRegex = /<en>([\s\S]*?)<\/en>/gi;

    let match;
    let enContent = "";

    while ((match = enRegex.exec(rawText)) !== null) {
        enContent += match[1] + "\n";
    }

    let recapTokens = 0;

    if (enContent.trim().length > 0) {
        try {
            recapTokens = await getTokenCountAsync(
                enContent.trim()
            );
        } catch {
            recapTokens = Math.round(
                enContent.trim().length / 4
            );
        }
    }

    // Название модели
    const rawModel =
        message.extra?.model ||
        message.gen_model ||
        (message.is_user ? "" : (message.extra?.api || ""));

    const modelName = cleanModelName(rawModel);

    // Метаданные в шапке
    let badge = mesElement.querySelector(
        '.st-recap-meta-badge'
    );

    if (!badge) {
        badge = document.createElement('div');
        badge.className = 'st-recap-meta-badge';

        const chName = mesElement.querySelector('.ch_name');
        if (!chName) return;

        chName.insertAdjacentElement('beforeend', badge);
    }

    let parts = [];

    if (recapTokens > 0) {
        parts.push(
            `<span>${totalTokens}t (recap: ${recapTokens}t)</span>`
        );
    } else {
        parts.push(`<span>${totalTokens}t</span>`);
    }

    if (modelName) {
        parts.push(
            `<span title="${rawModel}">${modelName}</span>`
        );
    }

    badge.innerHTML =
        `<span style="opacity:0.5;">·</span> ` +
        parts.join(
            ` <span style="opacity:0.5;">·</span> `
        );
}

// 4. Повторная проверка видимых сообщений
function processVisibleMessages() {
    const mesElements = document.querySelectorAll(
        '#chat .mes[mesid]'
    );

    mesElements.forEach(el => {
        // FIX: Повторное форматирование транзишенов.
        // Счётчик токенов не блокирует обработку.
        highlightRecapBrackets(el);
        formatMainTextTransitions(el);

        if (!el.querySelector('.st-recap-meta-badge')) {
            const id = Number(el.getAttribute('mesid'));

            if (!isNaN(id)) {
                renderMessageStats(id);
            }
        }
    });
}

// 5. События SillyTavern
jQuery(() => {
    eventSource.on(
        event_types.CHAT_CHANGED,
        () => setTimeout(processVisibleMessages, 300)
    );

    eventSource.on(
        event_types.MESSAGE_RECEIVED,
        (id) => setTimeout(
            () => renderMessageStats(id),
            500
        )
    );

    eventSource.on(
        event_types.MESSAGE_UPDATED,
        (id) => setTimeout(
            () => renderMessageStats(id),
            300
        )
    );

    eventSource.on(
        event_types.MESSAGE_SWIPED,
        (id) => setTimeout(
            () => renderMessageStats(id),
            300
        )
    );

    eventSource.on(
        event_types.CHARACTER_MESSAGE_RENDERED,
        (id) => setTimeout(
            () => renderMessageStats(id),
            600
        )
    );

    if (event_types.GENERATION_ENDED) {
        eventSource.on(
            event_types.GENERATION_ENDED,
            () => {
                const context = getContext();

                if (
                    context &&
                    context.chat &&
                    context.chat.length > 0
                ) {
                    setTimeout(
                        () => renderMessageStats(
                            context.chat.length - 1
                        ),
                        400
                    );
                }
            }
        );
    }

    const chatEl = document.getElementById('chat');

    if (chatEl) {
        const observer = new MutationObserver(() => {
            processVisibleMessages();
        });

        observer.observe(chatEl, {
            childList: true
        });
    }

    setTimeout(processVisibleMessages, 800);
});

// 6. Live transitions: current streaming message only.
import { streamingProcessor as stLiveProcessor } from "../../../../script.js";

jQuery(() => {
    if (!event_types.STREAM_TOKEN_RECEIVED) return;

    let target = null;
    let processor = null;
    let frame = null;
    const options = { childList: true, subtree: true, characterData: true };
    const observer = new MutationObserver(queueRender);

    function stop() {
        observer.disconnect();
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
        target = null;
        processor = null;
    }

    function queueRender() {
        if (!target || frame !== null) return;
        frame = requestAnimationFrame(() => {
            frame = null;
            const text = target;
            if (!text?.isConnected || processor !== stLiveProcessor) {
                stop();
                return;
            }
            const message = text.closest('.mes[mesid]');
            if (!message) {
                stop();
                return;
            }
            // Do not observe our own DOM replacements.
            observer.disconnect();
            try {
                formatMainTextTransitions(message);
            } catch (error) {
                console.warn('[ST-counter] Live transition rendering failed', error);
            } finally {
                if (target === text && text.isConnected) {
                    observer.observe(text, options);
                }
            }
        });
    }

    function watchStream() {
        const active = stLiveProcessor;
        const id = active?.messageId;
        if (!active || active.type === 'impersonate' ||
            !Number.isInteger(id) || id < 0 || active.isStopped ||
            active.abortController?.signal.aborted) return;

        const message = document.querySelector(`#chat .mes[mesid="${id}"]`);
        const text = message?.querySelector('.mes_text');
        if (!text || message.getAttribute('is_user') === 'true') return;
        if (target === text && processor === active) return;

        stop();
        target = text;
        processor = active;
        observer.observe(text, options);
        queueRender();
    }

    // ST emits this event before updating the rendered streaming text.
    eventSource.on(event_types.STREAM_TOKEN_RECEIVED, watchStream);

    for (const event of [
        event_types.GENERATION_STARTED,
        event_types.GENERATION_ENDED,
        event_types.GENERATION_STOPPED,
        event_types.CHAT_CHANGED,
    ]) {
        if (event) eventSource.on(event, stop);
    }
});
