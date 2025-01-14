import { test, expect, type Page } from "@playwright/test";
import getPort from "get-port";
import dedent from "dedent";

import {
  createProject,
  build,
  reactRouterServe,
  viteConfig,
  reactRouterConfig,
} from "./helpers/vite.js";

const js = String.raw;

const files = {
  "app/routes/_index.tsx": js`
    import { useState, useEffect } from "react";
    import { Link } from "react-router";

    export default function IndexRoute() {
      return (
        <ul>
          <li>
            <Link to="/chunkable">/chunkable</Link>
          </li>
          <li>
            <Link to="/unchunkable">/unchunkable</Link>
          </li>
        </ul>
      );
    }
  `,
  "app/routes/chunkable.tsx": js`
    import { useLoaderData, useActionData, Form } from "react-router";

    // Usage of this exported function forces any consuming code into the main
    // chunk. The variable name is globally unique to prevent name mangling,
    // e.g. inChunkableMainChunk$1. The use of console.log prevents dead code
    // elimination in the build by introducing a side effect
    export const inChunkableMainChunk = () => console.log() || true;

    export const clientLoader = async () => {
      // Allow HydrateFallback to be visible longer
      await new Promise((resolve) => setTimeout(resolve, 100));
      // eval is used here to avoid a chunking de-opt:
      return "clientLoader in main chunk: " + eval("typeof inChunkableMainChunk === 'function'");
    };

    // Exports are wrapped in IIFEs so we can detect when they're downloaded
    export const clientAction = (function() {
      (globalThis as any).chunkableClientActionDownloaded = true;
      // eval is used here to avoid a chunking de-opt:
      return () => "clientAction in main chunk: " + eval("typeof inChunkableMainChunk === 'function'");
    })();
    export const HydrateFallback = (function() {
      (globalThis as any).chunkableHydrateFallbackDownloaded = true;
      // eval is used here to avoid a chunking de-opt:
      return () => <div data-hydrate-fallback>Loading...</div>;
    })();

    export default function ChunkableRoute() {
      inChunkableMainChunk();
      const loaderData = useLoaderData();
      const actionData = useActionData();
      return (
        <>
          <div data-loader-data>loaderData = {JSON.stringify(loaderData)}</div>
          <div data-action-data>actionData = {JSON.stringify(actionData)}</div>
          <input type="text" />
          <Form method="post">
            <button>Submit</button>
          </Form>
        </>
      );
    }
  `,

  "app/routes/unchunkable.tsx": js`
    import { useLoaderData, useActionData, Form } from "react-router";

    // Usage of this exported function forces any consuming code into the main
    // chunk. The variable name is globally unique to prevent name mangling,
    // e.g. inUnchunkableMainChunk$1. The use of console.log prevents dead code
    // elimination in the build by introducing a side effect
    export const inUnchunkableMainChunk = () => console.log() || true;

    export const clientLoader = async () => {
      inUnchunkableMainChunk();
      // Allow HydrateFallback to be visible longer
      await new Promise((resolve) => setTimeout(resolve, 100));
      // eval is used here to avoid a chunking de-opt:
      return "clientLoader in main chunk: " + eval("typeof inUnchunkableMainChunk === 'function'");
    };
 
    // Exports are wrapped in IIFEs so we can detect when they're downloaded
    export const clientAction = (function() {
      inUnchunkableMainChunk();
      (globalThis as any).unchunkableClientActionDownloaded = true;
      // eval is used here to avoid a chunking de-opt:
      return () => "clientAction in main chunk: " + eval("typeof inUnchunkableMainChunk === 'function'");
    })();
    export const HydrateFallback = (function() {
      inUnchunkableMainChunk();
      (globalThis as any).unchunkableHydrateFallbackDownloaded = true;
      // eval is used here to avoid a chunking de-opt:
      return () => <div data-hydrate-fallback>Loading...</div>;
    })();

    export default function UnchunkableRoute() {
      inUnchunkableMainChunk();
      const loaderData = useLoaderData();
      const actionData = useActionData();
      return (
        <>
          <div data-loader-data>loaderData = {JSON.stringify(loaderData)}</div>
          <div data-action-data>actionData = {JSON.stringify(actionData)}</div>
          <input type="text" />
          <Form method="post">
            <button>Submit</button>
          </Form>
        </>
      );
    }
  `,
};

