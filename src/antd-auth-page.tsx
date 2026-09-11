import { Fragment, useEffect, useRef, useState } from "react";
import { useGetIdentity, useGetLocale, useLogin, useLogout, useNotification, useTranslate } from "@refinedev/core";
import { useNavigate, useSearchParams } from "react-router";
import { Avatar, Button, Card, Divider, Layout, Space, Spin, Typography, theme } from "antd";
import { DatabaseOutlined, LockOutlined } from "@ant-design/icons";
import type { AuthProvider } from "./types";

// A curated list of public Pod providers, published by https://activitypods.org/data/pod-providers
const POD_PROVIDERS_URL = "https://activitypods.org/data/pod-providers";

/**
 * Where to go once the flow completes, kept across the consent-screen hop.
 *
 * `registerApp()` may hand over to the authorization agent, which comes back to the app's
 * `interop:hasAuthorizationCallbackEndpoint` — a fixed URL declared by the app, carrying none of
 * our query parameters. Without this, everything the caller asked for is lost at that point and
 * the user lands on `defaultRedirect` instead of the page they were trying to reach.
 */
const STORAGE_KEY_PAGE_REDIRECT = "activitypods.authPageRedirect";

const stashRedirect = (path: string) => {
  try {
    localStorage.setItem(STORAGE_KEY_PAGE_REDIRECT, path);
  } catch {
    // Blocked storage: the user just lands on the default page
  }
};

const readStashedRedirect = () => {
  try {
    return localStorage.getItem(STORAGE_KEY_PAGE_REDIRECT) || undefined;
  } catch {
    return undefined;
  }
};

const clearStashedRedirect = () => {
  try {
    localStorage.removeItem(STORAGE_KEY_PAGE_REDIRECT);
  } catch {
    // Nothing to clean up if storage is unavailable
  }
};

/** Only accept in-app paths as a redirect target, never absolute URLs (open-redirect guard). */
const isPath = (value: unknown): value is string =>
  typeof value === "string" && value.startsWith("/") && !/\s/.test(value);

/** A Pod provider entry, as published by the `POD_PROVIDERS_URL` endpoint. */
export type PodProvider = {
  /** Base URL of the Pod provider, used as the Solid-OIDC issuer */
  "apods:baseUrl": string;
  /** Human-readable geographic area the provider serves, e.g. "Ouest de la France" */
  "apods:area"?: string;
  /** Language(s) of the provider's UI (2-letter codes). Used to filter the list by the app's locale */
  "apods:locales"?: string | string[];
  /** Name of the organization operating the provider */
  "apods:providedBy"?: string;
};

export type AntdAuthPageProps = {
  /** The auth provider instance returned by `authProvider()` from this package. */
  authProvider: AuthProvider;
  /**
   * Replace the public Pod providers list (fetched from activitypods.org and filtered by the
   * current locale) with a custom one.
   */
  customPodProviders?: PodProvider[];
  /**
   * Shorthand for `customPodProviders` with a single entry: skip fetching the public list and
   * offer this one URL instead — e.g. for a local dev Pod provider. Typically read from an env
   * var by the consuming app (see the README).
   */
  defaultPodProvider?: string;
  /** Text shown above the providers list. Defaults to the translated `pages.login.choosePodProvider`. */
  text?: string;
  /** Where to send the user once logged in and registered. Defaults to `/`. */
  redirect?: string;
};

/**
 * A login page for ActivityPods' Solid-OIDC flow, modeled on `@activitypods/react`'s `LoginPage`.
 *
 * Shows the public Pod providers that match the app's current locale (via Refine's
 * `useGetLocale`), or the `customPodProviders` / `defaultPodProvider` given as props, and starts
 * the login on selection. Like the react-admin original, it also reacts to a few search params:
 *
 * - `?signup`: send the user through the provider's signup flow rather than login.
 * - `?iss=<url>`: the Pod provider is already known, log in there straight away.
 * - `?logout`: log out immediately (then land on `?redirect`, or stay on this page).
 * - `?redirect=<path>`: where to go once done (in-app paths only).
 *
 * A single mount point handles every stage — there's no need for a separate `/auth-callback`
 * route (unlike react-admin, Refine has no automatic one) as long as it's mounted at whatever
 * route `authProvider()`'s `redirectUri` is configured to (defaults to `/login`, i.e. this
 * component's usual route already matches). It tells which stage it's in from the URL:
 *
 * 1. None of the params below: shows the providers list described above.
 * 2. `?code=...` (the Pod redirected back after login): completes the OAuth exchange via
 *    `authProvider.handleCallback()`, then moves to the next stage.
 * 3. `?register_app=1`: makes sure this app is registered with the user's authorization agent
 *    (redirecting to the consent screen if not), then navigates to `redirect`.
 */
