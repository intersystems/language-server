
import { compressedline,compresseditem } from "./types";

export type itemandtext = {'item': compresseditem, 'text': string};
export type stringpredicate = (s: string) => boolean;
export type itempredicate = {'lang'?: number, 'attrindex'?: number, 'text'?: string | stringpredicate};

type matchitemresult = {'matches': boolean, 'reason'?: string};


export class tokensourcetype {

    public constructor(lines: compressedline[], textlines: string[]) {
        
        this.lines = lines;
        this.textlines = textlines;
        this.lineindex = 0;
        this.itemindex = 0;

        if (!this.ended()) {
            this.skipToNextNonEmptyLine();
        }
    }

    /**
     * Return either the current item or undefined if the token source is ended
     */
    public peek(): compresseditem | undefined {

        if (this.ended()) {
            return undefined;
        }

        return this.peekx();
    }

    /**
     * Return the current item
     * - use this rather than peek() when you've already checked ended()
     */
    public peekx(): compresseditem {
        return this.lines[this.lineindex][this.itemindex];
    }

    /**
     * Return whether the current item matches the given predicate
     * - only use this when you've already checked ended()
     */
    public peekxIs(pred: itempredicate): boolean {
        return this.matchItem(this.peekx(),pred).matches;
    }

    /**
     * Crosses to the next token (if ended() returns undefined) and then returns what peek returns.
     */
    public next(): compresseditem | undefined {
        
        if (this.ended()) {
            return undefined;
        }

        // next item on the line
        ++this.itemindex;

        // if we've run out of items on the line ..
        if (this.itemindex === this.lines[this.lineindex].length) {

            // next line
            ++this.lineindex;

            // skip empty lines unless we're already at the end
            if (!this.ended()) {
                this.skipToNextNonEmptyLine();
            }

            // first item on the new line
            this.itemindex = 0;
        }

        return this.peek();
    }

    /**
     * Return whether the token source is ended.
     */
    public ended(): boolean {
        return this.lineindex === this.lines.length;
    }

    /**
     * Test the current token against the predicate (throws exception if ended).
     * If the test succeeds: cross the token and return its details.
     * If the test fails: throw an exception.
     * @param pred predicate test for the expected token
     */
    public expectTokenType(pred: itempredicate): itemandtext {

        const item = this.peek();
        if (typeof item === 'undefined') {
            throw this.makeError('expectTokenType','end of document expecting ' + this.showItemPredicate(pred));
        }

        const itemmatches = this.matchItem(item,pred);
        if (!itemmatches.matches) {
            const reason = (typeof itemmatches.reason === 'undefined') ? 'token does not match' : itemmatches.reason;
            throw this.makeError('expectTokenType',reason);
        }

        const itemtext = this.peekText();            
        this.next();

        return {'item': item, 'text': itemtext};
    }

    /**
     * Until the source is ended or a token is found which matches the given predicate: cross tokens.
     * Then return all the text between where we started and where we ended up at.
     * @param pred predicate test for the token to stop scanning at
     */
    public textUpTo(pred: itempredicate): string {

        // starting text line and column (token line numbers are the same as text line numbers)
        const startlineindex = this.lineindex;
        const startcolumnindex = this.lines[startlineindex][this.itemindex].p;

        // until token source ended ..
        while (!this.ended()) {

            const item = this.peekx();
    
            const itemmatches = this.matchItem(item,pred);
            if (itemmatches.matches) {
                break; // token doesn't match the predicate - quit the while loop
            }
    
            this.next();
        }    

        return this.textFrom(startlineindex,startcolumnindex);
    }

    /**
     * For debugging
     */
    public toString(): string {
        
        if (this.ended()) {
            return '(ended)';
        }
        
        const item = this.peekx();
        return this.peekTextForItem(item) + ' @' + this.lineindex + ',' + item.p + ': ' + item.l + '/' + item.s;
    }

