import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
    {
        ignores: ["**/vscode.d.ts", "**/vscode.proposed.d.ts", "client/out/**", "server/out/**", "**/*.config.js"],
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        languageOptions: {
            globals: {
                ...globals.node,
            },
            ecmaVersion: 2018,
            sourceType: "module",
            parserOptions: {
                server: "./server/tsconfig.json",
                client: "./client/tsconfig.json",
            },
        },
        rules: {
            "@typescript-eslint/no-explicit-any": "off",
        },
    }
);