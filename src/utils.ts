import jsonld from "jsonld";
import LinkHeader from "http-link-header";
import type { ConditionalFilter, CrudFilter, CrudFilters, CrudSort, CrudSorting, LogicalFilter } from "@refinedev/core";
import type { AppStatus, JsonContext, ResourceConfig } from "./types";

/** Default JSON-LD context used when none is configured: the ActivityStreams 2 vocabulary. */
export const DEFAULT_CONTEXT: JsonContext = ["https://www.w3.org/ns/activitystreams"];

/** Turn a value that may be a single item, an array, or nullish into an array. */
export const arrayOf = <T>(value: T | T[] | undefined | null): T[] => {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
};

const isURI = (value: string): boolean =>
  value.startsWith("http://") || value.startsWith("https://") || value.startsWith("urn:");

export type FetchJsonResult = { status: number; headers: Headers; json: any };

/**
 * A small `fetch` wrapper used for every call made to a Pod: sets the `Accept`/`Content-Type`
 * headers expected by ActivityPods servers, attaches the bearer token (if any), and parses
 * the JSON-LD body.
 */
export const fetchJson = async (url: string, options: RequestInit = {}, token?: string): Promise<FetchJsonResult> => {
  if (!url) throw new Error("No URL provided to fetchJson");

  const headers = new Headers(options.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/ld+json");
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/ld+json");
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(url, { ...options, headers });

  let json: any;
  if (response.status !== 204 && response.status !== 205) {
    const text = await response.text();
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        // Not a JSON body (e.g. an empty or plain-text error page): ignore
      }
    }
  }

  if (!response.ok) {
    const error: Error & { status?: number; body?: any } = new Error(
      json?.error?.message || json?.message || response.statusText || `Request to ${url} failed`
    );
    error.status = response.status;
    error.body = json;
    throw error;
  }

  return { status: response.status, headers: response.headers, json };
};

/** Expand CURIEs (e.g. `as:Event`) into full URIs, using a JSON-LD context. Full URIs are returned as-is. */
export const expandTypes = async (types: string[], context: JsonContext): Promise<string[]> => {
  if (types.every(isURI)) return types;

  const result = await jsonld.expand({ "@context": context, "@type": types } as any);
  const expanded = arrayOf<string>(result[0]?.["@type"] as any);

  if (expanded.length === 0 || !expanded.every(isURI)) {
    throw new Error(
      `Could not expand type(s) "${types.join(", ")}" into full URIs using the configured JSON-LD context.`
    );
  }

  return expanded;
};

const shapeTreeCache = new Map<string, Promise<string[]>>();

/** Resolve the `sh:targetClass` type(s) targeted by a shape tree's shape. Results are cached (shape trees are static). */
export const getTypesFromShapeTree = (shapeTreeUri: string): Promise<string[]> => {
  if (!shapeTreeCache.has(shapeTreeUri)) {
    shapeTreeCache.set(
      shapeTreeUri,
      (async () => {
        const { json: rawShapeTree } = await fetchJson(shapeTreeUri);

        const shapeTree = await jsonld.compact(rawShapeTree, {
          st: "http://www.w3.org/ns/shapetrees#",
          shape: { "@id": "st:shape", "@type": "@id" }
        } as any);

        if (!(shapeTree as any).shape) return [];

        const { json: shape } = await fetchJson((shapeTree as any).shape);
        return arrayOf(shape?.[0]?.["http://www.w3.org/ns/shacl#targetClass"]).map((node: any) => node?.["@id"]);
      })()
    );
  }
  return shapeTreeCache.get(shapeTreeUri)!;
};

export type TypeRegistration = {
  forClass: string[];
  instanceContainer?: string;
};

/**
 * A `solid:hasTypeRegistration` entry is usually a full TypeRegistration object already —
 * the Pod's TypeIndex dereferences it server-side — but fall back to fetching it ourselves
 * in case the Pod left it as a plain URI (e.g. a registration we aren't allowed to read).
 *
 * `solid:forClass` comes back compacted (e.g. `as:Event`, not the full URI), and dereferenced
 * entries don't carry their own `@context` (the Pod strips it), so `fallbackContext` — the
 * *outer* TypeIndex document's own `@context` — is what's used to expand it back out.
 */
const resolveTypeRegistration = async (
  entry: any,
  fallbackContext: JsonContext,
  token: string
): Promise<TypeRegistration> => {
  const registration = typeof entry === "string" ? (await fetchJson(entry, {}, token)).json : entry;
  const forClass = arrayOf<string>(registration?.["solid:forClass"]);
  return {
    forClass: forClass.length > 0 ? await expandTypes(forClass, registration?.["@context"] ?? fallbackContext) : [],
    instanceContainer: registration?.["solid:instanceContainer"]
  };
};

const fetchTypeRegistrations = async (typeIndexUri: string, token: string): Promise<TypeRegistration[]> => {
  const { json: typeIndex } = await fetchJson(typeIndexUri, {}, token);
  const context: JsonContext = typeIndex["@context"] ?? DEFAULT_CONTEXT;
  return Promise.all(
    arrayOf<any>(typeIndex["solid:hasTypeRegistration"]).map(entry => resolveTypeRegistration(entry, context, token))
  );
};

