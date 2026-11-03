// ESLint flat config. Goals: catch real bugs (type-aware rules), keep style to Prettier.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  { ignores: ["node_modules", ".next", "coverage", "docs/muse-code", "skills", "skill-src"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Promises that are never awaited hide failures; agents are async-heavy, so enforce this.
      "@typescript-eslint/no-floating-promises": "error",
      // `any` is allowed sparingly (LLM payloads) but unused vars are not.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      eqeqeq: ["error", "always"],
      "no-console": "off", // scripts print reports; the app will use a logger (Part 3)
    },
  },
  {
    // Plain JS config files are not part of the TS project.
    files: ["*.config.js"],
    ...tseslint.configs.disableTypeChecked,
  },
  prettier,
);
