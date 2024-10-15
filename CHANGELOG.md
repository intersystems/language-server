# Changelog

## [2.6.3] - 2024-XX-XX
- Fix issue [#352](https://github.com/intersystems/language-server/issues/352): Hide Deprecated classes and class members from completion lists by default
- Fix issue [#353](https://github.com/intersystems/language-server/issues/353): Fix keyword completion for ClassMethods

## [2.6.2] - 2024-10-07
- Fix issue [#345](https://github.com/intersystems/language-server/issues/345): Add intellisense for variables passed by reference as method arguments
- Fix issue [#347](https://github.com/intersystems/language-server/issues/347): Setting a variable's subscript should not affect the type of that variable
- Fix issue [#348](https://github.com/intersystems/language-server/issues/348): Support intellisense for method arguments that don't have a declared type
- Fix issue [#349](https://github.com/intersystems/language-server/issues/349): Automatically provide intellisense for `%sqlcontext` variable
- Fix issue [#350](https://github.com/intersystems/language-server/issues/350): Use more granular symbols for class members in Outline
- Parser changes:
  - DP-435183: Clear table of known local variables when exiting a routine procedure

## [2.6.1] - 2024-08-30
- Fix issue [#343](https://github.com/intersystems/language-server/issues/343): foldingRange fails on some C-style block comments
- Fix issue [#344](https://github.com/intersystems/language-server/issues/344): Prevent errors during hover when no data was returned from the server

## [2.6.0] - 2024-08-29
- Fix issue [#329](https://github.com/intersystems/language-server/issues/329): Support Unix platforms that don't have the `en_US.UTF-8` locale
- Fix issue [#336](https://github.com/intersystems/language-server/issues/336): Add intellisense for variables set to the returned value of a method, or a property, with a declared type
- Fix issue [#337](https://github.com/intersystems/language-server/issues/337): Improve Hover headers
- Fix issue [#338](https://github.com/intersystems/language-server/issues/338): Add intellisense for macros in Embedded SQL
- Fix issue [#339](https://github.com/intersystems/language-server/issues/339): Macro intellisense doesn't respect `#undef` directive
- Fix issue [#340](https://github.com/intersystems/language-server/issues/340): Add folding ranges for C-style block comments
- Fix issue [#341](https://github.com/intersystems/language-server/issues/341): Improve macro hover documentation
- Fix issue [#342](https://github.com/intersystems/language-server/issues/342): Reduce clutter in class and class member completion lists by default

## [2.5.1] - 2024-07-09
- Fix issue [#328](https://github.com/intersystems/language-server/issues/328): Fix namespace detection for Diagnostic computation
- Fix issue [#331](https://github.com/intersystems/language-server/issues/331): Fix display of method arguments with a colon in the default value
- Fix issue [#333](https://github.com/intersystems/language-server/issues/333): Fix folding ranges when routine labels that don't appear in the first column
- Fix issue [#335](https://github.com/intersystems/language-server/issues/335): Support U2 syntax when ROUTINE LanguageMode = 10
- Parser changes:
  - DP-430950: Support new `Requires` Query keyword

## [2.5.0] - 2024-05-02
- Fix issue [#312](https://github.com/intersystems/language-server/issues/312): Fix routine existence diagnostics for routines that only exist in OBJ form
- Fix issue [#313](https://github.com/intersystems/language-server/issues/313): Add Diagnostic when `ROUTINE` header is missing
- Fix issue [#314](https://github.com/intersystems/language-server/issues/314): Suggest boolean class keywords for completion after typing `Not`
- Fix issue [#315](https://github.com/intersystems/language-server/issues/315): Add warning diagnostics for SQL reserved words in class and property names of persistent classes
- Fix issue [#316](https://github.com/intersystems/language-server/issues/316): Show class description when hovering over a typed variable
- Fix issue [#317](https://github.com/intersystems/language-server/issues/317): Add `DocumentLink` for `##class()` in class description comments
- Fix issue [#318](https://github.com/intersystems/language-server/issues/318): Support optional chaining operator in JavaScript colorer
- Fix issue [#319](https://github.com/intersystems/language-server/issues/319): Outline shows routine labels that don't appear in the first column
- Fix issue [#320](https://github.com/intersystems/language-server/issues/320): Turn routine existence diagnostics on by default
- Fix issue [#321](https://github.com/intersystems/language-server/issues/321): Show detailed descriptions for syntax errors
- Fix issue [#322](https://github.com/intersystems/language-server/issues/322): Add setting to disable undefined variable warning diagnostics
- Fix issue [#323](https://github.com/intersystems/language-server/issues/323): Go to definition on `##super()` will open the superclass's implementation
- Fix issue [#324](https://github.com/intersystems/language-server/issues/324): Add intellisense for variables set to JSON literal constructors
- Fix issue [#325](https://github.com/intersystems/language-server/issues/325): Don't sort inherited `%%OID` members at the top of completion lists
- Fix issue [#326](https://github.com/intersystems/language-server/issues/326): Completion lists in an instance context should include ClassMethods and Parameters
- Fix issue [#327](https://github.com/intersystems/language-server/issues/327): Go to definition on routine label can go to the wrong location
- Parser changes:
  - DP-430347: Track variables in routine procedure blocks
  - DP-430473: Fix variable tracking with embedded SQL in routine procedure blocks
  - DP-430977: Fix coloring of undefined local variables in a ZWrite argument list

## [2.4.4] - 2024-03-27
- Fix issue [#307](https://github.com/intersystems/language-server/issues/307): Add intellisense for property Aliases
- Fix issue [#308](https://github.com/intersystems/language-server/issues/308): Enhance intellisense for %New when %OnNew is defined
- Fix issue [#309](https://github.com/intersystems/language-server/issues/309): Fix coloring of CSS urls that contain a right parenthesis
- Fix issue [#310](https://github.com/intersystems/language-server/issues/310): Update documentation links for preprocessor directives
- Fix issue [#311](https://github.com/intersystems/language-server/issues/311): Fix SignatureHelp parameter highlighting for parameters with default values that contain a comma
- Parser changes:
  - DP-429226: Coloring for User Defined Aggregate Functions (UDAF)
  - DP-429298: Coloring support for new SQL Scalar function DATE_TRUNC()
  - DP-429328: Fix coloring for POSIXTIME, SQL_POSIXTIME
  - DP-429425: Correctly color %NOCHECK, %NOINDEX, %NOTRIGGER, and %NOLOCK as valid SQL keys
  - DP-429426: Coloring for INTERSECT/EXCEPT
  - DP-429457: Coloring for %PARTITION BY
  - DP-429466: Coloring for TRIM(keyword 'string') syntax
  - DP-429498: Coloring for private properties in DDL
  - DP-429632: Enhance coloring for date part abbreviations
  - DP-429811: Coloring for JSON_TABLE
  - DP-430131: Fix coloring of SELECT statement in parentheses

## [2.4.3] - 2024-02-20
- Fix issue [#302](https://github.com/intersystems/language-server/issues/302): Intellisense is garbled for macros with Markdown characters in their definition
- Fix issue [#303](https://github.com/intersystems/language-server/issues/303): Use cached text of file instead of always reading from disk for computing locations
- Fix issue [#304](https://github.com/intersystems/language-server/issues/304): Add documentation for vector functions
- Fix issue [#305](https://github.com/intersystems/language-server/issues/305): Remove #Dim line from `Wrap in Try/Catch` refactor
- Parser changes:
  - DP-428278: Coloring for PREDICT / PROBABILITY functions
  - DP-428564: Coloring for CREATE PROCEDURE/FUNCTION external rotuine support
  - DP-428959: Allow for SQL keywords in table names
  - DP-429078: Coloring for WITH PASSWORD clause of CREATE USER
  - DP-429107: Coloring for CANCEL QUERY
  - DP-429175: Coloring for %DORUNTIME keyword option

## [2.4.2] - 2024-01-18
- Fix issue [#301](https://github.com/intersystems/language-server/issues/301): Error thrown when not using a server connection

## [2.4.1] - 2024-01-18
- Fix issue [#292](https://github.com/intersystems/language-server/issues/292): Add intellisense for instance variable (i%PropertyName) syntax
- Fix issue [#296](https://github.com/intersystems/language-server/issues/296): Code completion doesn't appear when typing dot in a class name at the class level
- Fix issue [#299](https://github.com/intersystems/language-server/issues/299): Add intellisense for class name parameters
- Fix issue [#300](https://github.com/intersystems/language-server/issues/300): Allow `UnknownUser` to not have a password
- Parser changes:
  - DP-426315: Coloring for FREEZE & UNFREEZE PLAN
  - DP-426334: Correct syntax coloring when a parenthesis-enclosed dollar function is used as an oref
  - DP-426396: Coloring for PURGE QUERIES
  - DP-426989: Coloring for CREATE INDEX ... AS ...
  - DP-427139: Coloring for COMPUTECODE [PYTHON | OBJECTSCRIPT]
  - DP-427233: Coloring for EXPLAIN
  - DP-427413: Coloring for CREATE MODEL
  - DP-427471: Coloring for ALTER MODEL
  - DP-427478: Coloring for DROP MODEL
  - DP-427665: Coloring for TRAIN MODEL
  - DP-427729: Coloring for VALIDATE MODEL
  - DP-427985: Coloring for new ML Admin Privileges
  - DP-428056: Coloring for SET ML CONFIGURATION

## [2.4.0] - 2023-10-17
- Fix issue [#282](https://github.com/intersystems/language-server/issues/282): Syntax error in SQL query using PARTITION or OVER
- Fix issue [#288](https://github.com/intersystems/language-server/issues/288): Intellisense for `$ZPOS` system variable doesn't suggest full name `$ZPOSITION`
- Fix issue [#289](https://github.com/intersystems/language-server/issues/289): Go To Definition confuses properties and methods with the same name
- Fix issue [#290](https://github.com/intersystems/language-server/issues/290): Add themes based on VS Code's new Modern default themes
- Fix issue [#291](https://github.com/intersystems/language-server/issues/291): Adopt Diagnostic pull model
- Parser changes:
  - DP-424189: Fix syntax coloring of complex Index definitions on Properties with quoted names
  - DP-425003: Add parser support for /POLL and /POLLDISCON OPEN/USE keywords
  - DP-425015: Fix coloring of JavaScript for...in and for...of loops
  - DP-425498: Properly color & embeddings that use marker syntax and follow a command's expression argument
  - DP-425560: Coloring for BUILD INDEX
  - DP-425908: Coloring for LOAD DATA
  - DP-426025: Coloring for SQL Window functions
  - DP-426213: Coloring for CREATE & DROP SCHEMA

## [2.3.6] - 2023-07-05
- Fix issue [#283](https://github.com/intersystems/language-server/issues/283): Use all include files for macro intellisense in routines
- Fix issue [#284](https://github.com/intersystems/language-server/issues/284): Create Diagnostics for packages in the class Import statement that don't exist
- Fix issue [#286](https://github.com/intersystems/language-server/issues/286): Error thrown when range formatting is triggered automatically on save

## [2.3.5] - 2023-05-22
- Fix issue [#281](https://github.com/intersystems/language-server/issues/281): "Right hand side of instanceof is not an object" error when rendering class reference HTML

## [2.3.4] - 2023-05-22
- Fix issue [#276](https://github.com/intersystems/language-server/issues/276): TypeError causes crash when getting inherited Import list fails
- Fix issue [#277](https://github.com/intersystems/language-server/issues/277): Don't log warnings when server connection is inactive
- Fix issue [#278](https://github.com/intersystems/language-server/issues/278): Support go to definition without an active server connection

## [2.3.3] - 2023-05-03
- Fix issue [#271](https://github.com/intersystems/language-server/issues/271): Add setting to suppress syntax error Diagnostics for specific languages
- Fix issue [#272](https://github.com/intersystems/language-server/issues/272): Expand arguments when hovering over macro defined in the current file
- Fix issue [#273](https://github.com/intersystems/language-server/issues/273): False "Parameter value and type do not match" warning when value is a curly brace enclosed expression
- Fix issue [#275](https://github.com/intersystems/language-server/issues/275): Fix URL encoding for hover Class Reference links

## [2.3.2] - 2023-03-22
- Fix issue [#265](https://github.com/intersystems/language-server/issues/265): Support HTML spans in intellisense from class descriptions
- Fix issue [#266](https://github.com/intersystems/language-server/issues/266): Preserve empty HTML spans in intellisense from class descriptions
- Fix issue [#268](https://github.com/intersystems/language-server/issues/268): Exempt %SYSTEM classes from existence checking after namespace switch
- Fix issue [#269](https://github.com/intersystems/language-server/issues/269): Add support for async/await in Javascript parser
- Fix issue [#270](https://github.com/intersystems/language-server/issues/270): Language Server crashes when file contains switches to a nonexistent namespace
- Parser changes:
  - DP-421460: Support comma-delimited list for @keyframes selectors in CSS parser

## [2.3.1] - 2023-03-02
- Fix issue [#77](https://github.com/intersystems/language-server/issues/77): Incorrect 'Class/Routine/Include file does not exist' Diagnostics after namespace switch
- Fix issue [#261](https://github.com/intersystems/language-server/issues/261): Add parser support for CSS @keyframes rule
- Fix issue [#263](https://github.com/intersystems/language-server/issues/263): Add parser support for JavaScript Null Coalescing Operator (??)
- Fix issue [#264](https://github.com/intersystems/language-server/issues/264): Support HTML tables in intellisense from class descriptions

## [2.3.0] - 2023-02-13
- Fix issue [#257](https://github.com/intersystems/language-server/issues/257): Property parameter intellisense does not respect `PropertyClass` keyword
- Fix issue [#259](https://github.com/intersystems/language-server/issues/259): Correctly color DynamicObject brace syntax in Triggers and SqlComputeCodes
- Fix issue [#260](https://github.com/intersystems/language-server/issues/260): Publish on [Open VSX Registry](https://open-vsx.org/)

## [2.2.1] - 2023-02-01
- Fix issue [#255](https://github.com/intersystems/language-server/issues/255): Improve the TypeHierarchyProvider fallback behaviour
- Fix issue [#256](https://github.com/intersystems/language-server/issues/256): Go To Definition may go to wrong class member

## [2.2.0] - 2023-01-04
- Fix issue [#251](https://github.com/intersystems/language-server/issues/251): "Override Class Members" does not support overriding projections
- Fix issue [#252](https://github.com/intersystems/language-server/issues/252): Add intellisense for variables created by `%New()`, `%Open()` or `%OpenId()`
- Fix issue [#254](https://github.com/intersystems/language-server/issues/254): Add Diagnostics for deprecated or superseded `$ZUTIL` functions
- Parser changes:
  - DP-419184: Add parser support for `ZBREAK` syntax with braces

## [2.1.4] - 2022-12-12
- Fix issue [#250](https://github.com/intersystems/language-server/issues/250): Hyperlink class description hover to full Documatic information
- Parser changes:
  - DP-418357: Enable embedding token recognition for JavaScript template literals
  - DP-418766: Add parser support for `##Quote()`, `##QuoteExp()` and `##BeginQuote text ##EndQuote`

## [2.1.3] - 2022-10-27
- Fix issue [#248](https://github.com/intersystems/language-server/issues/248): Extension incorrectly prompts for InterSystems Server Credentials when using no authentication

## [2.1.2] - 2022-10-03
- Fix issue [#243](https://github.com/intersystems/language-server/issues/243): Scope cookies to a username on a server 
- Fix issue [#244](https://github.com/intersystems/language-server/issues/244): Language Server crashes when editing Parameter that has a type
- Fix issue [#245](https://github.com/intersystems/language-server/issues/245): Add types for Property and Parameter hover headers
- Fix issue [#246](https://github.com/intersystems/language-server/issues/246): Semantic tokens occasionally disappear during typing
- Fix issue [#247](https://github.com/intersystems/language-server/issues/247): Catch errors thrown when getting session from Server Manager 3's auth provider
- Parser changes:
  - DP-417337: Fix parsing of argumentless commands followed by /* comments

## [2.1.1] - 2022-09-19
- Parser changes:
  - DP-416413: Support for `/ENV` Open keyword parameter
  - DP-416891: Support for `/COMPRESS` Open/Use keyword parameter
  - DP-416928: Improve parsing of XData block when `MimeType` keyword is present
  - DP-417035: Parser updates for vector features

## [2.1.0] - 2022-08-04
- Fix issue [#122](https://github.com/intersystems/language-server/issues/122): Extension settings cannot be set per workspace or per folder
- Fix issue [#228](https://github.com/intersystems/language-server/issues/228): Add embedded language Request Forwarding for HTML, CSS and JavaScript
- Fix issue [#240](https://github.com/intersystems/language-server/issues/240): Automatically trigger SignatureHelp when selecting a method or macro `CompletionItem` that takes arguments
- Fix issue [#241](https://github.com/intersystems/language-server/issues/241): Language Server crashes with "Unhandled method intersystems/server/resolveFromUri" error
- Parser changes:
  - DP-415955: Parse command errors when line contains ##class as syntax errors instead of neutral

## [2.0.5] - 2022-07-25
- Fix issue [#232](https://github.com/intersystems/language-server/issues/232): SignatureHelp intellisense highlights incorrect argument if preceding argument contains a comma
- Fix issue [#233](https://github.com/intersystems/language-server/issues/233): Support for folding region markers at the class level
- Fix issue [#234](https://github.com/intersystems/language-server/issues/234): Generated classes do not appear in intellisense for for class names
- Fix issue [#235](https://github.com/intersystems/language-server/issues/235): When using autocomplete for a system function/variable, the dollar sign may get dropped
- Fix issue [#236](https://github.com/intersystems/language-server/issues/236): Add formatting setting to expand abbreviated class names
- Fix issue [#237](https://github.com/intersystems/language-server/issues/237): Allow comments following a folding region marker
- Fix issue [#239](https://github.com/intersystems/language-server/issues/239): Support nested routine labels in `DocumentSymbolProvider`

## [2.0.4] - 2022-06-22
- Fix issue [#229](https://github.com/intersystems/language-server/issues/229): `Override Class Members` command may override members that weren't selected
- Parser, completion and formatting support for columnar storage/vector features.

## [2.0.3] - 2022-05-23
- Fix issue [#227](https://github.com/intersystems/language-server/issues/227): Upgrade to vscode-languageclient/server version 8.0.0
- Parser changes:
  - DP-409373: Support Python 3.10 syntax (structural pattern matching and parenthesized context managers)
  - DP-414284: Support referencing quoted class parameters in ObjectScript parser

## [2.0.2] - 2022-04-25
- Fix issue [#222](https://github.com/intersystems/language-server/issues/222): Language Server crashes when class `Import` keyword is present but empty
- Fix issue [#224](https://github.com/intersystems/language-server/issues/224): XData parsing does not handle header comments in XML body
- Fix issue [#225](https://github.com/intersystems/language-server/issues/225): Add hover and completion support for Storage definitions
- Fix issue [#226](https://github.com/intersystems/language-server/issues/226): Language Server crashes on some Python methods

## [2.0.1] - 2022-03-31
- Fix issue [#219](https://github.com/intersystems/language-server/issues/219): Language Server REST requests do not use CA certs from OS cert store
- Fix issue [#220](https://github.com/intersystems/language-server/issues/220): Extension reports noisy error message when REST request fails

## [2.0.0] - 2022-03-30
- Add support for alpine-x64, alpine-arm64, darwin-arm64 and linux-arm64 platforms.
- Build parsers as a [Node-API](https://nodejs.org/api/n-api.html) C++ addon.
- Only parse a document once per content change to avoid unnecessary work.
- Use [platform-specific vsixes](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#platformspecific-extensions) to reduce package size.
- Webpack extension to reduce package size.
- Fix issue [#209](https://github.com/intersystems/language-server/issues/209): Errors when parsing CSS custom properties embedded in an ObjectScript method
- Fix issue [#213](https://github.com/intersystems/language-server/issues/213): `vh` and `vw` CSS units are marked as invalid
- ~~Fix issue [#219](https://github.com/intersystems/language-server/issues/219): Language Server REST requests do not use CA certs from OS cert store~~
- Other parser changes:
  - DP-409809: Coloring for CREATE/ALTER TABLE syntax extensions
  - DP-410204: Coloring for SET OPTION extensions
  - DP-410213: Coloring for CREATE OR REPLACE TRIGGER, FUNCTION, QUERY, and PROC[EDURE]
  - DP-411463: Add parser support for all CSS units

## [1.2.9] - 2022-02-15
- Fix issue [#215](https://github.com/intersystems/language-server/issues/215): Fix sorting for generated methods for inherited propeties in completion lists
- Fix issue [#216](https://github.com/intersystems/language-server/issues/216): Noisy failure when `"active": false` in `objectscript.conn`
- Fix issue [#217](https://github.com/intersystems/language-server/issues/217): Recognize new `objectscript-int` language id

## [1.2.8] - 2022-01-13
- Fix issue [#204](https://github.com/intersystems/language-server/issues/204): Class parser interprets modulo operator as a CSP extension
- Fix issue [#210](https://github.com/intersystems/language-server/issues/210): Add Intellisense for Property data type parameters
- Fix issue [#211](https://github.com/intersystems/language-server/issues/211): Improve behavior in workspaces with no server connection

## [1.2.7] - 2021-12-17
- Fix issue [#201](https://github.com/intersystems/language-server/issues/201): Contents of `<EXAMPLE>` HTML tags shown on one line in Intellisense tooltips
- Fix issue [#202](https://github.com/intersystems/language-server/issues/202): Add handler for `exit` request
- Fix issue [#203](https://github.com/intersystems/language-server/issues/203): Add `%PARALLEL` to applicable queries that contain `UNION ALL`
- Fix issue [#207](https://github.com/intersystems/language-server/issues/207): Support InterSystems Server Manager 3.0's `AuthenticationProvider`
- Fix issue [#208](https://github.com/intersystems/language-server/issues/208): Add support for new `<arg>`, `<args>` and `<return>` Documatic HTML tags

## [1.2.6] - 2021-11-05
- Fix issue [#199](https://github.com/intersystems/language-server/issues/199): Extra slash added before `pathPrefix` causes 404 errors
- Fix issue [#200](https://github.com/intersystems/language-server/issues/200): Update README to point to new `Settings Reference` documentation page

## [1.2.5] - 2021-10-22
- Fix issue [#193](https://github.com/intersystems/language-server/issues/193): Add error Diagnostic for missing package in class definition line
- Fix issue [#194](https://github.com/intersystems/language-server/issues/194): Add `TypeHierarchy` support for classes
- Fix issue [#195](https://github.com/intersystems/language-server/issues/195): HTML parser doesn't recognize CSP `<server>` tag
- Fix issue [#196](https://github.com/intersystems/language-server/issues/196): Improve handling of `<EXAMPLE>` HTML tags in Intellisense tooltips
- Fix issue [#198](https://github.com/intersystems/language-server/issues/198): Internally reported parser bugs

## [1.2.4] - 2021-09-13
- Fix issue [#190](https://github.com/intersystems/language-server/issues/190): Add Diagnostics for Deprecated classes
- Fix issue [#191](https://github.com/intersystems/language-server/issues/191): Error while hovering over non-existent class
- Fix issue [#192](https://github.com/intersystems/language-server/issues/192): Internally reported parser bugs

## [1.2.3] - 2021-08-24
- Fix issue [#170](https://github.com/intersystems/language-server/issues/170): Automatically provide intellisense for certain % variables
- Fix issue [#178](https://github.com/intersystems/language-server/issues/178): Go to definition (F12) on Labels Case-Sensitive issue
- Fix issue [#180](https://github.com/intersystems/language-server/issues/180): Go to definition on routine label in another routine doesn't take you to the label
- Fix issue [#181](https://github.com/intersystems/language-server/issues/181): Else command incorrectly shortened to "e" during formatting
- Fix issue [#183](https://github.com/intersystems/language-server/issues/183): ByRef and Output variables are present in the "Outline" section of a file when multilineMethodArgs is true
- Fix issue [#184](https://github.com/intersystems/language-server/issues/184): Provide DocumentLinks for HTML tags in class documentation blocks
- Fix issue [#187](https://github.com/intersystems/language-server/issues/187): Support "Go to Type Definition" on methods and properties that have types
- Fix issue [#188](https://github.com/intersystems/language-server/issues/188): Support intellisense for chained method calls

## [1.2.2] - 2021-06-30
- Fix issue [#169](https://github.com/intersystems/language-server/issues/169): Syntax error Diagnostics are not calculated for Parameter definitions
- Fix issue [#172](https://github.com/intersystems/language-server/issues/172): Internally reported parser bugs
- Fix issue [#173](https://github.com/intersystems/language-server/issues/173): Embedded Python support

## [1.2.1] - 2021-06-16
- Fix issue [#29](https://github.com/intersystems/language-server/issues/29): Semantic token coloring messes up upon deletion
- Fix issue [#168](https://github.com/intersystems/language-server/issues/168): Go to definition opens wrong routine when two labels are separated by a comma

## [1.2.0] - 2021-06-09
- PR [#165](https://github.com/intersystems/language-server/issues/165): Introduce QuickFixes and code refactoring functionality
- Allow extension in untrusted workspaces

## [1.1.6] - 2021-05-24
- Fix issue [#45](https://github.com/intersystems/language-server/issues/45): When using client side source control, go to definition should use the local file and not open the server version
- Fix issue [#158](https://github.com/intersystems/language-server/issues/158): Support Intellisense when method arguments appear on multiple lines
- Fix issue [#161](https://github.com/intersystems/language-server/issues/161): Hovering over macro in CSP file throws an error
- Fix issue [#162](https://github.com/intersystems/language-server/issues/162): Add DocumentSymbols and FoldingRanges for CSP script tags
- Fix issue [#163](https://github.com/intersystems/language-server/issues/163): Add Diagnostics for Deprecated class members
- Fix issue [#164](https://github.com/intersystems/language-server/issues/164): Parsing fails for files >6000 lines long

## [1.1.5] - 2021-05-04
- Fix issue [#150](https://github.com/intersystems/language-server/issues/150): Hovering over blank last line of file causes error
- Fix issue [#151](https://github.com/intersystems/language-server/issues/151): Typing "(" on a blank line causes an error
- Fix issue [#152](https://github.com/intersystems/language-server/issues/152): Language Server is crashing on startup in Insiders
- Fix issue [#153](https://github.com/intersystems/language-server/issues/153): LS DocumentSelector should confine itself to schemes it can handle
- Fix issue [#155](https://github.com/intersystems/language-server/issues/155): class parameter marked with warning about type mismatch
- Fix issue [#156](https://github.com/intersystems/language-server/issues/156): SignatureHelp not showing for methods without a description or return type
- Fix issue [#157](https://github.com/intersystems/language-server/issues/157): SignatureHelp parameter underlining doesn't work when class name parameter values are present
- Fix issue [#159](https://github.com/intersystems/language-server/issues/159): Improve README to explain consequences of setting `"enabled": false` on `editor.semanticTokenColorCustomizations` object

## [1.1.4] - 2021-04-09
- Fix issue [#74](https://github.com/intersystems/language-server/issues/74): Be an EvaluatableExpressionProvider
- Fix issue [#146](https://github.com/intersystems/language-server/issues/146): Values for keywords "Owner" and "Aliases" are not tokenized correctly

## [1.1.3] - 2021-03-10
- Fix issue [#71](https://github.com/intersystems/language-server/issues/71): Override method command
- Fix issue [#139](https://github.com/intersystems/language-server/issues/139): Don't show methods marked NotInheritable in the completion list
- Fix issue [#140](https://github.com/intersystems/language-server/issues/140): Hover not working for properties and parameters
- Fix issue [#141](https://github.com/intersystems/language-server/issues/141): Provide Hover and Completion support for ClientMethod compiler keywords
- Fix issue [#142](https://github.com/intersystems/language-server/issues/142): Don't suggest UDL keyword in code completion if it's already specified
- Fix issue [#143](https://github.com/intersystems/language-server/issues/143): Don't create Folding Ranges for labels in classes
- Fix issue [#144](https://github.com/intersystems/language-server/issues/144): No intellisense for back-to-back macros
- Fix issue [#145](https://github.com/intersystems/language-server/issues/145): Compiler keyword completion list includes invalid keywords

## [1.1.2] - 2021-02-23
- Fix issue [#137](https://github.com/intersystems/language-server/issues/137): Completion request fails for local variables

## [1.1.1] - 2021-02-23
- Fix issue [#134](https://github.com/intersystems/language-server/issues/134): Outdated documentation for $LISTFROMSTRING
- Fix issue [#135](https://github.com/intersystems/language-server/issues/135): False syntax error when using 3rd parameter of $LISTFROMSTRING
- Fix issue [#136](https://github.com/intersystems/language-server/issues/136): Provide Intellisense for methods generated by the member inheritance mechanism

## [1.1.0] - 2021-02-02
- Fix issue [#15](https://github.com/intersystems/language-server/issues/15): Better support for Peek Definition functionality
- Fix issue [#125](https://github.com/intersystems/language-server/issues/125): Relationships are not showing up in completion suggestion list
- Fix issue [#126](https://github.com/intersystems/language-server/issues/126): Macros defined in current file are not showing up in completion suggestion list
- Fix issue [#127](https://github.com/intersystems/language-server/issues/127): Add code completion for nested references
- Fix issue [#128](https://github.com/intersystems/language-server/issues/128): Go to definition on Relationship doesn't take you to its location in the class
- Fix issue [#130](https://github.com/intersystems/language-server/issues/130): Hover and code completion doesn't work for Relationship compiler keywords
- Fix issue [#132](https://github.com/intersystems/language-server/issues/132): Update vscode-languageserver and vscode-languageclient to 7.0.0

## [1.0.7] - 2021-01-26
- Fix issue [#88](https://github.com/intersystems/language-server/issues/88): Properly handle retrigger signatureHelp requests that don't contain an active signature
- Fix issue [#111](https://github.com/intersystems/language-server/issues/111): Replace requests to POST /action/index with POST /action/query where possible
- Fix issue [#112](https://github.com/intersystems/language-server/issues/112): Parsing problem with $system.SQL
- Fix issue [#113](https://github.com/intersystems/language-server/issues/113): Syntax error diagnostic should span entire range of continuous error tokens
- Fix issue [#114](https://github.com/intersystems/language-server/issues/114): Import resolution does not include import statements from superclasses
- Fix issue [#116](https://github.com/intersystems/language-server/issues/116): List of suggestions for argument datatypes for a class query is incomplete
- Fix issue [#117](https://github.com/intersystems/language-server/issues/117): Theme suggestion dialog should not offer workspace option when no workspace is open
- Fix issue [#118](https://github.com/intersystems/language-server/issues/118): Hover documentation for commands and system functions needs more linebreaks
- Fix issue [#119](https://github.com/intersystems/language-server/issues/119): Add "deprecated" CompletionItemFlag for deprecated class members
- Fix issue [#120](https://github.com/intersystems/language-server/issues/120): Filter imported classes to the top of completion list
- Fix issue [#121](https://github.com/intersystems/language-server/issues/121): Support nested SignatureHelp's
- Fix issue [#124](https://github.com/intersystems/language-server/issues/124): Goto definition fails with server:namespace definition

## [1.0.6] - 2020-12-16
- Fix issue [#19](https://github.com/intersystems/language-server/issues/19): do {} while in SqlComputeCode marked as a syntax error
- Fix issue [#39](https://github.com/intersystems/language-server/issues/39): embeded &js syntax
- Fix issue [#56](https://github.com/intersystems/language-server/issues/56): attempt to zw the value of a returned object is highlighted as a syntax error
- Fix issue [#60](https://github.com/intersystems/language-server/issues/60): Double quotes in an embedded SQL statement (needed when using reserved words) is marked as syntax error
- Fix issue [#75](https://github.com/intersystems/language-server/issues/75): Problem reported for valid ##class("classname") syntax
- Fix issue [#83](https://github.com/intersystems/language-server/issues/83): Support for renaming variables
- Fix issue [#84](https://github.com/intersystems/language-server/issues/84): Be a TypeDefinitionProvider
- Fix issue [#85](https://github.com/intersystems/language-server/issues/85): Folding of class Storage section is incorrect
- Fix issue [#87](https://github.com/intersystems/language-server/issues/87): Frequent errors reported with incomplete code
- Fix issue [#89](https://github.com/intersystems/language-server/issues/89): Properly parse macro arguments that contain () for hover expansion
- Fix issue [#90](https://github.com/intersystems/language-server/issues/90): Return macro definition for hover documentation if expansion fails
- Fix issue [#92](https://github.com/intersystems/language-server/issues/92): Edit default themes to explictly color all tokens
- Fix issue [#93](https://github.com/intersystems/language-server/issues/93): Adding comment causes A request has failed error
- Fix issue [#94](https://github.com/intersystems/language-server/issues/94): zwrite supports any expression not only variables
- Fix issue [#96](https://github.com/intersystems/language-server/issues/96): Go to definition on a declared local variable or method parameter should jump to the declaration
- Fix issue [#98](https://github.com/intersystems/language-server/issues/98): Bug: Parameter type detection incorrectly indicates type-value mismatch
- Fix issue [#99](https://github.com/intersystems/language-server/issues/99): Bug: Include files with '.' in the name are parsed incorrectly when referenced from another include file
- Fix issue [#100](https://github.com/intersystems/language-server/issues/100): Bug: Hover suggestions don't include documatic description if description begins with html tag
- Fix issue [#101](https://github.com/intersystems/language-server/issues/101): Hover suggestion for methods does not include method parameters and return type
- Fix issue [#102](https://github.com/intersystems/language-server/issues/102): Completion provider should only suggest %Library.Query or its subclasses for the type of a Class Query
- Fix issue [#103](https://github.com/intersystems/language-server/issues/103): $System.Context parsed incorrectly
- Fix issue [#104](https://github.com/intersystems/language-server/issues/104): Strip out "style" HTML tags from class reference documentation
- Fix issue [#106](https://github.com/intersystems/language-server/issues/106): #dim provides no code completion inside a trigger
- Fix issue [#107](https://github.com/intersystems/language-server/issues/107): Add "Go To Declaration" support
- Fix issue [#108](https://github.com/intersystems/language-server/issues/108): Add "Go To Declaration" support for variables in the PublicList
- Fix issue [#109](https://github.com/intersystems/language-server/issues/109): Activate color theme for workspace only

## [1.0.5] - 2020-11-12
- Fix issue [#52](https://github.com/intersystems/language-server/issues/52): Request textDocument/documentSymbol failed with message: Cannot read property 'p' of undefined
- Fix issue [#53](https://github.com/intersystems/language-server/issues/53): Become a FoldingRangeProvider
- Fix issue [#54](https://github.com/intersystems/language-server/issues/54): Completion request fails when "." is typed as first non-whitespace character on a line
- Fix issue [#55](https://github.com/intersystems/language-server/issues/55): Hover fails on Embedded SQL identifier that is the first word on the line
- Fix issue [#62](https://github.com/intersystems/language-server/issues/62): DocumentSymbol doesn't cover full range of multi-line macro definition
- Fix issue [#63](https://github.com/intersystems/language-server/issues/63): Don't provide completion suggestions inside a comment
- Fix issue [#64](https://github.com/intersystems/language-server/issues/64): Code completion needs to understand that %&lt;classname&gt; is shorthand for %Library.&lt;classname&gt;
- Fix issue [#66](https://github.com/intersystems/language-server/issues/66): Suggestions for $functions and variables should follow system.case settings
- Fix issue [#67](https://github.com/intersystems/language-server/issues/67): Signature help logic
- Fix issue [#69](https://github.com/intersystems/language-server/issues/69): Update class definition regex to support unicode characters
- Fix issue [#72](https://github.com/intersystems/language-server/issues/72): Dotted-DO folding is too greedy
- Fix issue [#73](https://github.com/intersystems/language-server/issues/73): Subroutine folding is too greedy
- Fix issue [#76](https://github.com/intersystems/language-server/issues/76): Properly handle quoted class member identifiers
- Fix issue [#79](https://github.com/intersystems/language-server/issues/79): Add Folding Ranges for ObjectScript code blocks
- Fix issue [#80](https://github.com/intersystems/language-server/issues/80): Invoking signature help on existing methods
- Fix issue [#82](https://github.com/intersystems/language-server/issues/82): Incorrect destination go to definition

## [1.0.4] - 2020-10-28
- Fix issue [#27](https://github.com/intersystems/language-server/issues/27): DeprecationWarning in LS Output channel at startup
- Fix issue [#31](https://github.com/intersystems/language-server/issues/31): Issue with syntax coloring when Japanese(UTF8) letters are included
- Fix issue [#44](https://github.com/intersystems/language-server/issues/44): prompt for "use dark theme" if i'm using a dark vscode background
- Fix issue [#46](https://github.com/intersystems/language-server/issues/46): SQL Function(s) in class query
- Fix issue [#48](https://github.com/intersystems/language-server/issues/48): Add .gitignore for OS files
- Fix issue [#50](https://github.com/intersystems/language-server/issues/50): Go to definition for method of current class in client-side editing mode shouldn't open server version

## [1.0.3] - 2020-10-26
- Fix issue [#41](https://github.com/intersystems/language-server/issues/41): Still scope for reducing number of web sessions 1.0.2 creates

## [1.0.2] - 2020-10-23
- Fix issue [#23](https://github.com/intersystems/language-server/issues/23): Hover and Go to macro definition in the same place and in macro definition
- Fix issue [#33](https://github.com/intersystems/language-server/issues/33): Requests to the API does not use cookie
- Fix issue [#34](https://github.com/intersystems/language-server/issues/34): Go to definition (F12) throwing error
- Fix issue [#40](https://github.com/intersystems/language-server/issues/40): Is it possible to switch off absent classes detection?

## [1.0.1] - 2020-10-21
- ~~Fix issue [#33](https://github.com/intersystems/language-server/issues/33): Requests to the API does not use cookie~~

## [1.0.0] - 2020-10-20
- Initial release