// Type registrations rarely change while an app is open: cache them per WebID.
const typeRegistrationsCache = new Map<string, Promise<TypeRegistration[]>>();

/**
 * Discover the containers registered for each resource class, via the WebID's public (and,
 * best-effort, private) Solid TypeIndex — this is readable without any special grant, unlike
 * the SAI RegistrySet/DataRegistry, which are restricted to the Pod owner.
 */
export const discoverTypeRegistrations = (webId: string, token: string): Promise<TypeRegistration[]> => {
  if (!typeRegistrationsCache.has(webId)) {
    typeRegistrationsCache.set(
      webId,
      (async () => {
        const { json: user } = await fetchJson(webId, {}, token);
        const registrations: TypeRegistration[] = [];

        if (user["solid:publicTypeIndex"]) {
          registrations.push(...(await fetchTypeRegistrations(user["solid:publicTypeIndex"], token)));
        }

        // Best-effort: the private index requires being logged in as the Pod owner, so a
        // public-only lookup (e.g. for an app with only public access) still works if this fails.
        if (user["pim:preferencesFile"]) {
          try {
            const { json: preferencesFile } = await fetchJson(user["pim:preferencesFile"], {}, token);
            if (preferencesFile["solid:privateTypeIndex"]) {
              registrations.push(...(await fetchTypeRegistrations(preferencesFile["solid:privateTypeIndex"], token)));
            }
          } catch {
            // No access to the preferences file or private index: ignore
          }
        }

        return registrations;
      })()
    );
  }
  return typeRegistrationsCache.get(webId)!;
};

/** Resolve the type URI(s) a resource should be created/matched with, from its config. */
export const resolveResourceTypes = async (
  resourceConfig: ResourceConfig,
  jsonContext: JsonContext
): Promise<string[]> => {
  if (resourceConfig.types) return expandTypes(arrayOf(resourceConfig.types), jsonContext);
  if (resourceConfig.shapeTreeUri) return getTypesFromShapeTree(resourceConfig.shapeTreeUri);
  return [];
};

/** Find the container registered for a resource's shape tree or type(s) in the user's type index. */
export const resolveContainerUri = async (
  resourceId: string,
  resourceConfig: ResourceConfig,
  webId: string,
  token: string,
  jsonContext: JsonContext
): Promise<string> => {
  const wantedTypes = await resolveResourceTypes(resourceConfig, jsonContext);
  if (wantedTypes.length === 0) {
    throw new Error(`Resource "${resourceId}" must define either \`shapeTreeUri\` or \`types\``);
  }

  const registrations = await discoverTypeRegistrations(webId, token);
  const match = registrations.find(r => r.instanceContainer && r.forClass.some(type => wantedTypes.includes(type)));
  if (match?.instanceContainer) return match.instanceContainer;

  throw new Error(
    `No container found in ${webId}'s type index for resource "${resourceId}" (type(s): ${wantedTypes.join(", ")}). ` +
      `Has the app declared this access need, and has the user granted access to it?`
  );
};

export type AuthAgentResolution = {
  /** The fetched Authorization Agent resource (e.g. for `interop:hasAuthorizationRedirectEndpoint`) */
  authAgent: Record<string, any>;
  /** The AppRegistration URI, if this app is already registered with the WebID's authorization agent */
  appRegistrationUri: string | undefined;
};

/**
 * Look up a WebID's Authorization Agent, and check (via the `registeredAgent` Link header, per
 * https://solid.github.io/data-interoperability-panel/specification/#agent-registration-discovery)
 * whether this app already has an AppRegistration there.
 */
export const resolveAuthAgent = async (webId: string, token?: string): Promise<AuthAgentResolution> => {
  const { json: actor } = await fetchJson(webId, {}, token);
  const authAgentUri = actor["interop:hasAuthorizationAgent"];
  if (!authAgentUri) throw new Error(`WebID ${webId} has no registered authorization agent`);

  const { headers, json: authAgent } = await fetchJson(authAgentUri, {}, token);
  const linkHeaderValue = headers.get("Link");
  const registeredAgentLinks = linkHeaderValue
    ? LinkHeader.parse(linkHeaderValue).rel("http://www.w3.org/ns/solid/interop#registeredAgent")
    : [];

  return { authAgent, appRegistrationUri: registeredAgentLinks[0]?.anchor };
};

/**
 * Fetch this app's status from the Pod provider hosting `webId`: whether it's registered, and
 * whether the access needs it was granted are stale (`upgradeNeeded`). The Pod identifies the
 * calling app from the access token itself (Solid-OIDC's `azp` claim), so no app URI is needed.
 */
export const fetchAppStatus = async (webId: string, token: string): Promise<AppStatus> => {
  const endpoint = new URL("/.well-known/app-status", new URL(webId).origin).toString();
  const { json } = await fetchJson(endpoint, {}, token);
  return json as AppStatus;
};

