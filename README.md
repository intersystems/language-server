# InterSystems Language Server

> **Note:** The best way to install and use this extension is by installing the [InterSystems ObjectScript Extension Pack](https://marketplace.visualstudio.com/items?itemName=intersystems-community.objectscript-pack) and following the [documentation here](https://docs.intersystems.com/components/csp/docbook/DocBook.UI.Page.cls?KEY=GVSCO).

This is a [LSP](https://microsoft.github.io/language-server-protocol/) compliant language server for [InterSystems](http://www.intersystems.com/our-products/) ObjectScript powered by Node.js and written primarily in TypeScript. It is maintained by InterSystems.

## Features

- [Semantic token](https://code.visualstudio.com/api/language-extensions/semantic-highlight-guide)-based coloring for InterSystems ObjectScript classes, routines and CSP files, with support for embedded languages like SQL, Python, HTML, XML, Java, JavaScript and CSS.
- Hover information for ObjectScript commands, system functions, system variables, classes, class members, macros, preprocessor directives, class keywords, Parameter types, Storage definition keywords, and embedded SQL tables, fields and class methods and queries invoked as SQL procedures.
- [Go to definition](https://code.visualstudio.com/docs/editor/editingevolved#_go-to-definition) for ObjectScript classes, class members, macros, routines, routine labels, class name parameters, `##super()`, and embedded SQL tables, fields and class methods and queries invoked as SQL procedures.
- Code completion for ObjectScript classes, class members, system functions, system variables, macros, include files, package imports, preprocessor directives, class keywords, class keyword values, class Parameter types, Storage definition keywords, routines and globals. Code completion for properties referenced using instance variable syntax (`i%PropertyName`) must be triggered manually using `Ctrl-Space` with the cursor immediately after the `i%`.
- Code completion for XML Element names, Attribute names and Attribute values within XData blocks that have the XMLNamespace keyword set to a URL that corresponds to a Studio Assist Schema (SASchema).
- Signature help for ObjectScript methods and macros that accept arguments.
- Document symbols for ObjectScript classes, routines and include files.
- Full document and range-based code formatting for the following:
  - Normalize the case of ObjectScript commands, system functions and system variables.
  - Normalize the usage of short or long versions of ObjectScript commands, system functions and system variables.
  - Expand short class names to include packages (off by default)
- Code linting for ObjectScript classes, routines and CSP files that checks for the following:
  - Syntax errors, including for embedded languages.
  - References to local variables that may be undefined.
  - Classes and routines that don't exist in the database.
  - Invalid class Parameter types.
  - Mismatches between declared class Parameter types and the assigned value.
  - Classes, Methods, Parameters and Properties that are [Deprecated](https://docs.intersystems.com/irislatest/csp/docbook/Doc.View.cls?KEY=ROBJ_method_deprecated).
  - `$ZUTIL` functions that [are deprecated or have been superseded](https://docs.intersystems.com/latest/csp/docbook/DocBook.UI.Page.cls?KEY=RCOS_replacements).
  - [SQL reserved words](https://docs.intersystems.com/irislatest/csp/docbook/DocBook.UI.Page.cls?KEY=RSQL_reservedwords) used in class and property names of persistent classes.
- [Folding Ranges](https://code.visualstudio.com/docs/editor/codebasics#_folding) for the following:
  - ObjectScript code blocks (If/ElseIf/Else, Try/Catch, For, While, etc.)
  - Class members
  - ObjectScript routine labels
  - Class descriptions
  - ObjectScript documentation comments (/// in first column)
  - XML tags in XData blocks
  - Storage XML tags
  - JSON in XData blocks
  - %DynamicObject and %DynamicArray
  - ObjectScript preprocessor code blocks
  - Multi-line macro definitions
  - Dotted Do blocks
  - Embedded code blocks (SQL, HTML, JavaScript)
  - Region markers:
    - In ObjectScript: `#;#region` or `//#region` to start and `#;#endregion` or `//#endregion` to end
    - In class comments: `//#region` to start and `//#endregion` to end
- [Symbol Renaming](https://code.visualstudio.com/docs/editor/refactoring#_rename-symbol) for ObjectScript local variables and method arguments within class definitions.
- [Go to type definition](https://code.visualstudio.com/docs/editor/editingevolved#_go-to-type-definition) for ObjectScript methods, properties, method arguments and variables.
- Go to declaration for ObjectScript method arguments, variables declared with `#Dim` and variables in the [PublicList](https://docs.intersystems.com/irislatest/csp/docbook/Doc.View.cls?KEY=ROBJ_method_publiclist).
- Command to override inherited class members. To invoke the command, right-click in a blank line of a class definition body and select the `Override Class Members` row in the menu that appears. The command will insert the selected class member definition(s) at the cursor position where the command was invoked.
- [Evaluatable Expression Provider](https://code.visualstudio.com/api/references/vscode-api#EvaluatableExpressionProvider) that allows the debug hover to evaluate the following:
  - Globals
  - Class parameters
  - Method parameters
  - Private variables
  - Public variables
  - [System variables](https://docs.intersystems.com/irislatest/csp/docbook/Doc.View.cls?KEY=RCOS_VARIABLES)
- [Document Links](https://code.visualstudio.com/api/references/vscode-api#DocumentLink) for [CLASS, METHOD, PROPERTY and QUERY HTML tags](https://docs.intersystems.com/irislatest/csp/docbook/Doc.View.cls?KEY=GOBJ_classes#GOBJ_classdoc_html) and `##class()` syntax in class documentation comments.
- [QuickFix CodeActions](https://code.visualstudio.com/docs/editor/refactoring#_code-actions-quick-fixes-and-refactorings) that resolve the following Diagnostics:
  - [Unqualified class references](https://docs.intersystems.com/irislatest/csp/docbook/Doc.View.cls?KEY=GOBJ_packages#GOBJ_packages_in_classname) in a class definition that don't exist in the database:
    - Select a package containing the unqualified class name to import.
  - Invalid class Parameter types and mismatches between declared class Parameter types and the assigned value:
    - Remove the invalid class Parameter type.
    - Select a correct class Parameter type to replace the invalid one.
  - `$ZUTIL` functions that have been superseded by ClassMethods:
    - Replace the `$ZUTIL` function call with the appropriate ClassMethod.
- Intellisense for the following embedded languages (provided by [request forwarding](https://code.visualstudio.com/api/language-extensions/embedded-languages#request-forwarding)):
  - Hover and code completion for HTML tags and CSS embedded in CSP/CSR files, HTML embedded in ObjectScript using the `&html` directive and CSS embedded in XML XData blocks.
  - Hover, code completion and signature help for JavaScript methods in ObjectScript classes and JavaScript embedded in CSP using `<script>` tags or embedded in ObjectScript using the `&js` directive.
- [Code refactoring CodeActions](https://code.visualstudio.com/docs/editor/refactoring#_code-actions-quick-fixes-and-refactorings) for the following:
  - Wrapping a block of ObjectScript code in a [Try/Catch block](https://docs.intersystems.com/irislatest/csp/docbook/DocBook.UI.Page.cls?KEY=ATRYCATCHFAQ).
  ![](images/TryCatch.gif)
  - Extracting a block of ObjectScript code from an existing method to a new method.
  ![](images/ExtractMethod.gif)
- [Type Hierarchy Provider](https://code.visualstudio.com/api/references/vscode-api#TypeHierarchyProvider) for ObjectScript classes to show subclasses and superclasses in a hierarchical tree view:
![](images/TypeHierarchy.gif)

## Supported Platforms

This extension can be installed on the following platforms:

|              |                |
| ------------ | -------------- |
| `alpine-x64` | `alpine-arm64` |
| `darwin-x64` | `darwin-arm64` |
| `linux-x64`  | `linux-arm64`  |
| `win32-x64`  |                |

## Dependencies

This extension requires that the [vscode-objectscript](https://marketplace.visualstudio.com/items?itemName=intersystems-community.vscode-objectscript) extension be downloaded and enabled.

## InterSystems Product Compatibility

All InterSystems products that include the Atelier APIs (Caché/Ensemble from 2016.2 onward, all versions of InterSystems IRIS) are supported.

## Setup Notes

If the configured user for connection to a server does NOT have the `%All` Role, execute the following query on the server to enable all of this extension's features. This is not necessary when connecting to InterSystems IRIS version 2021.1.3+, 2022.1.2+, or 2022.2+. 

```SQL
GRANT SELECT ON SCHEMA %Dictionary TO %Developer
```

## Configuration Settings

Visit the [Settings Reference page](https://docs.intersystems.com/components/csp/docbook/DocBook.UI.Page.cls?KEY=GVSCO_settings#GVSCO_settings_langserv) of the documentation for a list of all configuration settings provided by this extension. Changes to these settings can be made in the [Visual Studio Code user settings editor](https://code.visualstudio.com/docs/getstarted/settings#_edit-settings).

## Syntax Color Customization

This extension is packaged with four default themes, two light and two dark, that are [Web Content Accessibility Guidelines](https://www.w3.org/WAI/standards-guidelines/wcag/) (WCAG) 2.0 AAA compliant when editing InterSystems files. They have been developed with usability and accessibility in mind and are recommended for all users. Users may also use any VS Code theme downloaded from the marketplace or included by default. While the coloring provided by those themes will be syntactically correct, not all themes provide support for advanced features, such as coloring method arguments differently than local variables. If you wish to customize the colors assigned to InterSystems semantic tokens, there are two approaches, which are detailed below.

### Custom Styling Rules

To customize the colors for one or more of these semantic tokens, add the [editor.semanticTokenColorCustomizations code block](https://code.visualstudio.com/docs/getstarted/themes#_editor-semantic-highlighting) to your user or workspace [settings.json](https://code.visualstudio.com/docs/getstarted/settings#_settings-file-locations) file. For example:

```json
"editor.semanticTokenColorCustomizations": {
    "enabled": true, // enable for all themes, but see note below
    "rules": {
        "ISC_Error":{"foreground":"#F44747","fontStyle":"bold"}
    }
}
```

Note that setting `"enabled": false` in the object shown above does not merely disable the rules within the object. Instead it disables semantic token coloring in all themes and languages, unless you have also changed `"editor.semanticHighlighting.enabled"` from its default value of `"configuredByTheme"`.

### Custom Themes

To create your own custom color theme that provides coloring for InterSystems semantic tokens or modify your existing theme to do so, use the [semanticHighlighting and semanticTokenColors settings](https://code.visualstudio.com/api/language-extensions/semantic-highlight-guide#theming) in your theme definition json file. For example:

```json
"semanticHighlighting": true,
"semanticTokenColors": {
  "ISC_Error": {"foreground": "#ff8484", "bold": true},
  "ISC_Comment": "#80bd66",
  "ISC_StringLiteral": "#d4b57c",
  "ISC_NumericLiteral": "#d4b57c",
  "ISC_ClassName": "#4EC9B0",
  "ISC_ClassMember": "#DCDCAA",
  "ISC_DocComment": "#80bd66",
  "ISC_Parameter": "#ff75f4",
  "ISC_System": "#85a6ff",
  "ISC_Command": "#ffffff",
  "ISC_Keyword": "#85a6ff",
  "ISC_LocalVariable": "#ade2ff",
  "ISC_LocalVariableUnset": "#ade2ff",
  "ISC_PublicVariable": "#64c9ff",
  "ISC_SQLKeyword": "#ffffff",
  "ISC_SQLFunction": "#85a6ff",
  "ISC_Neutral": {"foreground": "#ffffff", "italic": true},
  "XML_Grayout": "#aaaaaa",
  "ISC_Operator": "#ffffff",
  "ISC_Delimiter": "#ffffff",
  "ISC_MarkupText": "#ffffff"
}
```

### Semantic Token Reference

This extension provides the following high-level semantic tokens for coloring similar features across all supported languages:

| ID | Description |
| -- | ----------- |
| `"ISC_ClassMember"` | InterSystems-wide class member token. |
| `"ISC_ClassName"` | InterSystems-wide class and routine name token. |
| `"ISC_Command"` | InterSystems-wide command token. |
| `"ISC_Comment"` | InterSystems-wide comment token. |
| `"ISC_Delimiter"` | InterSystems-wide delimiter token. |
| `"ISC_DocComment"` | InterSystems-wide documentation comment token. |
| `"ISC_Error"` | InterSystems-wide error token. |
| `"ISC_Keyword"` | InterSystems-wide keyword token. |
| `"ISC_LocalVariable"` | InterSystems-wide local variable token. |
| `"ISC_LocalVariableUnset"` | InterSystems-wide unset local variable token. |
| `"ISC_MarkupText"` | InterSystems-wide markup text token. |
| `"ISC_Neutral"` | InterSystems-wide neutral token. |
| `"ISC_NumericLiteral"` | InterSystems-wide numeric literal token. |
| `"ISC_Operator"` | InterSystems-wide operator token. |
| `"ISC_Parameter"` | InterSystems-wide parameter token. |
| `"ISC_PublicVariable"` | InterSystems-wide public variable and global token. |
| `"ISC_SQLFunction"` | InterSystems-wide SQL function token. |
| `"ISC_SQLKeyword"` | InterSystems-wide SQL keyword and datatype token. |
| `"ISC_StringLiteral"` | InterSystems-wide string literal token. |
| `"ISC_System"` | InterSystems-wide system function and variable token. |
