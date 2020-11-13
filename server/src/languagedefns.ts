
import { languageinfo } from "./types";


export const LANGUAGES: languageinfo[] = [
    {'moniker': '', 'description': 'None'},             // 0x00
    {'moniker': 'COS', 'description': 'ObjectScript'},  // 0x01
    {'moniker': 'SQL', 'description': 'SQL'},           // 0x02
    {'moniker': 'CLS', 'description': 'Class'},         // 0x03
    {'moniker': 'BAS', 'description': 'Basic'},         // 0x04
    {'moniker': 'HTML', 'description': 'HTML'},         // 0x05
    {'moniker': 'NULL', 'description': 'Null'},         // 0x06
    {'moniker': 'xSPP', 'description': 'was SPP'},      // 0x07 - will be Python
    {'moniker': 'OSQL', 'description': 'OSQL'},         // 0x08
    {'moniker': 'XML', 'description': '(none)'},        // 0x09
    {'moniker': 'ISQL', 'description': '(none)'},       // 0x0A
    {'moniker': 'JAVASCRIPT', 'description': '(none)'}, // 0x0B
    {'moniker': 'MVBASIC', 'description': '(none)'},    // 0x0C
    {'moniker': 'JAVA', 'description': '(none)'},       // 0x0D
    {'moniker': 'TSQL', 'description': '(none)'},       // 0x0E
    {'moniker': 'CSS', 'description': '(none)'}         // 0x0F
]


// some convenience definitions
export const cos_langindex = 0x01;
export const sql_langindex = 0x02;
export const cls_langindex = 0x03;
export const html_langindex = 0x05;
export const xml_langindex = 0x09;
export const javascript_langindex = 0x0B;
export const css_langindex = 0x0F;

export const error_attrindex = 0x00;
export const normal_attrindex = 0x01;

export const cos_label_attrindex = 0x03;
export const cos_dots_attrindex = 0x04;
export const cos_comment_attrindex = 0x07;
export const cos_ppf_attrindex = 0x0A;
export const cos_ppc_attrindex = 0x0B;
export const cos_macro_attrindex = 0x0C;
export const cos_delim_attrindex = 0x0D;
export const cos_extrfn_attrindex = 0x0F;
export const cos_sysf_attrindex = 0x11;
export const cos_oper_attrindex = 0x18;
export const cos_rtnname_attrindex = 0x19;
export const cos_ssysv_attrindex = 0x1B;
export const cos_sysv_attrindex = 0x1C;
export const cos_prop_attrindex = 0x1E;
export const cos_clsname_attrindex = 0x1F;
export const cos_command_attrindex = 0x20;
export const cos_method_attrindex = 0x23;
export const cos_attr_attrindex = 0x24;
export const cos_brace_attrindex = 0x2a;
export const cos_localdec_attrindex = 0x2E;
export const cos_otw_attrindex = 0x2F;
export const cos_param_attrindex = 0x30;
export const cos_localundec_attrindex = 0x31;
export const cos_dcom_attrindex = 0x33;
export const cos_zcom_attrindex = 0x34;
export const cos_zf_attrindex = 0x35;
export const cos_zv_attrindex = 0x36;
export const cos_mem_attrindex = 0x37;
export const cos_jsonb_attrindex = 0x38;
export const cos_embo_attrindex = 0x3b;
export const cos_embc_attrindex = 0x3c;

export const sql_iden_attrindex = 0x08;
export const sql_skey_attrindex = 0x11;
export const sql_qkey_attrindex = 0x12;
export const sql_ekey_attrindex = 0x13;

export const cls_keyword_attrindex = 0x04;
export const cls_clsname_attrindex = 0x05;
export const cls_comment_attrindex = 0x06;
export const cls_desc_attrindex = 0x07;
export const cls_delim_attrindex = 0x08;
export const cls_num_attrindex = 0x09;
export const cls_str_attrindex = 0x10;
export const cls_iden_attrindex = 0x0B;
export const cls_rtnname_attrindex = 0x0D;
export const cls_param_attrindex = 0x18;

export const xml_tagdelim_attrindex = 0x03;
export const xml_attr_attrindex = 0x06;

export const javascript_delim_attrindex = 0x04;

export enum DEBUG_CATEGORY
{
    DEBUG_CATEGORY_UNKNOWN,
    DEBUG_CATEGORY_SYMBOL,
    DEBUG_CATEGORY_OBJECT_OPERATOR,
    DEBUG_CATEGORY_LABEL,
    DEBUG_CATEGORY_DOT_OPERATOR,
    DEBUG_CATEGORY_OBJECT_ATTRIBUTE,
    DEBUG_CATEGORY_VARIABLE
};