export const AntdAuthPage = ({
  authProvider,
  customPodProviders,
  defaultPodProvider,
  text,
  redirect: defaultRedirect = "/",
}: AntdAuthPageProps) => {
  const { token } = theme.useToken();
  const translate = useTranslate();
  const getLocale = useGetLocale();
  const { open: notify } = useNotification();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { mutate: login } = useLogin();
  const { mutate: logout } = useLogout();
  const { data: identity, isLoading: isIdentityLoading, refetch: refetchIdentity } = useGetIdentity();

  const initialPodProviders =
    customPodProviders || (defaultPodProvider ? [{ "apods:baseUrl": defaultPodProvider }] : []);
  const [podProviders, setPodProviders] = useState<PodProvider[]>(initialPodProviders);
  const [error, setError] = useState<string | null>(null);
  const [isRegistered, setIsRegistered] = useState(false);

  // `getLocale()` may return a region-qualified tag (e.g. "fr-FR" from i18next) while the
  // providers list uses bare language codes.
  const locale = getLocale()?.split(/[-_]/)[0];
  const isSignup = searchParams.has("signup");
  const hasCode = searchParams.has("code");
  const hasRegisterApp = searchParams.has("register_app");
  const isProcessing = hasCode || hasRegisterApp;
  // Only consulted while a flow is in progress: on a fresh visit the stash may hold a
  // leftover from an abandoned attempt, which must not be passed to `login()`.
  const requestedRedirect = searchParams.get("redirect");
  const redirect =
    (isPath(requestedRedirect) ? requestedRedirect : undefined) ||
    (isProcessing ? readStashedRedirect() : undefined) ||
    defaultRedirect;

  // Fetch the public providers list (filtered by locale), unless a custom one was given or we're mid-flow
  useEffect(() => {
    if (initialPodProviders.length > 0 || isProcessing) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(POD_PROVIDERS_URL, { headers: { Accept: "application/ld+json" } });
        if (!response.ok) throw new Error(response.statusText);
        const json = await response.json();
        const providers: PodProvider[] = json["ldp:contains"] || [];
        if (!cancelled) {
          setPodProviders(
            locale
              ? providers.filter((provider) => {
                  const locales = provider["apods:locales"];
                  return Array.isArray(locales) ? locales.includes(locale) : locales === locale;
                })
              : providers,
          );
        }
      } catch {
        if (!cancelled) {
          notify?.({
            type: "error",
            message: translate("pages.login.podProvidersNotLoaded", "Unable to load the list of Pod providers"),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPodProviders.length, isProcessing, locale]);

  // Shortcuts driven by search params, mirroring `@activitypods/react`'s LoginPage
  const handledShortcutRef = useRef(false);
  useEffect(() => {
    if (isProcessing || handledShortcutRef.current) return;
    const issuer = searchParams.get("iss");
    if (issuer) {
      // The Pod provider is already known: no need to pick one
      handledShortcutRef.current = true;
      login({ issuer, redirect, isSignup });
    } else if (searchParams.has("logout")) {
      // Immediately log out if required
      handledShortcutRef.current = true;
      logout({ redirectPath: redirect });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProcessing, searchParams]);

  // Step 1: complete the OAuth code exchange, then move to the app-registration step
  const handledCodeRef = useRef(false);
  useEffect(() => {
    if (!hasCode || handledCodeRef.current) return;
    handledCodeRef.current = true;
    authProvider
      .handleCallback()
      .then(({ redirect: postLoginRedirect }) => {
        const next = new URLSearchParams();
        next.set("register_app", "1");
        next.set("redirect", postLoginRedirect);
        navigate(`?${next.toString()}`, { replace: true });
      })
      .catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasCode]);

  // Step 2: make sure the app is registered with the user's authorization agent
  const handledRegisterRef = useRef(false);
  useEffect(() => {
    if (!hasRegisterApp || hasCode || handledRegisterRef.current) return;
    handledRegisterRef.current = true;
    const session = authProvider.getSession();
    if (!session) {
      setError("You must be logged in to register this app.");
      return;
    }
    // `registerApp()` may leave for the consent screen, whose return trip drops our query
    stashRedirect(redirect);
    authProvider
      .registerApp(session.webId)
      .then(async (appRegistrationUri) => {
        // If `registerApp` had to redirect to the consent screen, it navigates away itself
        // and this promise never resolves before the page unloads.
        if (appRegistrationUri) {
          // `identity` was first queried (and cached as unauthenticated) on this same page's
          // initial render, before login even started — registerApp() isn't part of Refine's
          // AuthProvider contract, so Refine has no way to know it should invalidate that cached
          // query. Without an explicit refetch here, `identity` never resolves to a logged-in
          // user on this page, and the effect below waits forever — only a full page reload
          // (which starts a fresh, uncached query) picks up the change.
          await refetchIdentity();
          setIsRegistered(true);
        }
      })
      .catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRegisterApp, hasCode]);

  // Once registerApp() has resolved (and Refine's identity cache has caught up), leave for
  // the originally requested page.
  useEffect(() => {
    if (isRegistered && !isIdentityLoading && identity) {
      clearStashedRedirect();
      navigate(redirect, { replace: true });
    }
  }, [isRegistered, isIdentityLoading, identity, navigate, redirect]);

  if (isProcessing) {
    return (
      <Layout style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {error ? (
          <Space direction="vertical" align="center">
            <Typography.Text type="danger">{error}</Typography.Text>
            <Button onClick={() => navigate("/login", { replace: true })}>
              {translate("pages.login.backToLogin", "Back to login")}
            </Button>
          </Space>
        ) : (
          <Spin size="large" />
        )}
      </Layout>
    );
  }

  return (
    <Layout style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center" }}>
      <Card
        style={{ minWidth: 300, maxWidth: 350, marginTop: "6em", backgroundColor: token.colorBgElevated }}
        styles={{ body: { padding: 0 } }}
      >
        <div style={{ margin: "1em", display: "flex", justifyContent: "center" }}>
          <Avatar size={40} icon={<LockOutlined />} />
        </div>
        <div style={{ paddingLeft: 16, paddingRight: 16 }}>
          <Typography.Paragraph
            type="secondary"
            style={{ textAlign: "center", padding: "4px 8px 8px", marginBottom: 0, fontSize: token.fontSizeSM }}
          >
            {text ||
              translate("pages.login.choosePodProvider", "Choose the Pod provider that hosts your ActivityPods account")}
          </Typography.Paragraph>
        </div>
        <div style={{ margin: 16 }}>
          {podProviders.map((podProvider, i) => (
            <Fragment key={i}>
              <Divider style={{ margin: 0 }} />
              <Button
                type="text"
                block
                onClick={() => login({ issuer: podProvider["apods:baseUrl"], redirect, isSignup })}
                style={{ height: "auto", padding: "8px 16px", justifyContent: "flex-start", textAlign: "left" }}
              >
                <Space size="middle" align="center">
                  <Avatar size={40} icon={<DatabaseOutlined />} />
                  <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.5 }}>
                    <Typography.Text>{new URL(podProvider["apods:baseUrl"]).host}</Typography.Text>
                    {podProvider["apods:area"] && (
                      <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                        {podProvider["apods:area"]}
                      </Typography.Text>
                    )}
                  </div>
                </Space>
              </Button>
            </Fragment>
          ))}
        </div>
      </Card>
    </Layout>
  );
};

export default AntdAuthPage;
