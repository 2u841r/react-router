import * as path from "node:path";

import { cloudflare } from "@cloudflare/vite-plugin";
import reactServerDOM from "@jacob-ebey/vite-react-server-dom";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  resolve: {
    external: ["cloudflare:workers"],
  },
  environments: {
    client: {
      build: {
        rollupOptions: {
          input: "src/browser/entry.browser.tsx",
          treeshake: {
            moduleSideEffects: () => {
              return false;
            },
          },
        },
      },
    },
    ssr: {
      resolve: { noExternal: true },
    },
    server: {
      resolve: { noExternal: true },
    },
  },
  plugins: [
    tsconfigPaths({ configNames: ["tsconfig.client.json"] }),
    reactServerDOM({
      browserEnvironment: "client",
      serverEnvironments: ["server"],
      ssrEnvironments: ["ssr"],
      runtime: {
        browser: {
          importFrom: path.resolve("./framework/references.browser.ts"),
        },
        server: {
          importFrom: path.resolve("./framework/references.server.ts"),
        },
        ssr: {
          importFrom: path.resolve("./framework/references.ssr.ts"),
        },
      },
    }),
    cloudflare({
      persistState: true,
      configPath: "src/ssr/wrangler.toml",
      auxiliaryWorkers: [
        {
          configPath: "src/server/wrangler.toml",
        },
      ],
    }),
  ],
});
