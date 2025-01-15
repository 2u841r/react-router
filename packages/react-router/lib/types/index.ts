import type { MetaDescriptor } from "../dom/ssr/routeModules";
import type {
  CreateActionData,
  CreateLoaderData,
  RouteModule,
} from "./route-module";
import type { Pretty } from "./utils";

export interface Register {
  // routes
}

type AnyRoutes = Record<
  string,
  {
    parentId: string | undefined;
    path: string | undefined;
    module: RouteModule;
  }
>;

type UserRoutes = Register extends {
  routes: infer TRoutes extends AnyRoutes;
}
  ? TRoutes
  : AnyRoutes;

type RouteId = keyof UserRoutes;

type GetParents<Id extends RouteId> = UserRoutes[Id] extends {
  parentId: infer P extends RouteId;
}
  ? [...GetParents<P>, P]
  : [];

type _GetChildren<Id extends RouteId> = {
  [K in RouteId]: UserRoutes[K] extends { parentId: Id }
    ? [K, ..._GetChildren<K>]
    : [];
}[RouteId];
type GetChildren<Id extends RouteId> = _GetChildren<Id> extends []
  ? []
  : Exclude<_GetChildren<Id>, []>;

type GetBranch<Id extends RouteId> = [
  ...GetParents<Id>,
  Id,
  ...GetChildren<Id>
];

// path vs full path
// params vs page params?

type Data = {
  [Id in RouteId]: {
    loaderData: CreateLoaderData<UserRoutes[Id]["module"]>;
    actionData: CreateActionData<UserRoutes[Id]["module"]>;
  };
};

type Branches = {
  [Id in RouteId]: GetBranch<Id>;
};

type PartialParams = {
  [Id in RouteId]: UserRoutes[Id]["path"] extends string
    ? ParseParams<UserRoutes[Id]["path"]>
    : {};
};
type BranchParams<Branch extends Array<RouteId>> = Branch extends [
  infer Id extends RouteId,
  ...infer Ids extends Array<RouteId>
]
  ? PartialParams[Id] & BranchParams<Ids>
  : {};
type Params = {
  [Id in RouteId]: Pretty<BranchParams<Branches[Id]>>;
};

type MetaMatch<Id extends RouteId> = Pretty<{
  id: Id;
  params: Params[Id];
  pathname: string;
  meta: MetaDescriptor[];
  data: Data[Id]["loaderData"];
  handle?: unknown;
  error?: unknown;
}>;
type BranchMetaMatches<Branch extends Array<RouteId>> = Branch extends [
  infer Id extends RouteId,
  ...infer Ids extends Array<RouteId>
]
  ? [MetaMatch<Id>, ...BranchMetaMatches<Ids>]
  : [];

type Match<Id extends RouteId> = {
  id: Id;
  params: Params[Id];
  pathname: string;
  data: Data[Id]["loaderData"];
  handle: unknown;
};

type BranchMatches<Branch extends Array<RouteId>> = Branch extends [
  infer Id extends RouteId,
  ...infer Ids extends Array<RouteId>
]
  ? [Match<Id>, ...BranchMatches<Ids>]
  : [];

type Matches = {
  [Id in RouteId]: {
    metaMatches: BranchMetaMatches<Branches[Id]>;
    matches: BranchMatches<Branches[Id]>;
  };
};

export type Routes = {
  [Id in RouteId]: {
    params: Params[Id];
    loaderData: Data[Id]["loaderData"];
    actionData: Data[Id]["actionData"];
    metaMatches: Matches[Id]["metaMatches"];
    matches: Matches[Id]["matches"];
  };
};

// prettier-ignore
type Regex_az = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m" | "n" | "o" | "p" | "q" | "r" | "s" | "t" | "u" | "v" | "w" | "x" | "y" | "z"
// prettier-ignore
type Regez_AZ = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K" | "L" | "M" | "N" | "O" | "P" | "Q" | "R" | "S" | "T" | "U" | "V" | "W" | "X" | "Y" | "Z"
type Regex_09 = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
type Regex_w = Regex_az | Regez_AZ | Regex_09 | "_";
type ParamChar = Regex_w | "-";

// Emulates regex `+`
type RegexMatchPlus<
  CharPattern extends string,
  T extends string
> = T extends `${infer First}${infer Rest}`
  ? First extends CharPattern
    ? RegexMatchPlus<CharPattern, Rest> extends never
      ? First
      : `${First}${RegexMatchPlus<CharPattern, Rest>}`
    : never
  : never;

// Recursive helper for finding path parameters in the absence of wildcards
type _PathParam<Path extends string> =
  // split path into individual path segments
  Path extends `${infer L}/${infer R}`
    ? _PathParam<L> & _PathParam<R>
    : // find params after `:`
    Path extends `:${infer Param}`
    ? Param extends `${infer Optional}?${string}`
      ? RegexMatchPlus<ParamChar, Optional> extends infer Id extends string
        ? { [K in Id]?: string }
        : {}
      : RegexMatchPlus<ParamChar, Param> extends infer Id extends string
      ? { [K in Id]: string }
      : {}
    : // otherwise, there aren't any params present
      {};

type ParseParams<Path extends string> =
  // check if path is just a wildcard
  Path extends "*" | "/*"
    ? "*"
    : // look for wildcard at the end of the path
    Path extends `${infer Rest}/*`
    ? Pretty<_PathParam<Rest> & { "*": string }>
    : // look for params in the absence of wildcards
      Pretty<_PathParam<Path>>;
