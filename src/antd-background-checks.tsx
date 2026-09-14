import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useGetIdentity, useLogout, useTranslate } from "@refinedev/core";
import { useNavigate } from "react-router";
import { Button, Space, Spin, Typography, theme } from "antd";
import { ExclamationCircleFilled } from "@ant-design/icons";
import { STORAGE_KEY_REDIRECT } from "./auth-provider";
import { arrayOf } from "./utils";
import type { AuthProvider } from "./types";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type AntdBackgroundChecksProps = {
  /** The auth provider instance returned by `authProvider()` from this package. */
  authProvider: AuthProvider;
  /**
   * URIs (e.g. the user's inbox and outbox) the app's backend must have a webhook channel on.
   * If one is missing after a few retries, an error is shown instead of the app.
   */
  listeningTo?: string[];
  /**
   * How often (in ms) to re-run the checks. Also runs on every `visibilitychange`. Defaults to
   * 2 minutes, matching ActivityPods' own `BackgroundChecks`; pass `false` to only check once.
   */
  checkInterval?: number | false;
  children: ReactNode;
};

/**
 * Gate the app behind a check of the Pod's `/.well-known/app-status` endpoint, modeled on
 * `@activitypods/react`'s `BackgroundChecks`. While logged in:
 *
 * - If the app's backend is offline, show an error instead of the app.
 * - If the app is not registered, or its granted access needs are stale (`upgradeNeeded`),
 *   send the user to the authorization agent's consent screen via `authProvider.registerApp()`.
 * - If the backend is not listening to one of the `listeningTo` URIs (webhooks are created
 *   shortly after registration, so this is retried for a few seconds), show an error.
 *
 * Renders `children` as-is while logged out. When the consent screen sends the user back, the
 * page they were on (saved by `registerApp()`) is restored.
 *
 * `authProvider()` polls `upgradeNeeded` on its own too (see `appStatusCheckInterval`); when
 * using this component, pass `appStatusCheckInterval: false` there to avoid doing it twice.
 */
export const AntdBackgroundChecks = ({
  authProvider,
  listeningTo = [],
  checkInterval = 120000,
  children,
}: AntdBackgroundChecksProps) => {
  const { token } = theme.useToken();
  const translate = useTranslate();
  const navigate = useNavigate();
  const { mutate: logout } = useLogout();
  const { data: identity, isLoading: isIdentityLoading } = useGetIdentity();
  const [appStatusChecked, setAppStatusChecked] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const isLoggedIn = !!identity;
  const isLoggedOut = !isIdentityLoading && !identity;

  // `listeningTo` is usually an inline array literal: compare by content so it doesn't retrigger every render
  const listeningToKey = listeningTo.join(" ");
  const listeningToRef = useRef(listeningTo);
  listeningToRef.current = listeningTo;

  const checkAppStatus = useCallback(async () => {
    // Only proceed if the tab is visible
    if (document.hidden) return;
    const session = authProvider.getSession();
    if (!session) return;

    try {
      let appStatus = await authProvider.getAppStatus();

      if (!appStatus.onlineBackend) {
        setErrorMessage(translate("apods.error.app_offline", "The app backend is offline"));
        return;
      }

      if (!appStatus.installed || appStatus.upgradeNeeded) {
        // Leaves for the consent screen (and resolves with `undefined`) unless the app turns out
        // to be registered and up to date after all
        const appRegistrationUri = await authProvider.registerApp(session.webId);
        if (!appRegistrationUri) return;
      }

      if (listeningToRef.current.length > 0) {
        let numAttempts = 0;
        let missingListener: string | undefined;

        do {
          missingListener = listeningToRef.current.find(
            (uri) => !arrayOf(appStatus.webhookChannels).some((channel) => channel.topic === uri),
          );

          // If a listener is missing, wait 1s and refetch the app status. This happens when the
          // app was just registered, and the webhooks have not been created yet
          if (missingListener) {
            numAttempts++;
            await delay(1000);
            appStatus = await authProvider.getAppStatus();
          }
        } while (missingListener && numAttempts < 10);

        if (missingListener) {
          setErrorMessage(
            translate("apods.error.app_not_listening", { uri: missingListener }, "The app is not listening to {{uri}}"),
          );
          return;
        }
      }

      setAppStatusChecked(true);
    } catch (e) {
      console.error(e);
      setErrorMessage(translate("apods.error.app_status_unavailable", "Unable to check app status"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authProvider, translate, listeningToKey]);

  useEffect(() => {
    if (!isLoggedIn) return;
    checkAppStatus();
    if (checkInterval === false) return;
    const timerId = setInterval(checkAppStatus, checkInterval);
    return () => clearInterval(timerId);
  }, [isLoggedIn, checkAppStatus, checkInterval]);

  useLayoutEffect(() => {
    document.addEventListener("visibilitychange", checkAppStatus);
    return () => document.removeEventListener("visibilitychange", checkAppStatus);
  }, [checkAppStatus]);

  // `registerApp()` saves the current page before leaving for the consent screen, whose return
  // trip lands on the app's fixed callback endpoint: bring the user back where they were.
  useEffect(() => {
    if (!isLoggedIn) return;
    const redirectUrl = localStorage.getItem(STORAGE_KEY_REDIRECT);
    if (redirectUrl) {
      localStorage.removeItem(STORAGE_KEY_REDIRECT);
      navigate(redirectUrl, { replace: true });
    }
  }, [isLoggedIn, navigate]);

  if (isLoggedOut || appStatusChecked) {
    return <>{children}</>;
  }

  if (errorMessage) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 400 }}>
        <div style={{ backgroundColor: token.colorError, padding: 16, textAlign: "center", borderRadius: token.borderRadius }}>
          <ExclamationCircleFilled style={{ fontSize: 50, color: token.colorWhite }} />
          <Typography.Paragraph style={{ color: token.colorWhite, marginTop: 8 }}>{errorMessage}</Typography.Paragraph>
          <Space>
            <Button
              danger
              type="primary"
              onClick={() => {
                setErrorMessage(undefined);
                checkAppStatus();
              }}
            >
              {translate("buttons.refresh", "Refresh")}
            </Button>
            <Button danger type="primary" onClick={() => logout()}>
              {translate("buttons.logout", "Logout")}
            </Button>
          </Space>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 400 }}>
      <Spin size="large" />
    </div>
  );
};

export default AntdBackgroundChecks;
