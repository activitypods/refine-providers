import { authProvider as apAuthProvider, dataProvider as apDataProvider } from "@activitypods/refine-providers";

/**
 * The URI that identifies this application. ActivityPods uses it as the Solid-OIDC `client_id`:
 * it must be dereferenceable and describe the app (name, OIDC redirect URIs, and the shape
 * trees it needs access to). See public/app.json (and the access-need-*.json files it
 * references) for that description — no app backend is required to serve it.
 *
 * These URLs are hardcoded to port 5173 (see vite.config.ts). If you deploy this app or change
 * its port, update public/app.json and friends to match, or override VITE_CLIENT_ID.
 */
export const CLIENT_ID = import.meta.env.VITE_CLIENT_ID || `${window.location.origin}/app.json`;

/**
 * When set, the login page offers this single Pod provider instead of fetching the public list
 * from https://activitypods.org/data/pod-providers — handy when developing against a local one
 * (see the README's Docker setup, which serves the Pod provider at this exact URL by default).
 */
export const DEFAULT_POD_PROVIDER = import.meta.env.VITE_POD_PROVIDER_URL || "http://localhost:3000";

export const authProvider = apAuthProvider({
  clientId: CLIENT_ID,
});

export const dataProvider = apDataProvider({
  authProvider,
  resources: {
    posts: {
      // The "Note" shape tree is one of the shape trees deployed by default on
      // https://shapes.activitypods.org, and is used throughout the ActivityPods documentation.
      shapeTreeUri: "https://shapes.activitypods.org/shapetrees/as/Note",
    },
    profile: {
      // Read-only access (see public/access-need-profile.json): used by the dashboard to
      // display the logged-in user's own profile via the data provider rather than the
      // auth provider's identity shortcut.
      shapeTreeUri: "https://shapes.activitypods.org/shapetrees/as/Profile",
    },
  },
});
