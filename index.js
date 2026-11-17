import { getContext } from "../../../extensions.js";
import { eventSource, event_types } from "../../../../script.js";
import { getTokenCountAsync } from "../../../tokenizers.js";

function cleanModelName(model) {
    if (!model) return "";
    return String(model).split('/').pop();
}

// 💎 Переключает все мыльные миниатюры аватарок и персон на 100% оригиналы без сжатия!
function upgradeAvatarsToFullRes() {
    document.querySelectorAll('img[src*="thumbnail?type=avatar"]').forEach(img => {
        try {
            const url = new URL(img.src, window.location.origin);
            const file = url.searchParams.get('file');
            if (file) {
                img.src = `/characters/${encodeURIComponent(file)}`;
            }
        } catch (e) {}
    });
    document.querySelectorAll('img[src*="thumbnail?type=persona"]').forEach(img => {
        try {
            const url = new URL(img.src, window.location.origin);
            const file = url.searchParams.get('file');
            if (file) {
                img.src = `/User Avatars/${encodeURIComponent(file)}`;
            }
        } catch (e) {}
    });
}

// Оборачивает [транзишены в скобках] внутри рекапа в красивую бледную плашку
function highlightRecapBrackets(mesElement) {
    const detailsList = mesElement.querySelectorAll('.mes_text details');
    detailsList.forEach(details => {
        if (details.dataset.bracketsHighlighted === "true") return;

        const walker = document.createTreeWalker(details, NodeFilter.SHOW_TEXT, null);
        const textNodes = [];
        let node;
        while ((node = walker.nextNode())) {
            if (node.parentElement && node.parentElement.tagName !== 'SUMMARY' && /\[[^\]]+\]/.test(node.nodeValue)) {
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

async function renderMessageStats(messageId) {
    const context = getContext();
    if (!context || !context.chat || !context.chat[messageId]) return;

    const message = context.chat[messageId];
    if (message.is_user) return; // Не рисуем на сообщениях юзера

    const mesElement = document.querySelector(`.mes[mesid="${messageId}"]`);
    if (!mesElement) return;

    highlightRecapBrackets(mesElement);
    upgradeAvatarsToFullRes();

    const rawText = message.mes || "";

    // 1. Общее количество токенов
    let totalTokens = message.extra?.token_count;
    if (!totalTokens || totalTokens <= 2) {
        try {
            totalTokens = await getTokenCountAsync(rawText);
        } catch {
            totalTokens = Math.round(rawText.length / 3.5);
        }
    }

    // 2. Ищем <en>...</en>
    const enRegex = /<en>([\s\S]*?)<\/en>/gi;
    let match;
    let enContent = "";
    while ((match = enRegex.exec(rawText)) !== null) {
        enContent += match[1] + "\n";
    }

    let recapTokens = 0;
    if (enContent.trim().length > 0) {
        try {
            recapTokens = await getTokenCountAsync(enContent.trim());
        } catch {
            recapTokens = Math.round(enContent.trim().length / 4);
        }
    }

    // 3. Модель
    const rawModel = message.extra?.model || message.gen_model || (message.is_user ? "" : (message.extra?.api || ""));
    const modelName = cleanModelName(rawModel);

    // 4. Плашка в шапке
    let badge = mesElement.querySelector('.st-recap-meta-badge');
    if (!badge) {
        badge = document.createElement('div');
        badge.className = 'st-recap-meta-badge';

        const chName = mesElement.querySelector('.ch_name');
        if (!chName) return;

        chName.insertAdjacentElement('beforeend', badge);
    }

    let parts = [];
    if (recapTokens > 0) {
        parts.push(`<span>${totalTokens}t (recap: ${recapTokens}t)</span>`);
    } else {
        parts.push(`<span>${totalTokens}t</span>`);
    }

    if (modelName) {
        parts.push(`<span title="${rawModel}">${modelName}</span>`);
    }

    badge.innerHTML = `<span style="opacity:0.5;">·</span> ` + parts.join(` <span style="opacity:0.5;">·</span> `);
}

function processVisibleMessages() {
    upgradeAvatarsToFullRes();
    const mesElements = document.querySelectorAll('#chat .mes[mesid]');
    mesElements.forEach(el => {
        if (!el.querySelector('.st-recap-meta-badge')) {
            const id = Number(el.getAttribute('mesid'));
            if (!isNaN(id)) renderMessageStats(id);
        }
    });
}

jQuery(() => {
    eventSource.on(event_types.CHAT_CHANGED, () => setTimeout(processVisibleMessages, 300));
    eventSource.on(event_types.MESSAGE_RECEIVED, (id) => setTimeout(() => renderMessageStats(id), 500));
    eventSource.on(event_types.MESSAGE_UPDATED, (id) => setTimeout(() => renderMessageStats(id), 300));
    eventSource.on(event_types.MESSAGE_SWIPED, (id) => setTimeout(() => renderMessageStats(id), 300));
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (id) => setTimeout(() => renderMessageStats(id), 600));
    if (event_types.GENERATION_ENDED) {
        eventSource.on(event_types.GENERATION_ENDED, () => {
            const context = getContext();
            if (context && context.chat && context.chat.length > 0) {
                setTimeout(() => renderMessageStats(context.chat.length - 1), 400);
            }
        });
    }

    // Следим за всем интерфейсом, чтобы и в правой панели персонажей сразу включались HD-аватарки!
    const bodyObserver = new MutationObserver(() => {
        upgradeAvatarsToFullRes();
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true });

    const chatEl = document.getElementById('chat');
    if (chatEl) {
        const observer = new MutationObserver(() => {
            processVisibleMessages();
        });
        observer.observe(chatEl, { childList: true });
    }

    setTimeout(processVisibleMessages, 800);
});
