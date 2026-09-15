import { browser } from '../util.js';
import { jsxCreateElement } from '../jsx.js';
import { ShadowComponent } from './shadowbase.js';

let toastContainerElement = null;
let toastComponent = null;

function ensureToastContainer() {
    if (!toastComponent) {
        toastContainerElement = jsxCreateElement("div", { role: 'alert', 'aria-live': 'polite' });
        document.body.append(toastContainerElement);
        toastComponent = new ShadowComponent(toastContainerElement, [
            '/themes.css',
            '/common.css',
            '/content/toast.css'
        ]);
    }
    return toastComponent;
}

export function showToast(kind, message, options = {}) {
    // P0: Support Undo action + bottom-center pill toast
    const hasAction = !!options.action;
    const toast = (jsxCreateElement("div", { class: 'toast' },
        jsxCreateElement("span", { class: 'kind' },
            kind,
            ":"),
        jsxCreateElement("span", { class: 'message' }, message),
        jsxCreateElement("span", { class: 'buttons' },
            hasAction ? (jsxCreateElement("button", {
                class: 'action',
                style: 'background:var(--md-sys-color-primary);color:var(--md-sys-color-on-primary);border-radius:999px;padding:4px 12px;width:auto;height:auto;font-size:12px;font-weight:700;',
                onclick: () => {
                    try { options.action(); } finally { toast.remove(); clearTimeout(timeout); }
                }
            }, options.actionLabel ?? options.actionIcon ?? 'Undo')) : (''),
            jsxCreateElement("button", { class: 'close', onclick: () => {
                    toast.remove();
                    clearTimeout(timeout);
                } }, "✕"))));
    const timeout = options.timeout != Infinity
        ? setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(8px) scale(0.98)';
            toast.style.transition = 'opacity 0.2s, transform 0.2s';
            setTimeout(() => toast.remove(), 220);
        }, options.timeout ?? 3000)
        : undefined;
    ensureToastContainer().append(toast);
    // Allow action toast to stay longer
    if (hasAction && (options.timeout ?? 3000) < 4000 && options.timeout != Infinity) {
        clearTimeout(timeout);
        // re-arm with 5s
        const t = setTimeout(() => { toast.remove(); }, 5000);
        // store for close to clear
        toast._timeout = t;
    }
}
export function showError(error) {
    console.error(error);
    showToast('Error', error.message, {
        timeout: 5000,
        actionIcon: '⎘',
        action() {
            navigator.clipboard.writeText(`Error: ${error.message}\n${error.stack}`);
            showToast('Info', 'Error copied to clipboard!', { timeout: 1000 });
        },
    });
}
