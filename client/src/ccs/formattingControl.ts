const skipUris = new Set<string>();
const autoSkipUris = new Set<string>();
const manualAllowances = new Map<string, number>();
const compileBlocks = new Map<string, number>();

const manualAllowanceMs = 1000;
const compileBlockMs = 8000;

function purgeExpiredEntries(uri: string, now: number): void {
        const manualExpiry = manualAllowances.get(uri);
        if (manualExpiry !== undefined && manualExpiry < now) {
                manualAllowances.delete(uri);
        }

        const compileExpiry = compileBlocks.get(uri);
        if (compileExpiry !== undefined && compileExpiry < now) {
                compileBlocks.delete(uri);
        }
}

export function scheduleFormatSkip(uri: string): void {
        skipUris.add(uri);
        autoSkipUris.add(uri);
        manualAllowances.delete(uri);
}

export function consumeFormatSkip(uri: string): boolean {
        const now = Date.now();
        purgeExpiredEntries(uri, now);

        const manualExpiry = manualAllowances.get(uri);
        if (manualExpiry !== undefined && manualExpiry >= now) {
                skipUris.delete(uri);
                autoSkipUris.delete(uri);
                return false;
        }

        if (compileBlocks.has(uri)) {
                return true;
        }

        if (skipUris.has(uri)) {
                skipUris.delete(uri);
                autoSkipUris.delete(uri);
                return true;
        }

        return false;
}

export function clearFormatSkip(uri: string): void {
        skipUris.delete(uri);
        autoSkipUris.delete(uri);
        manualAllowances.delete(uri);
}

export function removeFormatSkip(uri: string): void {
        skipUris.delete(uri);
        autoSkipUris.delete(uri);
        manualAllowances.delete(uri);
        compileBlocks.delete(uri);
}

export function blockFormatAfterCompile(uri: string): void {
        skipUris.add(uri);
        autoSkipUris.delete(uri);
        compileBlocks.set(uri, Date.now() + compileBlockMs);
        manualAllowances.delete(uri);
}

export function allowManualFormat(uri: string): void {
        const now = Date.now();
        if (autoSkipUris.has(uri)) {
                return;
        }
        manualAllowances.set(uri, now + manualAllowanceMs);
        compileBlocks.delete(uri);
        skipUris.delete(uri);
}