/** Normalize a JSON-LD resource (from a container's `ldp:contains`, or fetched directly) into a Refine record with an `id`. */
export const normalizeRecord = (resource: Record<string, any>, containerContext?: JsonContext) => {
  const id = resource.id || resource["@id"];
  if (!id) throw new Error("Resource is missing an @id / id property");
  return {
    "@context": containerContext,
    ...resource,
    id
  };
};

const getFieldValue = (record: any, field: string) =>
  field.split(".").reduce<any>((value, key) => (value === undefined || value === null ? undefined : value[key]), record);

const compareStrings = (a: string, b: string, caseSensitive: boolean) =>
  caseSensitive ? a === b : a.toLowerCase() === b.toLowerCase();

const includesString = (haystack: string, needle: string, caseSensitive: boolean) =>
  caseSensitive ? haystack.includes(needle) : haystack.toLowerCase().includes(needle.toLowerCase());

const matchesLogicalFilter = (record: any, filter: LogicalFilter): boolean => {
  const fieldValue = getFieldValue(record, filter.field);
  const values = arrayOf(fieldValue);
  const { operator, value } = filter;

  switch (operator) {
    case "eq":
      return values.some(v => (typeof v === "string" && typeof value === "string" ? compareStrings(v, value, false) : v === value));
    case "eqs":
      return values.some(v => v === value);
    case "ne":
      return values.every(v => !(typeof v === "string" && typeof value === "string" ? compareStrings(v, value, false) : v === value));
    case "nes":
      return values.every(v => v !== value);
    case "in":
    case "ina":
      return values.some(v => arrayOf(value).some(v2 => compareStrings(String(v), String(v2), false)));
    case "nin":
    case "nina":
      return !values.some(v => arrayOf(value).some(v2 => compareStrings(String(v), String(v2), false)));
    case "contains":
      return values.some(v => typeof v === "string" && includesString(v, String(value), false));
    case "containss":
      return values.some(v => typeof v === "string" && includesString(v, String(value), true));
    case "ncontains":
      return !values.some(v => typeof v === "string" && includesString(v, String(value), false));
    case "ncontainss":
      return !values.some(v => typeof v === "string" && includesString(v, String(value), true));
    case "startswith":
      return values.some(v => typeof v === "string" && v.toLowerCase().startsWith(String(value).toLowerCase()));
    case "startswiths":
      return values.some(v => typeof v === "string" && v.startsWith(String(value)));
    case "nstartswith":
      return !values.some(v => typeof v === "string" && v.toLowerCase().startsWith(String(value).toLowerCase()));
    case "nstartswiths":
      return !values.some(v => typeof v === "string" && v.startsWith(String(value)));
    case "endswith":
      return values.some(v => typeof v === "string" && v.toLowerCase().endsWith(String(value).toLowerCase()));
    case "endswiths":
      return values.some(v => typeof v === "string" && v.endsWith(String(value)));
    case "nendswith":
      return !values.some(v => typeof v === "string" && v.toLowerCase().endsWith(String(value).toLowerCase()));
    case "nendswiths":
      return !values.some(v => typeof v === "string" && v.endsWith(String(value)));
    case "lt":
      return values.some(v => v < value);
    case "lte":
      return values.some(v => v <= value);
    case "gt":
      return values.some(v => v > value);
    case "gte":
      return values.some(v => v >= value);
    case "between":
      return values.some(v => v >= value[0] && v <= value[1]);
    case "nbetween":
      return !values.some(v => v >= value[0] && v <= value[1]);
    case "null":
      return fieldValue === undefined || fieldValue === null;
    case "nnull":
      return fieldValue !== undefined && fieldValue !== null;
    default:
      return true;
  }
};

const isConditionalFilter = (filter: CrudFilter): filter is ConditionalFilter =>
  filter.operator === "and" || filter.operator === "or";

const matchesFilter = (record: any, filter: CrudFilter): boolean => {
  if (isConditionalFilter(filter)) {
    return filter.operator === "and"
      ? filter.value.every(child => matchesFilter(record, child))
      : filter.value.some(child => matchesFilter(record, child));
  }
  return matchesLogicalFilter(record, filter);
};

/** Apply Refine's `CrudFilters` (logical + and/or conditional filters) to an in-memory list of records. */
export const applyFilters = <T,>(records: T[], filters?: CrudFilters): T[] => {
  if (!filters || filters.length === 0) return records;
  return records.filter(record => filters.every(filter => matchesFilter(record, filter)));
};

const compareValues = (a: any, b: any): number => {
  if (a === undefined || a === null) return b === undefined || b === null ? 0 : -1;
  if (b === undefined || b === null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
};

/** Apply Refine's `CrudSorting` (multi-field sort) to an in-memory list of records. */
export const applySorters = <T,>(records: T[], sorters?: CrudSorting): T[] => {
  if (!sorters || sorters.length === 0) return records;
  return [...records].sort((a, b) => {
    for (const sorter of sorters as CrudSort[]) {
      const cmp = compareValues(getFieldValue(a, sorter.field), getFieldValue(b, sorter.field));
      if (cmp !== 0) return sorter.order === "desc" ? -cmp : cmp;
    }
    return 0;
  });
};
