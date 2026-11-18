
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

// 2. Транзишены в основном тексте
function formatMainTextTransitions(mesElement) {
    const mesText = mesElement.querySelector('.mes_text');
    if (!mesText) return;

    // Транзишены могут быть разбиты HTML-разметкой на
    // несколько текстовых узлов.
    // Пробел U+2800 тоже поддерживается.

    const KEYS = [
        'TIMESKIP',
        'DATE CHANGE',
        'TIME OF DAY CHANGE',
        'WEATHER CHANGE',
        'LOCATION CHANGE',
        'POV CHANGE',
        'INTERLUDE',
        'MEANWHILE',
        'FLASHBACK',
        'DREAM',
        'MEMORY',
        'DISPLAY',
        'WORLDBUILDING',
        'RUMOR',
        'NEWS',
        'FORESHADOW',
        'SPECULATION',
        'FACTS',
        'TRIVIA',
        'DIARY',
        'NOTE',
        'LETTER'
    ];

    const keyPattern = KEYS
        .sort((a, b) => b.length - a.length)
        .join('|');

    const transitionPattern = new RegExp(
        `\\[\\s*(${keyPattern})\\s*(?:[-–—:]\\s*([^\\]\\r\\n]{1,250}))?\\]`,
        'gi'
    );

    const paperPattern =
        /\{(?:diary|letter)\|[^}\r\n]+\}|\{note\s+[^}\r\n]+\}/gi;

    // НОВОЕ:
    // Произвольные заголовки сцен в квадратных скобках.
    // Например:
    // [День выпуска и распределения по командам]
    //
    // Скобки должны занимать отдельную строку.

    const sceneTitlePattern =
        /^[ \t]*\[([^\[\]\r\n]{2,180})\][ \t]*\r?$/gm;

    const protectedSelector =
        'details, pre, code, .st-scene-divider, .st-paper-card';

    // Разделяем сообщение на логические текстовые области.

    const scopes = new Map();

    const walker = document.createTreeWalker(
        mesText,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode(node) {
                if (
                    !node.parentElement ||
                    node.parentElement.closest(protectedSelector)
                ) {
                    return NodeFilter.FILTER_REJECT;
                }

                return NodeFilter.FILTER_ACCEPT;
            }
        }
    );

    let node;

    while ((node = walker.nextNode())) {
        const parent = node.parentElement;

        const scope =
            parent.closest('p, li, blockquote') ||
            parent.closest('section, article, ru, div') ||
            mesText;

        if (!scopes.has(scope)) {
            scopes.set(scope, []);
        }

        scopes.get(scope).push(node);
    }

    // Создание красивого разделителя

    function createTransition(type, description) {
        const el = document.createElement('div');
        el.className = 'st-scene-divider';

        const inner = document.createElement('span');

        if (
            description &&
            description.trim().toUpperCase() === 'END'
        ) {
            el.classList.add('st-scene-end');
            inner.textContent = '✦';
        } else {
            inner.append('✦ ');

            const showType = ![
                'TIMESKIP',
                'LOCATION CHANGE',
                'TIME OF DAY CHANGE',
                'DATE CHANGE',
                'WEATHER CHANGE',
                'SCENE'
            ].includes(type) || !description;

            if (showType) {
                const label = document.createElement('span');
                label.className = 'st-trans-tag';

                label.textContent = description
                    ? `${type} ·`
                    : type;

                inner.appendChild(label);

                if (description) {
                    inner.append(' ');
                }
            }

            if (description) {
                inner.append(
                    document.createTextNode(description.trim())
                );
            }

            inner.append(' ✦');
        }

        el.appendChild(inner);
        return el;
    }

    // Оформление дневников, писем и записок

    function createPaper(token) {
        const isNote = /^\{note\s/i.test(token);

        const card = document.createElement('div');
        card.className = 'st-paper-card';

        if (isNote) {
            const body = document.createElement('div');
            body.className = 'st-paper-body';

            body.textContent =
                `✦ ${token.slice(1, -1)
                    .replace(/^note\s+/i, '')
                    .trim()}`;

            card.appendChild(body);
        } else {
            const fields = token
                .slice(1, -1)
                .split('|')
                .slice(1)
                .map(s => s.trim());

            const [
                date = '',
                content = '',
                loc = '',
                sign = ''
            ] = fields;

            const header = document.createElement('div');
            header.className = 'st-paper-header';

            const left = document.createElement('span');
            left.textContent = `✦ ${date}`;

            const right = document.createElement('span');
            right.textContent = loc;

            header.append(left, right);

            const body = document.createElement('div');
            body.className = 'st-paper-body';
            body.textContent = content;

            card.append(header, body);

            if (sign) {
                const signature = document.createElement('div');
                signature.className = 'st-paper-sign';

                signature.textContent = `— ${sign}`;
                card.appendChild(signature);
            }
        }

        return card;
    }

    // Обработка всех текстовых областей сообщения

    for (const [scope, nodes] of scopes) {
        const originalText = nodes
            .map(n => n.nodeValue)
            .join('');

        if (
            !originalText.includes('[') &&
            !originalText.includes('{')
        ) {
            continue;
        }

        // Нормализация U+2800 только для поиска.
        // Исходный текст сообщения не меняется.

        const text = originalText.replace(/\u2800/g, ' ');

        const matches = [];

        // Существующие именованные транзишены

        transitionPattern.lastIndex = 0;

        for (const m of text.matchAll(transitionPattern)) {
            const type = m[1]
                .replace(/\s+/g, ' ')
                .trim()
                .toUpperCase();

            const description = m[2]
                ? m[2].trim()
                : '';

            matches.push({
                start: m.index,
                end: m.index + m[0].length,
                element:
                    ['DIARY', 'NOTE', 'LETTER'].includes(type) &&
                    !description
                        ? null
                        : createTransition(type, description)
            });
        }

        // Дневники, записки и письма

        paperPattern.lastIndex = 0;

        for (const m of text.matchAll(paperPattern)) {
            matches.push({
                start: m.index,
                end: m.index + m[0].length,
                element: createPaper(m[0])
            });
        }

        // НОВОЕ:
        // Произвольные [заголовки сцен].
        //
        // Работает и для сообщений пользователя.
        // Не перехватывает уже найденные переходы.

        sceneTitlePattern.lastIndex = 0;

        for (const m of text.matchAll(sceneTitlePattern)) {
            const title = m[1].trim();

            if (
                !/[\p{L}]/u.test(title) ||
                /^(?:x| |-|PASS|WARN|N\/A)$/i.test(title)
            ) {
                continue;
            }

            const start =
                m.index + m[0].indexOf('[');

            const end =
                m.index + m[0].lastIndexOf(']') + 1;

            // Защита от двойного оформления

            if (
                matches.some(existing =>
                    start < existing.end &&
                    end > existing.start
                )
            ) {
                continue;
            }

            matches.push({
                start,
                end,
                element: createTransition('SCENE', title)
            });
        }

        if (!matches.length) continue;

        matches.sort((a, b) => b.start - a.start);

        // Поиск позиции символа среди текстовых узлов

        function locate(offset, endBoundary) {
            let cursor = 0;

            for (let i = 0; i < nodes.length; i++) {
                const length = nodes[i].nodeValue.length;

                if (
                    offset < cursor + length ||
                    (
                        endBoundary &&
                        offset === cursor + length
                    )
                ) {
                    return {
                        node: nodes[i],
                        offset: offset - cursor
                    };
                }

                cursor += length;
            }

            const last = nodes[nodes.length - 1];

            return {
                node: last,
                offset: last.nodeValue.length
            };
        }

        // Замены справа налево

        for (const match of matches) {
            const from = locate(match.start, false);
            const to = locate(match.end, true);

            if (
                !from.node.isConnected ||
                !to.node.isConnected
            ) {
                continue;
            }

            const range = document.createRange();

            range.setStart(from.node, from.offset);
            range.setEnd(to.node, to.offset);

            // Если весь абзац состоит из перехода,
            // заменяем абзац целиком.

            if (
                match.element &&
                scope.tagName === 'P' &&
                text.trim() ===
                    text.slice(match.start, match.end).trim()
            ) {
                scope.replaceWith(match.element);
                break;
            }

            range.deleteContents();

            if (match.element) {
                range.insertNode(match.element);
            }
        }
    }
}

