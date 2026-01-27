# Contribuindo

## Estrutura do projeto

- `client/`: extensão do VS Code (Language Client). Código em `client/src/`, build em `client/out/`.
- `server/`: servidor de linguagem (LSP). Código em `server/src/`, build em `server/out/`.
- `server/lib/`: binários do lexer nativo por plataforma (`*-isclexer.node`) e typings (`isclexer.node.d.ts`).
- `themes/`: temas empacotados.
- `images/`: assets de marketplace/README.

## Comandos (build, teste e desenvolvimento)

Use Node.js 20 (mesma versão do CI).

- `npm install`: Instala dependências na raiz e executa `postinstall` para instalar deps de `client/` e `server/`.
- `npm run compile`: Build TypeScript (`tsc -b`) de `client/` + `server/`.
- `npm run watch`: Build incremental em modo watch.
- `npm run webpack:dev`: Build webpack para desenvolvimento/debug local.
- `npm run webpack`: Build webpack de produção (usado para empacotar).
- `npm run clean`: Remove `client/out` e `server/out`.

Nota do lexer nativo: `server/src/**` importa `server/lib/isclexer.node`, que é gitignored. Crie/atualize o arquivo localmente com:

`npm run select-isclexer`

O comando acima seleciona e copia automaticamente o binário correto (por OS/arquitetura) para `server/lib/isclexer.node`.

Cross-build (ex.: gerar VSIX de Windows a partir do macOS):

`ISCLEXER_TARGET=win32-x64 npm run select-isclexer`

Observação: `npm run webpack` e `npm run webpack:dev` já executam `select-isclexer` automaticamente.

## Estilo de código e convenções

- TypeScript seguindo as convenções do repo: tabs (não espaços) e, em geral, aspas simples.
- Mantenha mudanças consistentes com arquivos próximos (importações, ponto e vírgula, nomes).
- Prefira commits pequenos e focados; evite alterações desnecessárias em lockfiles (`package-lock.json`).

## Testes

Não há uma suíte dedicada de testes unitários neste repositório. Valide mudanças com:

- `npm run compile` (typecheck/build)
- Rodando a extensão via VS Code `.vscode/launch.json` (“Launch Client”) e exercitando a funcionalidade alterada.

## Commits e Pull Requests

- Mensagens de commit costumam ser imperativas e curtas, com referência a issue (ex.: `Fixes #123`).
- No PR, inclua: o que mudou, como validar (passo a passo e/ou arquivo de exemplo), issues relacionadas e plataforma/arquitetura se envolver o lexer nativo.
