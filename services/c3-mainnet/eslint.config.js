import tseslint from "typescript-eslint";

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    ignores: ["dist/**", "generated-results/**"],
  },
  {
    files: [
      "src/**/*.ts",
      "scripts/**/*.ts",
      "tests/**/*.ts",
      "research/**/*.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      "no-console": ["error", { allow: ["log", "error"] }],
    },
  },
);
