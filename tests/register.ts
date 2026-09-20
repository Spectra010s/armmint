import { existsSync } from "node:fs";
import { registerHooks } from "node:module";

// Match Next's server-only marker and tsconfig aliases in Node's test runner.
const root = new URL("../", import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return nextResolve("next/dist/compiled/server-only/empty.js", context);
    }

    if (specifier.startsWith("@/")) {
      const path = specifier.slice(2);
      const url = new URL(`${path}.ts`, root);
      return nextResolve(
        existsSync(url) ? url.href : new URL(`${path}/index.ts`, root).href,
        context,
      );
    }

    return nextResolve(specifier, context);
  },
});
