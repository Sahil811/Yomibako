import { nonNull } from '../util.js';
import { jsxCreateElement } from '../jsx.js';
import { onWordHoverStart, onWordHoverStop } from './content.js';
const displayCategoryCache = new Map();
export function displayCategory(node) {
    if (node instanceof Text || node instanceof CDATASection) {
        return 'text';
    }
    else if (node instanceof Element) {
        // Fast path for ruby tags before computed style
        if (node.tagName === 'RUBY')
            return 'ruby';
        if (node.tagName === 'RP')
            return 'none';
        if (node.tagName === 'RT')
            return 'ruby-text';
        if (node.tagName === 'RB')
            return 'inline';
        const cacheKey = node.tagName + '|' + (node.className || '');
        if (displayCategoryCache.has(cacheKey)) return displayCategoryCache.get(cacheKey);
        const display = getComputedStyle(node).display.split(/\s/g);
        let cat;
        if (display[0] === 'none')
            cat = 'none';
        else if (display.some(x => x.startsWith('block')))
            cat = 'block';
        else if (display.some(x => x.startsWith('inline')))
            cat = 'inline';
        else if (display[0] === 'flex')
            cat = 'block';
        else if (display[0] === '-webkit-box')
            cat = 'block'; // Old name of flex? Still used on Google Search for some reason.
        else if (display[0] === 'grid')
            cat = 'block';
        else if (display[0].startsWith('table'))
            cat = 'block';
        else if (display[0].startsWith('flow'))
            cat = 'block';
        else if (display[0] === 'ruby')
            cat = 'ruby';
        else if (display[0].startsWith('ruby-text'))
            cat = 'ruby-text';
        else if (display[0].startsWith('ruby-base'))
            cat = 'inline';
        else if (display[0].startsWith('math'))
            cat = 'inline';
        else if (display.includes('list-item'))
            cat = 'block';
        else if (display[0] === 'contents')
            cat = 'inline';
        else if (display[0] === 'run-in')
            cat = 'block';
        else {
            console.warn(`JPDBreader: Unknown display value ${display.join(' ')}, please report this!`);
            cat = 'none';
        }
        displayCategoryCache.set(cacheKey, cat);
        if (displayCategoryCache.size > 1000) {
            // P0: True LRU via delete+set, larger cap for Wikipedia (500+ classes)
            const firstKey = displayCategoryCache.keys().next().value;
            displayCategoryCache.delete(firstKey);
        }
        return cat;
    }
    else {
        return 'none';
    }
}
function splitFragment(fragments, fragmentIndex, splitOffset) {
    const oldFragment = fragments[fragmentIndex];
    // console.log('Splitting fragment', oldFragment);
    const newNode = oldFragment.node.splitText(splitOffset - oldFragment.start);
    // Insert new fragment
    const newFragment = {
        start: splitOffset,
        end: oldFragment.end,
        length: oldFragment.end - splitOffset,
        node: newNode,
        hasRuby: oldFragment.hasRuby,
    };
    fragments.splice(fragmentIndex + 1, 0, newFragment);
    // Change endpoint of existing fragment accordingly
    oldFragment.end = splitOffset;
    oldFragment.length = splitOffset - oldFragment.start;
}
function insertBefore(newNode, referenceNode) {
    nonNull(referenceNode.parentElement).insertBefore(newNode, referenceNode);
}
function insertAfter(newNode, referenceNode) {
    const parent = nonNull(referenceNode.parentElement);
    const sibling = referenceNode.nextSibling;
    if (sibling) {
        parent.insertBefore(newNode, sibling);
    }
    else {
        parent.appendChild(newNode);
    }
}
function wrap(node, wrapper) {
    insertBefore(wrapper, node);
    wrapper.append(node);
}
export const reverseIndex = new Map();
const REVERSE_INDEX_MAX_SIZE = 10000;
// P0: Auto-clean on navigation — prevents leak on SPA (ttu-reader)
if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => reverseIndex.clear());
    // Also clean when URL changes via history API (SPA)
    const _pushState = history.pushState;
    history.pushState = function(...args) { reverseIndex.clear(); return _pushState.apply(this, args); };
}
export function applyTokens(fragments, tokens) {
    if (reverseIndex.size > REVERSE_INDEX_MAX_SIZE) {
        // P0: LRU evict half instead of clear all — preserves recent words during long novel parse
        const toDelete = Math.floor(REVERSE_INDEX_MAX_SIZE / 2);
        let i = 0;
        for (const k of reverseIndex.keys()) { if (i++ >= toDelete) break; reverseIndex.delete(k); }
    }
    let fragmentIndex = 0;
    let curOffset = 0;
    let fragment = fragments[fragmentIndex];
    const text = fragments.map(x => x.node.data).join('');

    for (const token of tokens) {
        if (!fragment)
            return;

        // Wrap all unparsed fragments that appear before the token
        while (curOffset < token.start) {
            if (fragment.end > token.start) {
                splitFragment(fragments, fragmentIndex, token.start);
            }
            wrap(fragment.node, jsxCreateElement("span", { class: 'jpdb-word unparsed' }));
            curOffset += fragment.length;
            fragment = fragments[++fragmentIndex];
            if (!fragment)
                return;
        }

        // Accumulate fragments until we have enough to fit the current token
        while (curOffset < token.end) {
            if (fragment.end > token.end) {
                splitFragment(fragments, fragmentIndex, token.end);
            }

            // Create the wrapper for the word with reading and meaning
            const className = `jpdb-word ${token.card.state.join(' ')}`;
            const wrapper = (token.rubies.length > 0 && !fragment.hasRuby
                ? jsxCreateElement("ruby", { class: className, onmouseenter: onWordHoverStart, onmouseleave: onWordHoverStop })
                : jsxCreateElement("span", { class: className, onmouseenter: onWordHoverStart, onmouseleave: onWordHoverStop })
            );

            const idx = reverseIndex.get(`${token.card.vid}/${token.card.sid}`);
            if (idx === undefined) {
                reverseIndex.set(`${token.card.vid}/${token.card.sid}`, { className, elements: [wrapper] });
            } else {
                idx.elements.push(wrapper);
            }

            wrapper.jpdbData = {
                token,
                context: text,
                contextOffset: curOffset,
            };
            wrap(fragment.node, wrapper);

            // Process rubies for furigana
            if (!fragment.hasRuby) {
                for (const ruby of token.rubies) {
                    if (ruby.start >= fragment.start && ruby.end <= fragment.end) {
                        if (ruby.start > fragment.start) {
                            splitFragment(fragments, fragmentIndex, ruby.start);
                            insertAfter(jsxCreateElement("rt", null), fragment.node);
                            fragment = fragments[++fragmentIndex];
                        }
                        if (ruby.end < fragment.end) {
                            splitFragment(fragments, fragmentIndex, ruby.end);
                            insertAfter(jsxCreateElement("rt", { class: 'jpdb-furi' }, ruby.text), fragment.node);
                            fragment = fragments[++fragmentIndex];
                        } else {
                            insertAfter(jsxCreateElement("rt", { class: 'jpdb-furi' }, ruby.text), fragment.node);
                              // Add the meaning below the word
                        }
                    }
                }
            }

            curOffset = fragment.end;
            fragment = fragments[++fragmentIndex];
            if (!fragment)
                break;
        }
    }

    // Wrap any left-over fragments in unparsed wrappers
    for (const fragment of fragments.slice(fragmentIndex)) {
        wrap(fragment.node, jsxCreateElement("span", { class: 'jpdb-word unparsed' }));
    }
}
