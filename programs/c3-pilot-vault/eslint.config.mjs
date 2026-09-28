import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["target/**", "node_modules/**"],
  },
  ...tseslint.configs.recommended,
);
