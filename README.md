# Refine providers for ActivityPods

Data and auth providers that can be used in any [Refine](https://refine.dev/core/) application to connect to [ActivityPods](https://activitypods.org/) (2.x) Pods.

This package is the ActivityPods counterpart of [`@ng-org/refine-providers`](https://github.com/) for NextGraph: same shape (a `dataProvider` and an `authProvider`, no framework lock-in), adapted to how ActivityPods actually works.

> For a full working example (login, list/create/edit/show), have a look at [`examples/antd-app`](./examples/antd-app/). It also wires up the live provider, though that part is currently blocked by an upstream bug — see [§5](#5-optional-enable-live-updates).

## How it differs from the NextGraph providers

- **Auth**: ActivityPods Pod providers only support [Solid-OIDC](https://solidproject.org/TR/oidc) login (with PKCE) — there is no username/password flow to implement. Because every app must also be explicitly granted access before it can read or write anything, the auth provider also exposes a `registerApp()` step, on top of the usual `login()`/`logout()`/`check()`. Given how much more involved this is than a typical login form, an `AntdAuthPage` component implementing all of it ships on its own subpath (see [§3](#3-wire-up-the-login-flow)). `registerApp()`/`getAppStatus()` also detect when a previously granted app has since been asked to do more (e.g. a new resource was added) and silently prompt for re-consent — see [§3.1](#31-re-consent-when-access-needs-change).
- **Data**: ActivityPods has no equivalent of NextGraph's ShEx-based shape types. Instead, resources live in **Data Registrations** (LDP containers), which the Pod registers — the first time access to a shape tree is granted — as a `solid:TypeRegistration` on the WebID's public (or private) [Solid TypeIndex](https://github.com/solid/solid/blob/main/proposals/data-discovery.md). The data provider reads that index directly (rather than the SAI RegistrySet/DataRegistry, which are restricted to the Pod owner and not readable by an app) to find each container. You only need to tell it which [shape tree](https://shapetrees.org/) (or type) each Refine resource corresponds to.
- **Pagination & filtering**: unlike the current NextGraph data provider, `getList` here fully honors Refine's `pagination`, `sorters` and `filters` (ActivityPods containers don't support server-side filtering, so this is done in-memory after fetching the container).
- **Live provider**: instead of NextGraph's local reactive signals, this uses the [Solid Notifications Protocol](https://solidproject.org/TR/notifications-protocol) (`WebSocketChannel2023`) — the Pod itself pushes events over a WebSocket. **Currently blocked by an upstream bug**, see [§5](#5-optional-enable-live-updates).

> **Requires ActivityPods v2.1.0+** on the Pod provider — that's when Data Registrations (and shape-tree-based access needs) were introduced. Containers are still discovered through the classic public/private [Solid TypeIndex](https://github.com/solid/solid/blob/main/proposals/data-discovery.md) rather than the newer (owner-only) SAI RegistrySet/DataRegistry. If you're running a Pod provider locally via Docker, remember `latest` is a static tag: `docker compose pull` (or `docker pull activitypods/backend`) to actually get the current image, since an already-pulled one won't update itself.

## Usage

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

const resources = {
  events: {
    // Preferred: identifies exactly which Data Registration to use
    shapeTreeUri: "https://shapes.activitypods.org/shapetrees/as/Event"
  },
  notes: {
    // Fallback: resolved against the Data Registrations' shape trees
    types: ["as:Note"]
  }
};

const apDataProvider = dataProvider({
  authProvider: apAuthProvider,
  resources,
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
<Route path="/login" element={<MyLoginPage />} /> {/* matches `redirectUri` above */}
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

> **⚠️ Known upstream bug: new *required* access needs can be silently granted without ever
> showing the user the consent screen.** `pod-provider/frontend`'s `UpgradeScreen.js` decides
> whether an access need is already covered by an *existing* grant by comparing
> `accessNeed['apods:registeredClass'] === grant['apods:registeredClass']` — a field from the
> pre-v2.1.0 TypeIndex-based access model. Access needs declared the current way (via
> `interop:registeredShapeTree`, as this package and [§1](#1-register-your-apps-access-needs) do)
> don't have an `apods:registeredClass` at all, so that comparison is `undefined === undefined` —
> always true. In practice this means a *new* access need silently matches *any* pre-existing
> grant whose access modes happen to be a superset of what it asks for (e.g. an existing
> `acl:Read, acl:Write` grant on one resource will "cover" a brand new `acl:Read`-only need on a
> completely different one), and the app is silently upgraded with no prompt at all. The grant it
> ends up with is still correct (the backend computes it properly, independently of this frontend
> bug), so this isn't a data-access bug — but it does mean the user was never actually asked.
> Confirmed by reading `pod-provider/frontend/src/pages/AuthorizePage/UpgradeScreen.js` directly
> from a Docker image pulled 2026-08-05; not something fixable from this package.

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
```
