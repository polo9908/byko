import tseslint from "@electron-toolkit/eslint-config-ts"
import eslintPluginReact from "eslint-plugin-react"
import eslintPluginReactHooks from "eslint-plugin-react-hooks"

export default tseslint.config(
  { ignores: ["**/node_modules", "**/dist", "**/out"] },
  tseslint.configs.recommended,
  {
    files: ["src/renderer/**/*.{ts,tsx}"],
    plugins: {
      react: eslintPluginReact,
      "react-hooks": eslintPluginReactHooks,
    },
    rules: {
      ...eslintPluginReact.configs.flat.recommended.rules,
      ...eslintPluginReactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
    },
    languageOptions: {
      ...eslintPluginReact.configs.flat.recommended.languageOptions,
    },
    settings: {
      react: { version: "detect" },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    // L'extension navigateur est du JavaScript exécuté par Chrome, qui n'exécute
    // pas de TypeScript : les règles de typage ne s'y appliquent pas, et `chrome`
    // n'existe que dans ce contexte.
    files: ["browser-extension/**/*.js"],
    languageOptions: {
      globals: { chrome: "readonly" },
    },
    rules: {
      "@typescript-eslint/explicit-function-return-type": "off",
    },
  },
  {
    // Scripts d'outillage, lancés tels quels par Node et hors build TypeScript.
    files: ["scripts/**/*.mjs"],
    rules: {
      "@typescript-eslint/explicit-function-return-type": "off",
    },
  },
)