    /**
     * Return the text associated with the current token - or throw an exception if the token source is ended.
     */
    public peekText(): string {

        const item = this.peek();
        if (typeof item === 'undefined') {
            throw this.makeError('peekText','peek() returned undefined');
        }

        return this.peekTextForItem(item);
    }

    /**
     * @param item item to match against the given predicate
     * @param pred predicate test for the item
     */
    private matchItem(item: compresseditem, pred: itempredicate): matchitemresult {

        // check language if given
        if ('lang' in pred && item.l !== pred.lang) {
            return {'matches': false, 'reason': 'mismatch in language expecting ' + this.showItemPredicate(pred)};
        }

        // check attribute index if given
        if ('attrindex' in pred && item.s !== pred.attrindex) {
            return {'matches': false, 'reason': 'mismatch in attrindex expecting ' + this.showItemPredicate(pred)};
        }

        // check text string/stringpredicate if given
        if ('text' in pred && typeof pred.text !== 'undefined' && !this.testText(this.peekText(),pred.text)) {
            return {'matches': false, 'reason': 'mismatch in text expecting ' + this.showItemPredicate(pred)};
        } 
            
        return {'matches': true};
    }

    /**
     * Return all the text from the given start indexes up to before the current text position.
     * @param startlineindex start line number of text
     * @param startcolumnindex start column index of text
     */
    private textFrom(startlineindex: number, startcolumnindex: number): string {

        // special case: only one line (the later code won't work with this case)
        if (startlineindex == this.lineindex) {
            const currentcolumnindex = this.lines[this.lineindex][this.itemindex].p;
            return this.textlines[startlineindex].substring(startcolumnindex,currentcolumnindex);
        }
        
        let str = '';

        // some or all of first line
        str += (this.textlines[startlineindex].substring(startcolumnindex) + '\n');

        // all but the first and last lines
        for (let index: number = startlineindex+1; index < (this.lineindex-1); ++index) {
            str += (this.textlines[index] + '\n');
        }

        // some or all of last line
        if (!this.ended()) {
            const currentcolumnindex = this.lines[this.lineindex][this.itemindex].p;
            str += this.textlines[this.lineindex].substring(0,currentcolumnindex);
        }

        return str;
    }

    private makeError(title: string, message: string): Error {
        return Error(title + ': ' + message + ' - ' + this.showItem(this.peek()));
    }

    private showItemPredicate(pred: itempredicate): string {
        return '[' + this.ud(pred.lang) + ':' + this.ud(pred.attrindex) + ':' + this.showText(pred.text) + ']'
    }

    private ud(a: string | number | undefined): string {
        if (typeof a === 'undefined') {
            return '(none)';
        }
        else if (typeof a === 'string') {
            return a;
        }
        else {
            return a.toString();
        }
    }

    private showItem(item: compresseditem | undefined): string {
        if (typeof item === 'undefined') {
            return '(none)';
        }
        return '[p=' + item.p + ', c=' + item.c + ', l=' + item.l + ', s=' + item.s + ', w=' + item.w + ']';
    }

    private showText(text: string | stringpredicate | undefined): string {
        
        if (typeof text === 'undefined') {
            return '(none)';
        }

        if (typeof text === 'string') {
            return text;
        }

        return '(predicate)';
    }

    private peekTextForItem(item: compresseditem): string {
        return this.textlines[this.lineindex].substr(item.p,item.c);
    }

    /**
     * Case-insensitive if given a plain string for 'text'
     * @param sample 
     * @param text 
     */
    private testText(sample: string, text: string | stringpredicate): boolean {
        
        if (typeof text === 'string') {
            return text.toLowerCase() === sample.toLowerCase();
        }

        return text(sample);
    }
    
    /**
     * Skips to the next non-empty line, or the size of 'lines' if there is none.
     * 
     * Must NOT already be at the end on entry.
     */
    private skipToNextNonEmptyLine() {
        
        let index = this.lineindex + 1;
        while (index < this.lines.length && this.lines[index].length === 0) {
            ++index;
        }

        this.lineindex = index;
    }

    lines: compressedline[];
    textlines: string[];
    lineindex: number;
    itemindex: number;
}