
import { cos_langindex, error_attrindex } from "../../utils/languageDefinitions";
import { isWhitespace } from "./routineheaderutils";
import { compressedline, compresseditem } from "../../utils/types";


/**
 * Support token reading and coloring for a single line to be parsed.
 */
export class LineSource {

    public constructor(line: string) {
        this.line = line;
        this.pos = 0;
        this.markedpos = 0;
        this.coloring = [];
        this.anycoloringerrors = false;
    }

    /**
     * Skip over any whitespace (spaces and tabs).
     */
    public skipWhitespace() {
        if (this.markedpos != this.pos) {
            throw Error('LineSource.skipWhitespace: marked position was not updated');
        }
        while (!this.ended() && isWhitespace(this.currentChar())) {
            ++this.pos;
        }
        this.markedpos = this.pos;
    }
    
    /**
     * Return true if we're at the end of the line.
     */
    public ended(): boolean {
        return this.pos === this.line.length;
    }
    
    /**
     * Return the character at the current position.
     */
    public currentChar(): string {
        return this.line.charAt(this.pos);
    }

    /**
     * Skips over offset characters - throws an exception if there aren't at least that many characters left.
     * @param offset how many characters to skip over.
     */
    public advance(offset: number) {
        if (this.pos+offset > this.line.length) {
            throw Error('LineSource.advance: advancing past end of line');
        }
        this.pos += offset;
    }

    /**
     * Skip to the end of the line.
     */
    public toEnd() {
        this.advance(this.line.length - this.pos);
    }

    /**
     * Return the current position - use this to detect no progress.
     */
    public getPos(): number {
        return this.pos;
    }

    /**
     * Return the uncolored part of the line up to the current position.
     */
    public getToken(): string {
        return this.line.substring(this.markedpos,this.pos);
    }

    /**
     * Return whether there is any uncolored text up to the current position.
     */
    public anyToken(): boolean {
        return this.pos > this.markedpos;
    }

    /**
     * Color the current token as error.
     */
    public commitError(error) {
        this.commitToken(error_attrindex);
        if (error instanceof Error && error.message.length) this.coloring[this.coloring.length-1].e = error.message;
    }
    
    /**
     * Color the current token.
     * @param attrindex the color
     */
    public commitToken(attrindex: number) {
        if (this.markedpos === this.pos) {
            throw Error('LineSource.commitToken: region to color is empty');
        }
        this.coloring.push(this.coloringFor(this.markedpos,this.pos,attrindex));
        if (attrindex === error_attrindex) {
            this.anycoloringerrors = true;
        }
        this.markedpos = this.pos;
    }

    /**
     * Re-color the most-recently-colored token as error.
     */
    public colorLastAsError(error) {
        if (this.coloring.length === 0) {
            throw Error('LineSource.colorLastAsError: no coloring available to change');
        }
        this.coloring[this.coloring.length-1].s = error_attrindex;
        if (error instanceof Error && error.message.length) this.coloring[this.coloring.length-1].e = error.message;
        this.anycoloringerrors = true;
    }

    /**
     * Return the coloring for the line - this should normally be used when the whole line has been colored.
     */
    public getColoring(): compressedline {
        return this.coloring;
    }

    public anyErrors(): boolean {
        return this.anycoloringerrors;
    }

    public toString(): string {
        return this.line + ' @' + this.markedpos + '-' + this.pos;
    }

    private coloringFor(startpos: number, afterendpos: number, attrindex: number): compresseditem {
        return {'p': startpos, 'c': (afterendpos-startpos), 'l': cos_langindex, 's': attrindex};
    }
    
    /**
     * The original line.
     */
    private line: string;

    /**
     * The current position in the line (start of line is at position 0).
     */
    private pos: number;

    /**
     * The position after the latest character which has been colored.
     */
    private markedpos: number;

    /**
     * The coloring for the line.
     */
    private coloring: compressedline;

    /**
     * Whether any characters have been colored as syntax errors.
     */
    private anycoloringerrors: boolean;
}
