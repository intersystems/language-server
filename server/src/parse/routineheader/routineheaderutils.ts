
/**
 * Return true if c is valid in a routine name.
 * @param c the character to test
 */
export function validInRoutineName(c: string): boolean {
    return c === '.' || c === '%' || isStudioScannerAlpha(c) || isUnicodeDigit(c);
}


/**
 * Return true if name is a valid routine name.
 * @param name the name to test
 */
export function isValidRoutineName(name: string): boolean {

	// check for empty/dot at end/dotdot
	if (name.length===0 || name.endsWith('.') || name.indexOf('..')!=-1) {
		return false;
	}

	// check the first character
	if (!isStandardObjectScriptNameStart(name.charAt(0))) {
		return false;
	}

	// check the remaining characters
	for (let index = 1; index < name.length; ++index) {

		const c = name.charAt(index);
		if (c !== '.' && !isStandardObjectScriptNameTail(c)) {
			return false;
		}
	}

	return true;
}


/**
 * Return true if c is a whitespace character - defined as space or tab here.
 * @param c the character to test
 */
export function isWhitespace(c: string): boolean {
    return c===' ' || c==='\t';
}

// for tracking which keywords we've seen
export type keywordstype = {UC_TYPE_KEYWORD?: string, UC_LANGUAGEMODE_KEYWORD?: string, UC_TYPE_GENERATED?: string};


/**
 * Return true if c can start an ObjectScript name.
 * @param c the character to test
 */
function isStandardObjectScriptNameStart(c: string): boolean {
	return isStudioScannerAlpha(c) || c == '%';
}


/**
 * Return true if c can appear after the start of an ObjectScript name.
 * @param c the character to test
 */
function isStandardObjectScriptNameTail(c: string): boolean {
	return isStudioScannerAlpha(c) || isUnicodeDigit(c);
}


/**
 * Return true if c is considered a letter by Studio.
 * @param c the character to test
 */
function isStudioScannerAlpha(c: string): boolean {
	return isAlpha(c) || c.charCodeAt(0) > 0x80;
}


/**
 * Return true if c is a unicode digit.
 * @param c the character to test
 */
function isUnicodeDigit(c: string): boolean {
	return c.match('\\d') != null;
}


/**
 * Return true if c is a letter.
 * @param c the character to test
 */
function isAlpha(c: string): boolean {
	return c.match('\\w') != null;
}
