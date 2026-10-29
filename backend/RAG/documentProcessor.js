/**
 * Cleans text and splits it into coherent, overlapping chunks.
 * Uses boundary-aware slicing to avoid cutting words or sentences in half,
 * dramatically improving embedding accuracy and retrieval relevance.
 *
 * @param {string} text - Raw document text.
 * @param {number} [chunkSize=500] - Target maximum chunk character length.
 * @param {number} [overlap=100] - Overlap window character length.
 * @returns {Array<string>} Array of coherent text chunks.
 */
function splitIntoChunks(text, chunkSize = 500, overlap = 100) {
    if (!text || typeof text !== "string") {
        return [];
    }

    // Clean whitespace and normalize line breaks
    const cleanedText = text
        .replace(/\r\n/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/\n\s+/g, "\n")
        .trim();

    if (!cleanedText) {
        return [];
    }

    const chunks = [];
    let start = 0;

    while (start < cleanedText.length) {
        let end = start + chunkSize;

        // If remaining text fits in one chunk, finish up
        if (end >= cleanedText.length) {
            const finalChunk = cleanedText.slice(start).trim();
            if (finalChunk.length > 0) chunks.push(finalChunk);
            break;
        }

        const searchZone = cleanedText.slice(start, end);

        // 1. Try to find a natural sentence boundary (. ! ? or newline) in the latter half of the chunk
        const sentenceBoundaryRegex = /[.!?\n]\s+/g;
        let lastSentenceEnd = -1;
        let match;
        while ((match = sentenceBoundaryRegex.exec(searchZone)) !== null) {
            if (match.index >= Math.floor(chunkSize * 0.4)) {
                lastSentenceEnd = match.index + match[0].length;
            }
        }

        if (lastSentenceEnd !== -1) {
            end = start + lastSentenceEnd;
        } else {
            // 2. If no sentence boundary found, break at the nearest word boundary (space)
            const lastSpace = searchZone.lastIndexOf(" ");
            if (lastSpace > Math.floor(chunkSize * 0.4)) {
                end = start + lastSpace;
            }
        }

        const chunk = cleanedText.slice(start, end).trim();
        if (chunk.length > 0) {
            chunks.push(chunk);
        }

        // Advance start with overlap while ensuring strictly forward progress
        start = Math.max(start + 1, end - overlap);

        // Align start to the next word boundary so overlap doesn't start mid-word
        if (start < end && /\w/.test(cleanedText[start]) && start > 0 && /\w/.test(cleanedText[start - 1])) {
            const nextSpace = cleanedText.indexOf(" ", start);
            if (nextSpace !== -1 && nextSpace < end) {
                start = nextSpace + 1;
            }
        }

        // Skip any leading whitespace
        while (start < cleanedText.length && /\s/.test(cleanedText[start])) {
            start++;
        }
    }

    return chunks;
}

export { splitIntoChunks };