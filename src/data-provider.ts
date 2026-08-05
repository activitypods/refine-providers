import type { DataProvider } from "@refinedev/core";
import {
  applyFilters,
  applySorters,
  arrayOf,
  DEFAULT_CONTEXT,
  fetchJson,
  normalizeRecord,
  resolveContainerUri,
  resolveResourceTypes
} from "./utils";
import { DataProviderConfig, ResourceConfig } from "./types";

/**
 * Refine data provider for ActivityPods. Resources are mapped to LDP containers, discovered
 * at runtime from the logged-in user's public Solid TypeIndex (linked from their WebID as
 * `solid:publicTypeIndex`) — the same mechanism the Pod uses to register a container the
 * first time a shape tree's access is granted.
 *
 * Since ActivityPods containers don't support server-side filtering, sorting or pagination,
 * `getList`/`getManyReference` fetch the full container and apply Refine's filters, sorters
 * and pagination in memory.
 */
const dataProvider = ({ resources, authProvider, jsonContext = DEFAULT_CONTEXT }: DataProviderConfig): DataProvider => {
  const requireSession = () => {
    const session = authProvider.getSession();
    if (!session) throw new Error("Not authenticated");
    return session;
  };

  const requireResourceConfig = (resource: string): ResourceConfig => {
    const resourceConfig = resources[resource];
    if (!resourceConfig) throw new Error(`Resource "${resource}" is not configured`);
    return resourceConfig;
  };

  const resolveContainer = async (resource: string) => {
    const { token, webId } = requireSession();
    return resolveContainerUri(resource, requireResourceConfig(resource), webId, token, jsonContext);
  };

  const fetchOne = async (id: string) => {
    const { token } = requireSession();
    const { json } = await fetchJson(id, {}, token);
    return normalizeRecord(json, json["@context"]);
  };

  const list: DataProvider["getList"] = async ({ resource, pagination, sorters, filters }) => {
    const { token } = requireSession();
    const containerUri = await resolveContainer(resource);

    const { json: container } = await fetchJson(containerUri, {}, token);
    let records = arrayOf(container["ldp:contains"]).map(item => normalizeRecord(item, container["@context"]));

    records = applyFilters(records, filters);
    records = applySorters(records, sorters);

    const total = records.length;

    if (pagination && pagination.mode !== "off") {
      const currentPage = pagination.currentPage ?? 1;
      const pageSize = pagination.pageSize ?? 10;
      records = records.slice((currentPage - 1) * pageSize, currentPage * pageSize);
    }

    return { data: records as any, total };
  };

  return {
    getApiUrl: () => "",

    getList: list,

    getOne: async ({ resource, id }) => {
      requireResourceConfig(resource);
      return { data: (await fetchOne(`${id}`)) as any };
    },

    getMany: async ({ resource, ids }) => {
      requireResourceConfig(resource);
      const results = await Promise.allSettled(ids.map(id => fetchOne(`${id}`)));
      const data = results.filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled").map(r => r.value);
      return { data: data as any };
    },

    create: async ({ resource, variables }) => {
      const { token } = requireSession();
      const resourceConfig = requireResourceConfig(resource);
      const containerUri = await resolveContainer(resource);
      const types = await resolveResourceTypes(resourceConfig, jsonContext);

      const { headers } = await fetchJson(
        containerUri,
        {
          method: "POST",
          body: JSON.stringify({ "@context": jsonContext, "@type": types, ...variables })
        },
        token
      );

      const location = headers.get("Location");
      if (!location) throw new Error(`The Pod did not return a Location header when creating a resource in ${containerUri}`);

      return { data: (await fetchOne(location)) as any };
    },

    update: async ({ resource, id, variables }) => {
      const { token } = requireSession();
      requireResourceConfig(resource);

      await fetchJson(
        `${id}`,
        {
          method: "PUT",
          body: JSON.stringify({ "@context": jsonContext, ...variables })
        },
        token
      );

      return { data: (await fetchOne(`${id}`)) as any };
    },

    deleteOne: async ({ resource, id }) => {
      const { token } = requireSession();
      requireResourceConfig(resource);
      await fetchJson(`${id}`, { method: "DELETE" }, token);
      return { data: { id } as any };
    }
  };
};

export default dataProvider;
