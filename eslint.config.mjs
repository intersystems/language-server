import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
    {
        ignores: ["**/vscode.d.ts", "**/vscode.proposed.d.ts", "client/out/**", "server/out/**", "**/*.config.{mjs,js}", "server/src/analyzer/generated/**"],
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        rules: {
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-namespace": "off",
            "@typescript-eslint/no-empty-object-type": "off",
            "@typescript-eslint/no-unused-vars": "warn",
			"no-control-regex": "off",
        },
    }
);
