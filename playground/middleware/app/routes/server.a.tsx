import { Outlet, unstable_createContext } from "react-router";
import type { Route } from "./+types/server.a";
import { rootContext } from "~/root";
import { bContext } from "./server.a.b";

export const aContext = unstable_createContext<string>();

export const unstable_middleware: Route.unstable_MiddlewareFunction[] = [
  async ({ context }, next) => {
    console.log("start a middleware");
    context.set(aContext, "A");
    let res = await next();
    console.log("end a middleware");
    return res;
  },
];

export function loader({ context }: Route.LoaderArgs) {
  return JSON.stringify({
    root: context.get(rootContext),
    a: context.get(aContext),
  });
}

export default function A({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <h1>A</h1>
      <p>{loaderData}</p>
      <Outlet />
    </>
  );
}
