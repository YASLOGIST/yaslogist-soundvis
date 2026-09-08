import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "src/assets/**", "coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // R3F frame loop intentionally mutates external three.js objects through
      // refs inside useFrame (mesh.rotation, material.uniforms, …). The new
      // compiler-era rules treat that as impure React state — it isn't.
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      // tsc --noEmit already enforces unused locals/params; keep lint signal clean
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      // TS itself is the source of truth for undefined globals
      "no-undef": "off",
    },
  },
  {
    files: ["**/*.js"],
    languageOptions: { globals: { ...globals.node } },
  },
);
