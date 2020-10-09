
export type ast = {'class': astclass};

export type astclass = {'header': astclassheader, 'memberlist': astmember[]};

export type astclassheader = {'name': string, 'premembertext': string};

export type astmember = {'type': membertype, 'name': string, restofmembertext: string};

export enum membertype {METHOD,CLASSMETHOD,PROPERTY,PARAMETER,FOREIGNKEY,RELATION,PROJECTION,XDATA,INDEX,TRIGGER};
