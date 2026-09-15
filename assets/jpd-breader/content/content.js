import { config, requestMine, requestReview, requestSetFlag } from './background_comms.js';
import { Dialog } from './dialog.js';
import { JpdbAudio } from './popup_audio.js';
import { Popup } from './popup.js';
import { showError } from './toast.js';
import { getSentences } from './word.js';
export let currentHover = null;
let popupKeyHeld = false;
let hoverAudioTimer = null;
let currentUnknownWordIndex = -1;
const UNKNOWN_WORD_SELECTORS = '.jpdb-word.new, .jpdb-word.not-in-deck, .jpdb-word.learning';

function getUnknownWords() {
    return Array.from(document.querySelectorAll(UNKNOWN_WORD_SELECTORS));
}

function navigateUnknownWord(direction) {
    const words = getUnknownWords();
    if (words.length === 0) return;

    // Find closest word to current index
    if (currentUnknownWordIndex < 0 || currentUnknownWordIndex >= words.length) {
        currentUnknownWordIndex = direction > 0 ? 0 : words.length - 1;
    } else {
        currentUnknownWordIndex += direction;
        if (currentUnknownWordIndex >= words.length) currentUnknownWordIndex = 0;
        if (currentUnknownWordIndex < 0) currentUnknownWordIndex = words.length - 1;
    }

    const word = words[currentUnknownWordIndex];
    word.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Remove previous highlight
    document.querySelectorAll('.jpdb-word.nav-highlight').forEach(el => el.classList.remove('nav-highlight'));
    word.classList.add('nav-highlight');

    // Show popup for the navigated word
    if (word.jpdbData) {
        const rect = word.getBoundingClientRect();
        currentHover = [word, rect.left + rect.width / 2, rect.top + rect.height / 2];
        Popup.get().showForWord(word, rect.left, rect.top);
    }
}
const lastTrigger = new Map();
const HOTKEY_THROTTLE_MS = 300;
function shouldThrottle(actionName) {
    const now = Date.now();
    const last = lastTrigger.get(actionName) || 0;
    if (now - last < HOTKEY_THROTTLE_MS) return true;
    lastTrigger.set(actionName, now);
    return false;
}
function matchesHotkey(event, hotkey) {
    const code = event instanceof KeyboardEvent ? event.code : `Mouse${event.button}`;
    return hotkey && code === hotkey.code && hotkey.modifiers.every(name => event.getModifierState(name));
}
async function hotkeyListener(event) {
    try {
        // Wait for config to be initialized
        if (!config) return;
        
        if (matchesHotkey(event, config.showPopupKey) && !config.showPopupOnHover) {
            event.preventDefault();
            popupKeyHeld = true;
            const popup = Popup.get();
            popup.disablePointer();
            if (!currentHover) {
                popup.fadeOut();
            }
        }
        if (currentHover) {
            const [word, x, y] = currentHover;
            const card = word.jpdbData.token.card;
            if (matchesHotkey(event, config.addKey) && !shouldThrottle('add')) {
                await requestMine(word.jpdbData.token.card, config.forqOnMine, getSentences(word.jpdbData, config.contextWidth).trim() || undefined, undefined);
            }
            if (matchesHotkey(event, config.dialogKey) && !shouldThrottle('dialog')) {
                Dialog.get().showForWord(word.jpdbData);
            }
            if (matchesHotkey(event, config.showPopupKey) && !shouldThrottle('showPopup')) {
                event.preventDefault();
                Popup.get().showForWord(word, x, y);
            }
            if (matchesHotkey(event, config.blacklistKey) && !shouldThrottle('blacklist')) {
                event.preventDefault();
                await requestSetFlag(card, 'blacklist', !card.state.includes('blacklisted'));
            }
            if (matchesHotkey(event, config.neverForgetKey) && !shouldThrottle('neverForget')) {
                event.preventDefault();
                await requestSetFlag(card, 'never-forget', !card.state.includes('never-forget'));
            }
            if (matchesHotkey(event, config.nothingKey) && !shouldThrottle('nothing')) {
                event.preventDefault();
                await requestReview(card, 'nothing');
            }
            if (matchesHotkey(event, config.somethingKey) && !shouldThrottle('something')) {
                event.preventDefault();
                await requestReview(card, 'something');
            }
            if (matchesHotkey(event, config.hardKey) && !shouldThrottle('hard')) {
                event.preventDefault();
                await requestReview(card, 'hard');
            }
            if (matchesHotkey(event, config.goodKey) && !shouldThrottle('good')) {
                event.preventDefault();
                await requestReview(card, 'good');
            }
            if (matchesHotkey(event, config.easyKey) && !shouldThrottle('easy')) {
                event.preventDefault();
                await requestReview(card, 'easy');
            }
        }
        // Word navigation works regardless of hover state
        if (matchesHotkey(event, config.nextUnknownWordKey)) {
            event.preventDefault();
            navigateUnknownWord(1);
        }
        if (matchesHotkey(event, config.prevUnknownWordKey)) {
            event.preventDefault();
            navigateUnknownWord(-1);
        }
    }
    catch (error) {
        showError(error);
    }
}
window.addEventListener('keydown', hotkeyListener);
window.addEventListener('mousedown', hotkeyListener);
function hidePopupHotkeyListener(event) {
    if (!config) return;
    if (matchesHotkey(event, config.showPopupKey)) {
        event.preventDefault();
        popupKeyHeld = false;
        Popup.get().enablePointer();
    }
}
window.addEventListener('keyup', hidePopupHotkeyListener);
window.addEventListener('mouseup', hidePopupHotkeyListener);
document.addEventListener('mousedown', e => {
    if (!config) return;
    if (config.touchscreenSupport) {
        // to prevent issues with simultaneous showing and hiding
        // and to allow clicking on the popup without making it disappear.
        if (currentHover == null && !Popup.get().containsMouse(e)) {
            Popup.get().fadeOut();
        }
    }
    else {
        Popup.get().fadeOut();
    }
});
export function onWordHoverStart({ target, x, y }) {
    if (target === null || !config)
        return;
    currentHover = [target, x, y];
    if (popupKeyHeld || config.showPopupOnHover) {
        // On mobile devices, the position of the popup is occasionally adjusted to ensure
        // it remains on the screen. However, due to the interaction between the 'onmouseenter'
        // event and the popup, there are instances where the popup appears and at the same
        // time a (review) button is being clicked.
        if (config.touchscreenSupport) {
            Popup.get().disablePointer();
            setTimeout(() => {
                Popup.get().enablePointer();
            }, 400);
        }
        Popup.get().showForWord(target, x, y);
    }
    // Play pronunciation audio on hover (independent of popup visibility)
    // Debounced to avoid spamming audio when sweeping the mouse across text
    if (hoverAudioTimer) clearTimeout(hoverAudioTimer);
    if (config.playSoundOnHover) {
        const card = target.jpdbData?.token?.card;
        if (card?.vid && card?.spelling) {
            hoverAudioTimer = setTimeout(() => {
                hoverAudioTimer = null;
                JpdbAudio.speak(card.vid, card.spelling);
            }, 250);
        }
    }
}
export function onWordHoverStop() {
    currentHover = null;
}