// 3. Счётчик токенов и статистика сообщений

async function renderMessageStats(messageId) {
    const context = getContext();

    if (
        !context ||
        !context.chat ||
        !context.chat[messageId]
    ) {
        return;
    }

    const message = context.chat[messageId];

    const mesElement = document.querySelector(
        `.mes[mesid="${messageId}"]`
    );

    if (!mesElement) return;

    // Оформление работает и для пользовательских сообщений

    highlightRecapBrackets(mesElement);
    formatMainTextTransitions(mesElement);

    // Но токеновая статистика добавляется только AI

    if (message.is_user) return;

    const rawText = message.mes || "";

    // Общее число токенов

    let totalTokens = message.extra?.token_count;

    if (!totalTokens || totalTokens <= 2) {
        try {
            totalTokens = await getTokenCountAsync(rawText);
        } catch {
            totalTokens = Math.round(rawText.length / 3.5);
        }
    }

    // Подсчёт токенов в recap

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
        message.extra?.api ||
        "";

    const modelName = cleanModelName(rawModel);

    // Статистика возле имени

    let badge = mesElement.querySelector(
        '.st-recap-meta-badge'
    );

    if (!badge) {
        badge = document.createElement('div');
        badge.className = 'st-recap-meta-badge';

        const chName = mesElement.querySelector('.ch_name');

        if (!chName) return;

        chName.insertAdjacentElement(
            'beforeend',
            badge
        );
    }

    const parts = [];

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

// 4. Оформление всех видимых сообщений

function processVisibleMessages() {
    const mesElements =
        document.querySelectorAll('#chat .mes[mesid]');

    mesElements.forEach(el => {
        // Обрабатываем сообщения независимо от того,
        // добавлен ли уже счётчик токенов.

        highlightRecapBrackets(el);
        formatMainTextTransitions(el);

        if (!el.querySelector('.st-recap-meta-badge')) {
            const id = Number(
                el.getAttribute('mesid')
            );

            if (!isNaN(id)) {
                renderMessageStats(id);
            }
        }
    });
}

// 5. Подключение к событиям SillyTavern


jQuery(() => {
    const chatEl = document.getElementById('chat');
    const dirtyMessages = new Set();

    const observerOptions = {
        childList: true,
        characterData: true,
        subtree: true,
    };

    let observer = null;
    let liveTimer = null;

    // Живое оформление только изменённых сообщений.
    function flushLiveFormatting() {
        liveTimer = null;

        if (!chatEl || !observer) return;

        // Защита от бесконечной перерисовки.
        observer.disconnect();

        try {
            for (const el of dirtyMessages) {
                if (!el.isConnected) continue;

                const mesText = el.querySelector('.mes_text');
                if (!mesText) continue;

                const text = mesText.textContent || '';

                // Обрабатываем только завершённые маркеры.
                if (
                    text.includes(']') ||
                    text.includes('}')
                ) {
                    formatMainTextTransitions(el);
                }
            }
        } catch (error) {
            console.warn(
                '[ST Counter] Live transitions:',
                error
            );
        } finally {
            dirtyMessages.clear();

            if (chatEl.isConnected) {
                observer.observe(chatEl, observerOptions);
            }
        }
    }

    function queueMessage(el) {
        if (
            !el ||
            !el.isConnected ||
            !el.matches('.mes[mesid]')
        ) return;

        dirtyMessages.add(el);

        if (liveTimer !== null) return;

        // Не чаще одного обновления за 150 мс.
        // Это важно для производительности Android.
        liveTimer = setTimeout(
            flushLiveFormatting,
            150
        );
    }

    if (chatEl) {
        observer = new MutationObserver(records => {
            for (const record of records) {
                const target =
                    record.target.nodeType === Node.TEXT_NODE
                        ? record.target.parentElement
                        : record.target;

                if (!(target instanceof Element)) continue;

                // Игнорируем элементы самого ST Counter.
                if (target.closest(
                    '.st-scene-divider, ' +
                    '.st-paper-card, ' +
                    '.st-recap-bracket, ' +
                    '.st-recap-meta-badge'
                )) {
                    continue;
                }

                const mes = target.closest(
                    '.mes[mesid]'
                );

                if (
                    mes &&
                    (
                        target.closest('.mes_text') ||
                        target === mes
                    )
                ) {
                    queueMessage(mes);
                }

                // Новые сообщения в DOM.
                if (record.type === 'childList') {
                    for (const added of record.addedNodes) {
                        if (!(added instanceof Element)) {
                            continue;
                        }

                        if (added.matches('.mes[mesid]')) {
                            queueMessage(added);
                        } else {
                            const wrapped = added.closest(
                                '.mes[mesid]'
                            );

                            if (
                                wrapped &&
                                added.closest('.mes_text')
                            ) {
                                queueMessage(wrapped);
                            }

                            for (
                                const child of added.querySelectorAll(
                                    '.mes[mesid]'
                                )
                            ) {
                                queueMessage(child);
                            }
                        }
                    }
                }
            }
        });

        observer.observe(chatEl, observerOptions);
    }

    // Старые события SillyTavern сохраняются.

    eventSource.on(
        event_types.CHAT_CHANGED,
        () => setTimeout(processVisibleMessages, 300)
    );

    eventSource.on(
        event_types.MESSAGE_RECEIVED,
        id => setTimeout(
            () => renderMessageStats(id),
            500
        )
    );

    eventSource.on(
        event_types.MESSAGE_UPDATED,
        id => setTimeout(
            () => renderMessageStats(id),
            300
        )
    );

    eventSource.on(
        event_types.MESSAGE_SWIPED,
        id => setTimeout(
            () => renderMessageStats(id),
            300
        )
    );

    eventSource.on(
        event_types.CHARACTER_MESSAGE_RENDERED,
        id => setTimeout(
            () => renderMessageStats(id),
            600
        )
    );

    if (event_types.GENERATION_ENDED) {
        eventSource.on(
            event_types.GENERATION_ENDED,
            () => {
                const context = getContext();

                if (context?.chat?.length) {
                    const id = context.chat.length - 1;

                    setTimeout(() => {
                        // Финальная проверка после генерации.
                        renderMessageStats(id);

                        const el = document.querySelector(
                            `.mes[mesid="${id}"]`
                        );

                        if (el) {
                            highlightRecapBrackets(el);
                            formatMainTextTransitions(el);
                        }
                    }, 400);
                }
            }
        );
    }

    setTimeout(processVisibleMessages, 800);
});
