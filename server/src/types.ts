
export type colorrecord = {
    'colorrecord_languagename': string,
    'colorrecord_attrindex': number,
    'colorrecord_source': string
};

export type languagestype = {[index: string]: [string]};
export type colorinfotype = {'languages': languagestype, 'colors': colorrecord[]};

export type colorinfoopttype = {'languages': languagestype, 'colors': colorrecord[], 'enabled'?: boolean[]};


// compressed color information

export type compresseditem = {
    'p': number, // offset within line
    'c': number, // count (length of source of this item)
    'l': number, // language index
    's': number, // coloring attribute index
    'w': number // 0=>no warning, 1=>warning
};

export type compressedline = compresseditem[];

export type compressedresult = {'compressedlinearray': compressedline[], 'routineheaderinfo'?: routineheaderinfotype};

export type compressedcolors = {'compressedcolors': compressedline[]};


// routine header (if present 'generated' is just set to '')
export type routineheaderinfotype = {'routinename': string, 'routinetype'?: string, 'languagemode'?: number, 'generated'?: string};


// languages

// languages are defined as languagedefns.LANGUAGES
export type languageinfo = {
    'moniker': string,
    'description': string
}

export type attrinforesult = {'attrinfo': attrinfo[]};

export type attrinfo = {
	'description': string,
	'foreground': string, // RGB hex
	'background': string, // RGB hex
    'debugcategory': number // enumeration DEBUG_CATEGORY, defined in languagedefns
}

export type legendtype = {
    'types': string[],
    'modifiers': string[]
}

export type tokeninfo = {
    'foreground': string,
    'fontStyle'?: string
}


// for generating settings
export type semanticrulesforlang = {
   [tokentype: string]: tokeninfo
}

export type semanticrules = {
    [moniker: string]: semanticrulesforlang
}


// monikers
export type monikerinfo = {
    'moniker': string,
    'monikeropt': monikeropttype
}

export enum monikeropttype {
    NONE,
    INT
}
