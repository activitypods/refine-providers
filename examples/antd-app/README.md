## Simple Ant Design app for ActivityPods

A simple app that uses [Refine](https://refine.dev/core/) providers compatible with [ActivityPods](https://activitypods.org/) and the [Ant Design](https://ant.design/) design system. It manages `as:Note` resources on a user's Pod, and displays the logged-in user's `as:Profile`.

## No app backend required

Unlike the typical ActivityPods app (see [Create Your First Social App](https://activitypods.org/docs/guides/create-your-first-social-app/)), this example doesn't need a Moleculer app backend. Everything an ActivityPods Pod provider needs to know about the app — its Solid-OIDC client metadata and which shape trees it needs access to — is just a small set of dereferenceable JSON-LD documents, served here as plain static files:

- [`public/app.json`](./public/app.json) — the app's "actor" description (OIDC client metadata + a pointer to the access needs below). This is also the Solid-OIDC `client_id`.
- [`public/access-need-group.json`](./public/access-need-group.json) — the group of access needs requested (all required, for personal access).
- [`public/access-need-note.json`](./public/access-need-note.json) — read/write on `as:Note` resources.
- [`public/access-need-profile.json`](./public/access-need-profile.json) — read-only access to the user's own `as:Profile`, used by the dashboard.

This works because the Pod provider fetches these documents directly (both for Solid-OIDC client validation and to compute what to grant) and, crucially, only tries to notify the app's own backend (over its ActivityPub inbox) if the app description declares one — ours doesn't, so nothing else is needed. The tradeoff: no real-time notifications, no access to other users' shared data (which requires a signing backend), and no server-side bookkeeping — none of which this example needs.

These files hardcode `http://localhost:5173` (the dev server's port, pinned in `vite.config.ts`). If you change the port or deploy this app, update the URLs inside all four files (and `oidc:redirect_uris` etc.) to match, or point `VITE_CLIENT_ID` at your own hosted app description.

## Prerequisites

You need a running Pod provider **on ActivityPods v2.1.0 or later** (this is what introduced Data Registrations, which this package relies on): either a public one from https://activitypods.org/data/pod-providers, or a local one — see below.

### Running a local Pod provider

This repo includes a `docker-compose.yml`, adapted from the [app-boilerplate](https://github.com/activitypods/app-boilerplate)'s dev setup, to run just the Pod provider infrastructure.

```bash
docker compose up
```

This starts the ActivityPods backend and frontend, the Fuseki triplestore and Redis. Once it's up:

- Create an account at http://localhost:5000 (the Pod provider's own frontend).
- This example's login page already offers `http://localhost:3000` (see `VITE_POD_PROVIDER_URL` in `.env`) as the Pod provider to sign in with, instead of fetching the public providers list — change or remove it to use a different/public Pod provider.

## Quick start

```bash
pnpm install
pnpm run dev
```

Open the app, pick (or type) your Pod provider's URL, log in, and grant this app access to your notes when prompted. You should then be able to create, list, edit and delete posts.

## What's different from the NextGraph example

- There is no "broker URL" field: the login page (`AntdAuthPage`, from `@activitypods/refine-providers/antd-auth-page` — see `App.tsx`) lets you pick a Pod provider (or use the local one configured via `VITE_POD_PROVIDER_URL`) and logs in via Solid-OIDC.
- That same component is mounted at a single `/login` route: unlike react-admin, Refine has no built-in auth-callback route, but `AntdAuthPage` doesn't need one either — it figures out what to do from the URL's search params (initial picker, OAuth code exchange, then registering the app with the user's authorization agent) — see the main package's README for details.
- `apAuthProvider()` (in `providers.ts`) polls in the background and silently redirects back to the consent screen if the app's access needs ever change while you're already logged in (e.g. after the `profile` resource was added below) — see the main README's [§3.1](../../README.md#31-re-consent-when-access-needs-change). This relies on `public/app.json`'s `dc:modified` field being bumped whenever an access need changes — already done here.
- No live provider wired up here: the package has one (built on the Solid Notifications Protocol), but it's currently blocked by an upstream bug in ActivityPods/SemApps — see the main README's [§5](../../README.md#5-optional-enable-live-updates) for the root cause. Until that's fixed, you'll need to refresh manually to see changes made elsewhere.
