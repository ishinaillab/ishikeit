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
          allowDefaultProject: ["eslint.config.js", "scripts/*.mjs"]
        },
        tsconfigRootDir: import.meta.dirname
      }
    }
  },
  {
    files: ["scripts/*.mjs"],
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
