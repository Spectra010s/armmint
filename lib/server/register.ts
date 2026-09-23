import { existsSync } from "node:fs";
import { registerHooks } from "node:module";

// Match Next's server-only marker and tsconfig aliases in standalone Node server processes.
const root = new URL("../../", import.meta.url);

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

    if (specifier === "next/headers")
      return nextResolve("next/headers.js", context);
    if (specifier === "next/server")
      return nextResolve("next/server.js", context);
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      context.parentURL
    ) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(url)) return nextResolve(url.href, context);
    }
    return nextResolve(specifier, context);
  },
});
