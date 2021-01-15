# Changelog

## [1.0.7] - 2021-XX-XX
- Fix issue [#111](https://github.com/intersystems/language-server/issues/111): Replace requests to POST /action/index with POST /action/query where possible
- Fix issue [#113](https://github.com/intersystems/language-server/issues/113): Syntax error diagnostic should span entire range of continuous error tokens
- Fix issue [#114](https://github.com/intersystems/language-server/issues/114): Import resolution does not include import statements from superclasses
- Fix issue [#116](https://github.com/intersystems/language-server/issues/116): List of suggestions for argument datatypes for a class query is incomplete

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