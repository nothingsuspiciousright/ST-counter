import { getContext } from "../../../extensions.js";
import { eventSource, event_types } from "../../../../script.js";
import { getTokenCountAsync } from "../../../tokenizers.js";

function cleanModelName(model) {
    if (!model) return "";
    return String(model).split('/').pop();
}

async function renderMessageStats(messageId) {
    const context = getContext();
    if (!context || !context.chat || !context.chat[messageId]) return;

    const message = context.chat[messageId];
    const mesElement = document.querySelector(`.mes[mesid="${messageId}"]`);
    if (!mesElement) return;

    const rawText = message.mes || "";

    // 1. Общее количество токенов
    let totalTokens = message.extra?.token_count;
    if (!totalTokens) {
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

    // 4. Кладем прямо внутрь .ch_name (под таймстампом и НАД линией, вообще не трогая кнопки "... ✏️"!)
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
    eventSource.on(event_types.MESSAGE_RECEIVED, (id) => setTimeout(() => renderMessageStats(id), 150));
    eventSource.on(event_types.MESSAGE_UPDATED, (id) => setTimeout(() => renderMessageStats(id), 150));
    eventSource.on(event_types.MESSAGE_SWIPED, (id) => setTimeout(() => renderMessageStats(id), 150));
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (id) => setTimeout(() => renderMessageStats(id), 150));

    const chatEl = document.getElementById('chat');
    if (chatEl) {
        const observer = new MutationObserver(() => {
            processVisibleMessages();
        });
        observer.observe(chatEl, { childList: true });
    }

    setTimeout(processVisibleMessages, 1000);
});
