import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: [
      // Tests import './foo.js' (TypeScript ESM convention).
      // Map those to the .tsx source files instead of the compiled .js in dist/
      // which contains unparsable JSX.
      { find: /^\.\/progress\.js$/, replacement: path.resolve(__dirname, "src/progress.tsx") },
      { find: /^\.\/spinner\.js$/, replacement: path.resolve(__dirname, "src/spinner.tsx") },
      { find: /^\.\/panel\.js$/, replacement: path.resolve(__dirname, "src/panel.tsx") },
      { find: /^\.\/table\.js$/, replacement: path.resolve(__dirname, "src/table.tsx") },
      { find: /^\.\/syntax-block\.js$/, replacement: path.resolve(__dirname, "src/syntax-block.tsx") },
      { find: /^\.\/markdown\.js$/, replacement: path.resolve(__dirname, "src/markdown.tsx") },
      { find: /^\.\/traceback\.js$/, replacement: path.resolve(__dirname, "src/traceback.tsx") },
      { find: /^\.\/themes\.js$/, replacement: path.resolve(__dirname, "src/themes.ts") },
      { find: /^\.\/colors\.js$/, replacement: path.resolve(__dirname, "src/colors.ts") },
    ],
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
  },
});