async function chunkableClientActionDownloaded(page: Page) {
  return await page.evaluate(() =>
    Boolean((globalThis as any).chunkableClientActionDownloaded)
  );
}

async function chunkableHydrateFallbackDownloaded(page: Page) {
  return await page.evaluate(() =>
    Boolean((globalThis as any).chunkableHydrateFallbackDownloaded)
  );
}

async function unchunkableClientActionDownloaded(page: Page) {
  return await page.evaluate(() =>
    Boolean((globalThis as any).unchunkableClientActionDownloaded)
  );
}

async function unchunkableHydrateFallbackDownloaded(page: Page) {
  return await page.evaluate(() =>
    Boolean((globalThis as any).unchunkableHydrateFallbackDownloaded)
  );
}

test.describe("Route chunks", async () => {
  test.describe("enabled", () => {
    let routeChunks = true;
    let port: number;
    let cwd: string;
    let stop: Awaited<ReturnType<typeof reactRouterServe>>;

    test.beforeAll(async () => {
      port = await getPort();
      cwd = await createProject({
        "react-router.config.ts": reactRouterConfig({ routeChunks }),
        "vite.config.js": await viteConfig.basic({ port }),
        ...files,
      });
      build({ cwd });
      stop = await reactRouterServe({ cwd, port });
    });

    test.afterAll(() => {
      stop();
    });

    test("supports route chunks", async ({ page }) => {
      let pageErrors: Error[] = [];
      page.on("pageerror", (error) => pageErrors.push(error));

      await page.goto(`http://localhost:${port}`, { waitUntil: "networkidle" });
      expect(pageErrors).toEqual([]);

      // Ensure chunkable exports are not in main chunk
      await page.getByRole("link", { name: "/chunkable" }).click();
      expect(await chunkableHydrateFallbackDownloaded(page)).toBe(false);
      await expect(page.locator("[data-loader-data]")).toHaveText(
        `loaderData = "clientLoader in main chunk: false"`
      );
      expect(await chunkableClientActionDownloaded(page)).toBe(false);
      await page.getByRole("button").click();
      await expect(page.locator("[data-action-data]")).toHaveText(
        'actionData = "clientAction in main chunk: false"'
      );
      expect(await chunkableClientActionDownloaded(page)).toBe(true);

      await page.goBack();

      // Ensure unchunkable exports are in main chunk
      await page.getByRole("link", { name: "/unchunkable" }).click();
      expect(await unchunkableHydrateFallbackDownloaded(page)).toBe(true);
      await expect(page.locator("[data-loader-data]")).toHaveText(
        'loaderData = "clientLoader in main chunk: true"'
      );
      expect(await unchunkableClientActionDownloaded(page)).toBe(true);
      await page.getByRole("button").click();
      await expect(page.locator("[data-action-data]")).toHaveText(
        'actionData = "clientAction in main chunk: true"'
      );

      // Ensure chunkable HydrateFallback and client loader work during SSR
      await page.goto(`http://localhost:${port}/chunkable`);
      expect(page.locator("[data-hydrate-fallback]")).toHaveText("Loading...");
      expect(await chunkableHydrateFallbackDownloaded(page)).toBe(true);
      await expect(page.locator("[data-loader-data]")).toHaveText(
        `loaderData = "clientLoader in main chunk: false"`
      );

      // Ensure chunkable HydrateFallback and client loader work during SSR
      await page.goto(`http://localhost:${port}/unchunkable`);
      expect(page.locator("[data-hydrate-fallback]")).toHaveText("Loading...");
      expect(await unchunkableHydrateFallbackDownloaded(page)).toBe(true);
      await expect(page.locator("[data-loader-data]")).toHaveText(
        `loaderData = "clientLoader in main chunk: true"`
      );
    });
  });

  test.describe("disabled", () => {
    let routeChunks = false;
    let port: number;
    let cwd: string;
    let stop: Awaited<ReturnType<typeof reactRouterServe>>;

    test.beforeAll(async () => {
      port = await getPort();
      cwd = await createProject({
        "react-router.config.ts": reactRouterConfig({ routeChunks }),
        "vite.config.js": await viteConfig.basic({ port }),
        ...files,
      });
      build({ cwd });
      stop = await reactRouterServe({ cwd, port });
    });

    test.afterAll(() => {
      stop();
    });

    test("keeps exports in main chunk", async ({ page }) => {
      let pageErrors: Error[] = [];
      page.on("pageerror", (error) => pageErrors.push(error));

      await page.goto(`http://localhost:${port}`, { waitUntil: "networkidle" });
      expect(pageErrors).toEqual([]);

      // Ensure chunkable exports are kept in main chunk
      await page.getByRole("link", { name: "/chunkable" }).click();
      expect(await chunkableHydrateFallbackDownloaded(page)).toBe(true);
      await expect(page.locator("[data-loader-data]")).toHaveText(
        `loaderData = "clientLoader in main chunk: true"`
      );
      expect(await chunkableClientActionDownloaded(page)).toBe(true);
      await page.getByRole("button").click();
      await expect(page.locator("[data-action-data]")).toHaveText(
        'actionData = "clientAction in main chunk: true"'
      );

      await page.goBack();

      // Ensure unchunkable exports are kept in main chunk
      await page.getByRole("link", { name: "/unchunkable" }).click();
      expect(await unchunkableHydrateFallbackDownloaded(page)).toBe(true);
      await expect(page.locator("[data-loader-data]")).toHaveText(
        'loaderData = "clientLoader in main chunk: true"'
      );
      expect(await unchunkableClientActionDownloaded(page)).toBe(true);
      await page.getByRole("button").click();
      await expect(page.locator("[data-action-data]")).toHaveText(
        'actionData = "clientAction in main chunk: true"'
      );

      // Ensure chunkable client loader works during SSR
      await page.goto(`http://localhost:${port}/chunkable`);
      expect(page.locator("[data-hydrate-fallback]")).toHaveText("Loading...");
      expect(await chunkableClientActionDownloaded(page)).toBe(true);
      await expect(page.locator("[data-loader-data]")).toHaveText(
        `loaderData = "clientLoader in main chunk: true"`
      );

      // Ensure unchunkable client loader works during SSR
      await page.goto(`http://localhost:${port}/unchunkable`);
      expect(page.locator("[data-hydrate-fallback]")).toHaveText("Loading...");
      expect(await unchunkableClientActionDownloaded(page)).toBe(true);
      await expect(page.locator("[data-loader-data]")).toHaveText(
        `loaderData = "clientLoader in main chunk: true"`
      );
    });
  });

  test.describe("enforce", () => {
    let routeChunks = "enforce" as const;
    let port: number;
    let cwd: string;

    test.describe("chunkable routes", () => {
      test.beforeAll(async () => {
        port = await getPort();
        cwd = await createProject({
          "react-router.config.ts": reactRouterConfig({ routeChunks }),
          "vite.config.js": await viteConfig.basic({ port }),
          ...files,
          "app/routes/unchunkable.tsx": files["app/routes/chunkable.tsx"],
        });
      });

      test("build passes", async () => {
        let { status } = build({ cwd });
        expect(status).toBe(0);
      });
    });

    test.describe("unchunkable routes", () => {
      test.beforeAll(async () => {
        port = await getPort();
        cwd = await createProject({
          "react-router.config.ts": reactRouterConfig({ routeChunks }),
          "vite.config.js": await viteConfig.basic({ port }),
          ...files,
        });
      });

      test("build fails", async () => {
        let { stderr, status } = build({ cwd });
        expect(status).toBe(1);
        expect(stderr.toString()).toMatch(
          dedent`
            Route chunks error: routes/unchunkable.tsx
            
            - clientAction
            - clientLoader
            - HydrateFallback

            These exports were unable to be split into their own chunks because they reference code in the same file that is used by other route module exports.
            
            If you need to share code between these and other exports, you should extract the shared code into a separate module.
          `
        );
      });
    });
  });
});
