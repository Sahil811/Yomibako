import { nonNull } from '../util.js';
// P0: Memoize boundaries per context string (hover recomputes same context 50x while mouse sweeps)
const sentenceCache = new Map(); // context string → { boundaries, hits }
const SENTENCE_CACHE_MAX = 200;
function getCachedBoundaries(context) {
    const cached = sentenceCache.get(context);
    if (cached) return cached.boundaries;
    const boundaries = [-1, ...Array.from(context.matchAll(/[。！？]/g), m => nonNull(m.index)), context.length];
    if (sentenceCache.size >= SENTENCE_CACHE_MAX) {
        const first = sentenceCache.keys().next().value;
        sentenceCache.delete(first);
    }
    sentenceCache.set(context, { boundaries, hits: 0 });
    return boundaries;
}
export function getSentences(data, contextWidth) {
    if (data.sentenceBoundaries === undefined || data.sentenceIndex === undefined) {
        const boundaries = getCachedBoundaries(data.context);
        data.sentenceBoundaries = boundaries;
        // Implementation of bisect_right to find the array index of the sentence boundary to the left of our token
        let left = 0, right = boundaries.length;
        while (left < right) {
            const middle = (left + right) >> 1;
            if (boundaries[middle] <= data.contextOffset) {
                left = middle + 1;
            }
            else {
                right = middle;
            }
        }
        data.sentenceIndex = left;
    }
    const start = data.sentenceBoundaries[Math.max(data.sentenceIndex - contextWidth, 0)] + 1;
    const end = data.sentenceBoundaries[Math.min(data.sentenceIndex + contextWidth - 1, data.sentenceBoundaries.length - 1)] +
        1;
    return data.context.slice(start, end).trim();
}
