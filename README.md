# Refine providers for ActivityPods

Data and auth providers that can be used in any [Refine](https://refine.dev/core/) application to connect to [ActivityPods](https://activitypods.org/) (2.x) Pods.

This package is the ActivityPods counterpart of [`@ng-org/refine-providers`](https://git.nextgraph.org/NextGraph/refine-providers) for NextGraph: same shape (a `dataProvider` and an `authProvider`, no framework lock-in), adapted to how ActivityPods actually works.

> For a full working example (login, list/create/edit/show), have a look at [`examples/antd-app`](./examples/antd-app/).

## Usage

> **Requires ActivityPods v2.1.0+** on the Pod provider — that's when Data Registrations (and shape-tree-based access needs) were introduced.

### 1. Register your app's access needs

Before your app can read or write anything, it must declare which shape trees it needs access to (see the [ActivityPods guide](https://activitypods.org/docs/guides/create-your-first-social-app/) and the [app boilerplate](https://github.com/activitypods/app-boilerplate)). Each declared shape tree gets its own Data Registration (and LDP container) on the user's Pod once they grant access.

### 2. Configure the providers

```tsx
import { authProvider, dataProvider } from "@activitypods/refine-providers";

const apAuthProvider = authProvider({
  // The URI that identifies your app (usually its own backend/homepage URL)
  clientId: "https://myapp.example.com/app",
  // Optional, defaults to `${window.location.origin}/auth-callback`
  redirectUri: "https://myapp.example.com/auth-callback"
});

const apDataProvider = dataProvider({
  authProvider: apAuthProvider,
  resources: {
  events: {
    // Preferred: identifies exactly which Data Registration to use
    shapeTreeUri: "https://shapes.activitypods.org/shapetrees/as/Event"
  },
  notes: {
    // Fallback: resolved against the Data Registrations' shape trees
    types: ["as:Note"]
  }
},
  // Optional, defaults to the ActivityStreams 2 context. Add your app's own
  // `.well-known/context.jsonld` here if you use custom ontologies / CURIEs.
  jsonContext: ["https://www.w3.org/ns/activitystreams"]
});

const App = () => (
  <Refine authProvider={apAuthProvider} dataProvider={apDataProvider} ...>
    ...
  </Refine>
);
```

### 3. Wire up the login flow

The Solid-OIDC + app-registration flow (pick a Pod provider → redirect there → come back with a code → exchange it → make sure the app is registered with the user's authorization agent) is more involved than a typical username/password form, so it ships as a ready-made `AntdAuthPage` component:

```tsx
import { AntdAuthPage } from "@activitypods/refine-providers/antd-auth-page";

const MyLoginPage = () => <AntdAuthPage authProvider={apAuthProvider} />;
```

`AntdAuthPage` figures out which stage it's in from the URL's search params (see its docstring), so a single route handles login, the OAuth callback, and app registration:

```tsx
<Route path="/login" element={<MyLoginPage />} />
```

By default it fetches the public Pod providers list from `https://activitypods.org/data/pod-providers` and lets the user pick one (plus a manual URL field), the same way [`@activitypods/react`'s `LoginPage`](https://github.com/activitypods/activitypods) does. Pass `defaultPodProvider` to skip that list and offer a single URL instead — e.g. for a local dev Pod provider, read from an env var your bundler exposes:

```tsx
<AntdAuthPage authProvider={apAuthProvider} defaultPodProvider={import.meta.env.VITE_POD_PROVIDER_URL} />
```

Prefer a different UI kit, or want to build your own? `AntdAuthPage`'s source (`src/antd-auth-page.tsx`) is a self-contained reference for the three stages — `login()`, `authProvider.handleCallback()`, `authProvider.registerApp()` — that you can reimplement with any component library.

#### 3.1. Re-consent when access needs change

If the app is later changed to request a *new* access need (e.g. a resource added to `resources` in [§2](#2-configure-the-providers), with a matching entry added to the app's access-need group), existing users who already granted access before that change need to go through the consent screen again — the Pod provider grants exactly what was consented to, nothing more, so requests for the new resource will just 403 until then.

`authProvider()` handles this on its own, no extra wiring needed: on top of the check `registerApp()` already does at login, it also polls `getAppStatus()` in the background (every 2 minutes by default, and on every tab-focus change — configurable via `appStatusCheckInterval`, or set to `false` to disable) and silently redirects to the consent screen the moment it reports `upgradeNeeded: true`. This mirrors [`@activitypods/react`'s `BackgroundChecks`](https://github.com/activitypods/activitypods) component.

**`upgradeNeeded` is computed by the Pod comparing your app description's `dc:modified` value** — a cached copy (from when the user last consented) against a fresh fetch of your `app.json`. This means:

- Your `app.json` needs a `dc:modified` property (mapped to `http://purl.org/dc/terms/modified`) for this to work at all — without it, both sides compare as `undefined` and the Pod can never detect a change. See [`examples/antd-app/public/app.json`](./examples/antd-app/public/app.json).
- Treat it as a hand-maintained version stamp, not a live timestamp: only bump it when you actually change something the Pod should reconcile (an access need, or `app.json`'s other declared properties) — regenerating it on every deploy would force *every* user through re-consent on *every* release, defeating the point.
- Your context needs to type it explicitly — `"dc:modified": { "@type": "xsd:dateTime" }` — otherwise it's stored untyped, the Pod's comparison always sees mismatched types, and `upgradeNeeded` is permanently (not just occasionally) stuck `true`.
- **Write the value in canonical XSD `dateTime` form: no fractional seconds if they'd be zero** (`2026-08-05T00:00:00Z`, not `2026-08-05T00:00:00.000Z`). The comparison is a plain string `!=`, not a datetime-aware one, and the triplestore canonicalizes `dateTime` literals on the way in/out — a `.000Z` you wrote will come back as `Z` after the round-trip, permanently mismatching the raw value in your file even though both represent the same instant.

### 4. Use Refine's hooks as usual

```tsx
import { useTable } from "@refinedev/antd";
import { Table } from "antd";

export const EventList = () => {
  const { tableProps } = useTable({ resource: "events" });
  return (
    <Table {...tableProps} rowKey="id">
      <Table.Column dataIndex="id" title="ID" />
      <Table.Column dataIndex={["as:name"]} title="Name" />
    </Table>
  );
};
```

`getList` supports Refine's `filters` (`eq`, `contains`, `in`, `gte`/`lte`, `and`/`or`, ...), `sorters` and `pagination` out of the box.

### 5. (Optional) Enable live updates

> **⚠️ Currently blocked by an upstream bug in ActivityPods/SemApps.** The code below is
> implemented and spec-correct, but subscribing will 403 on every Pod as of this writing. The
> `/.notifications/WebhookChannel2023` and `/.notifications/WebSocketChannel2023` subscription
> endpoints are registered (in `@semapps/solid`'s `notification-channel.mixin.js`, via the
> generic `SpecialEndpointMixin`) with `authentication: false, authorization: false` — fine for
> a read-only public document like `.well-known/solid`, but this mixin is also reused for the
> channel's `POST` handler (`endpointPost`), which needs to know who's asking:
>
> ```js
> const { webId } = ctx.meta; // never set: the route skips authentication entirely
> const rights = await ctx.call('webacl.resource.hasRights', { resourceUri: topic, rights: { read: true }, webId });
> if (!rights.read) throw new E.ForbiddenError('You need acl:Read rights on the resource');
> ```
>
> Since the route never runs moleculer-web's authentication step, `ctx.meta.webId` is always
> `undefined`, the ACL check runs as anonymous, and it fails unconditionally — regardless of a
> valid Bearer token or of what access has actually been granted. The fix has to land upstream
> (adding `authentication: true` — and probably `authorization: true` — to that route); nothing
> on the client side can work around it. Once that's fixed, the code here should work as-is.

```tsx
import { authProvider, dataProvider, liveProvider } from "@activitypods/refine-providers";

// Reuse the same `resources` (and `jsonContext`, if set) as the data provider
const apLiveProvider = liveProvider({ authProvider: apAuthProvider, resources });

const App = () => (
  <Refine
    authProvider={apAuthProvider}
    dataProvider={apDataProvider}
    liveProvider={apLiveProvider}
    options={{ liveMode: "auto", ... }}
    ...
  >
    ...
  </Refine>
);
```

Each subscription opens one [`WebSocketChannel2023`](https://solidproject.org/TR/notifications-protocol) per watched **topic** — a single resource (for `useShow`/`useOne`/`useForm` on a specific record) or a container (for `useTable`/`useList`, watching the whole resource). Because of that:

- Watching a specific record gets `updated`/`deleted` events for that record.
- Watching a list gets `created`/`deleted` events (container membership changes) — **not** `updated`, since a container isn't notified when one of its existing members' own fields change. If you need a list to reflect an in-place edit live, also watch the individual record somewhere (e.g. a `useShow` on the same page), or refetch — this mirrors how Solid containers actually notify, not a limitation specific to this provider.

## Not yet implemented

- **Shared/cross-user data**: only the logged-in user's own type index (public + private) is read. Resources shared by other users through Access Grants (`interop:hasAccessGrant` on the AppRegistration) are not fetched.

## Commands

```bash
pnpm install
pnpm build
pnpm watch
pnpm publish
```
