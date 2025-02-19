import type {
  ClientActionFunction,
  ClientLoaderFunction,
  LinksFunction,
  MetaFunction,
} from "./dom/ssr/routeModules";
import { injectRSCPayload } from "./html-stream/server";
import type { Location } from "./router/history";
import { createStaticHandler } from "./router/router";
import {
  isRouteErrorResponse,
  type ActionFunction,
  type LoaderFunction,
  type Params,
  type ShouldRevalidateFunction,
} from "./router/utils";

export type ServerRouteObject = { id: string; path?: string } & (
  | {
      index: true;
    }
  | {
      children?: ServerRouteObject[];
    }
) & {
    action?: ActionFunction;
    clientAction?: ClientActionFunction;
    clientLoader?: ClientLoaderFunction;
    default?: React.ComponentType<any>;
    ErrorBoundary?: React.ComponentType<any>;
    handle?: any;
    HydrateFallback?: React.ComponentType<any>;
    Layout?: React.ComponentType<any>;
    links?: LinksFunction;
    loader?: LoaderFunction;
    meta?: MetaFunction;
    shouldRevalidate?: ShouldRevalidateFunction;
  };

export type ServerRouteManifest = {
  clientAction?: ClientActionFunction;
  clientLoader?: ClientLoaderFunction;
  Component?: React.ComponentType;
  ErrorBoundary?: React.ComponentType;
  handle?: any;
  hasAction: boolean;
  hasLoader: boolean;
  HydrateFallback?: React.ComponentType;
  id: string;
  index?: boolean;
  Layout?: React.ComponentType;
  links?: LinksFunction;
  meta?: MetaFunction;
  path?: string;
  shouldRevalidate?: ShouldRevalidateFunction;
};

export type ServerRouteManifestTree = ServerRouteManifest & {
  children?: ServerRouteManifestTree[];
};

export type ServerRouteMatch = ServerRouteManifest & {
  params: Params;
  pathname: string;
  pathnameBase: string;
};

export type ServerRenderPayload = {
  type: "render";
  actionData: Record<string, any> | null;
  basename?: string;
  deepestRenderedBoundaryId?: string;
  errors: Record<string, any> | null;
  loaderData: Record<string, any>;
  location: Location;
  matches: ServerRouteMatch[];
  nonce?: string;
};

export type ServerManifestPayload = {
  type: "manifest";
  routes: ServerRouteManifestTree[];
};

export type ServerPayload = ServerRenderPayload | ServerManifestPayload;

export type ServerMatch = {
  statusCode: number;
  headers: Headers;
  payload: ServerPayload;
};

function makeServerRouteManifestTree(
  routes: ServerRouteObject[]
): ServerRouteManifestTree[] {
  return routes.map((route) => {
    return {
      clientAction: route.clientAction,
      clientLoader: route.clientLoader,
      Component: route.default,
      ErrorBoundary: route.ErrorBoundary,
      handle: route.handle,
      hasAction: !!route.action,
      hasLoader: !!route.loader,
      HydrateFallback: route.HydrateFallback,
      id: route.id,
      index: "index" in route ? route.index : undefined,
      Layout: route.Layout,
      links: route.links,
      meta: route.meta,
      path: route.path,
      shouldRevalidate: route.shouldRevalidate,
      children:
        "children" in route && route.children
          ? makeServerRouteManifestTree(route.children)
          : undefined,
    };
  });
}

export async function matchServerRequest(
  request: Request,
  routes: ServerRouteObject[]
): Promise<ServerMatch | Response> {
  const url = new URL(request.url);
  if (url.pathname === "/__manifest") {
    return {
      statusCode: 200,
      headers: new Headers({
        "Content-Type": "text/x-component",
        Vary: "Content-Type",
      }),
      payload: {
        type: "manifest",
        routes: makeServerRouteManifestTree(routes),
      } satisfies ServerManifestPayload,
    };
  }

  const handler = createStaticHandler(routes);
  const result = await handler.query(request);

  if (result instanceof Response) {
    const headers = new Headers(result.headers);
    headers.set("Vary", "Content-Type");
    headers.set("x-react-router-error", "true");
    return result;
  }

  const errors = result.errors
    ? Object.fromEntries(
        Object.entries(result.errors).map(([key, error]) => [
          key,
          isRouteErrorResponse(error)
            ? Object.fromEntries(Object.entries(error))
            : error,
        ])
      )
    : result.errors;

  const payload = {
    type: "render",
    actionData: result.actionData,
    deepestRenderedBoundaryId: result._deepestRenderedBoundaryId ?? undefined,
    errors,
    loaderData: result.loaderData,
    location: result.location,
    matches: result.matches.map((match) => ({
      clientAction: (match.route as any).clientAction,
      clientLoader: (match.route as any).clientLoader,
      Component: (match.route as any).default,
      ErrorBoundary: (match.route as any).ErrorBoundary,
      handle: (match.route as any).handle,
      hasAction: !!match.route.action,
      hasLoader: !!match.route.loader,
      HydrateFallback: (match.route as any).HydrateFallback,
      id: match.route.id,
      index: match.route.index,
      Layout: (match.route as any).Layout,
      links: (match.route as any).links,
      meta: (match.route as any).meta,
      params: match.params,
      path: match.route.path,
      pathname: match.pathname,
      pathnameBase: match.pathnameBase,
      shouldRevalidate: (match.route as any).shouldRevalidate,
    })),
  } satisfies ServerRenderPayload;

  return {
    statusCode: result.statusCode,
    headers: new Headers({
      "Content-Type": "text/x-component",
      Vary: "Content-Type",
    }),
    payload,
  };
}

export async function routeServerRequest(
  request: Request,
  requestServer: (request: Request) => Promise<Response>,
  renderHTML: (
    response: Response
  ) => ReadableStream<Uint8Array> | Promise<ReadableStream<Uint8Array>>
) {
  const url = new URL(request.url);
  let serverRequest = request;
  const isDataRequest = isReactServerRequest(url);
  if (isDataRequest) {
    const serverURL = new URL(request.url);
    serverURL.pathname = serverURL.pathname.replace(/\.rsc$/, "");
    serverRequest = new Request(serverURL, {
      body: request.body,
      duplex: request.body ? "half" : undefined,
      headers: request.headers,
      method: request.method,
      signal: request.signal,
    } as RequestInit & { duplex?: "half" });
  }

  const serverResponse = await requestServer(serverRequest);

  if (isDataRequest || isManifestRequest(url)) {
    return serverResponse;
  }

  if (!serverResponse.body) {
    throw new Error("Missing body in server response");
  }

  const serverResponseB = serverResponse.clone();
  if (!serverResponseB.body) {
    throw new Error("Failed to clone server response");
  }

  const html = await renderHTML(serverResponse);
  const body = html.pipeThrough(injectRSCPayload(serverResponseB.body));

  const headers = new Headers(serverResponse.headers);
  headers.set("Content-Type", "text/html");

  return new Response(body, {
    status: serverResponse.status,
    headers,
  });
}

export function isReactServerRequest(url: URL) {
  return url.pathname.endsWith(".rsc");
}

export function isManifestRequest(url: URL) {
  return url.pathname === "/__manifest";
}
