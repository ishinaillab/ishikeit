import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.js"]
        },
        tsconfigRootDir: import.meta.dirname
      }
    }
  },
  {
    files: ["scripts/*.mjs"],
    // These standalone Node scripts are covered by native node:test, not TS compilation.
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        AbortSignal: "readonly",
        TextDecoder: "readonly",
        URL: "readonly",
        Response: "readonly",
        fetch: "readonly",
        process: "readonly",
        console: "readonly"
      }
    }
  }
);
