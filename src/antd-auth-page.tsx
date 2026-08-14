import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useGetIdentity, useLogin, useTranslate } from "@refinedev/core";
import { useNavigate, useSearchParams } from "react-router";
import { Row, Col, Layout, Card, Form, Input, Button, List, Typography, Space, Spin, theme } from "antd";
import { CloudServerOutlined, LockOutlined } from "@ant-design/icons";
import type { AuthProvider } from "./types";

// A curated list of public Pod providers, published by https://activitypods.org/data/pod-providers
const POD_PROVIDERS_URL = "https://activitypods.org/data/pod-providers";

type PublicPodProvider = {
  "apods:baseUrl": string;
  "apods:area"?: string;
};

export type AntdAuthPageProps = {
  /** The auth provider instance returned by `authProvider()` from this package. */
  authProvider: AuthProvider;
  /**
   * Skip fetching the public Pod providers list and offer this single URL instead — e.g. for a
   * local dev Pod provider. The manual URL field stays available either way. Typically read from
   * an env var by the consuming app (see the README).
   */
  defaultPodProvider?: string;
  /** Where to send the user once logged in and registered. Defaults to `/`. */
  redirect?: string;
};

const containerStyle: CSSProperties = {
  maxWidth: "420px",
  margin: "auto",
  padding: "32px",
  boxShadow:
    "0px 2px 4px rgba(0, 0, 0, 0.02), 0px 1px 6px -1px rgba(0, 0, 0, 0.02), 0px 1px 2px rgba(0, 0, 0, 0.03)",
};

/**
 * A login page for ActivityPods' Solid-OIDC flow. A single mount point handles every stage —
 * there's no need for a separate `/auth-callback` route (unlike react-admin, Refine has no
 * automatic one) as long as it's mounted at whatever route `authProvider()`'s `redirectUri` is
 * configured to (defaults to `/login`, i.e. this component's usual route already matches). It
 * tells which stage it's in from the URL's search params:
 *
 * 1. No relevant params: shows a list of public Pod providers (or `defaultPodProvider`, if set)
 *    plus a manual URL field, and calls `login({ issuer, redirect })` on selection.
 * 2. `?code=...` (the Pod redirected back after login): completes the OAuth exchange via
 *    `authProvider.handleCallback()`, then moves to the next stage.
 * 3. `?register_app=1`: makes sure this app is registered with the user's authorization agent
 *    (redirecting to the consent screen if not), then navigates to `redirect`.
 */
export const AntdAuthPage = ({ authProvider, defaultPodProvider, redirect: defaultRedirect = "/" }: AntdAuthPageProps) => {
  const { token } = theme.useToken();
  const translate = useTranslate();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { mutate: login, isPending } = useLogin();
  const { data: identity, isLoading: isIdentityLoading, refetch: refetchIdentity } = useGetIdentity();

  const [podProviders, setPodProviders] = useState<PublicPodProvider[]>(
    defaultPodProvider ? [{ "apods:baseUrl": defaultPodProvider }] : [],
  );
  const [customUrl, setCustomUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isRegistered, setIsRegistered] = useState(false);

  const hasCode = searchParams.has("code");
  const hasRegisterApp = searchParams.has("register_app");
  const isProcessing = hasCode || hasRegisterApp;
  const redirect = searchParams.get("redirect") || defaultRedirect;

  // Fetch the public provider list, unless a default was configured or we're mid-flow
  useEffect(() => {
    if (defaultPodProvider || isProcessing) return;
    fetch(POD_PROVIDERS_URL, { headers: { Accept: "application/ld+json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((json) => {
        if (json?.["ldp:contains"]) setPodProviders(json["ldp:contains"]);
      })
      .catch(() => {
        // Ignore: the manual URL field below still works
      });
  }, [defaultPodProvider, isProcessing]);

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
    if (isRegistered && !isIdentityLoading && identity) navigate(redirect, { replace: true });
  }, [isRegistered, isIdentityLoading, identity, navigate, redirect]);

  if (isProcessing) {
    return (
      <Layout style={{ minHeight: "100dvh" }}>
        <Row justify="center" align="middle" style={{ minHeight: "100dvh" }}>
          <Col style={{ textAlign: "center" }}>
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
          </Col>
        </Row>
      </Layout>
    );
  }

  return (
    <Layout style={{ minHeight: "100dvh" }}>
      <Row justify="center" align="middle" style={{ padding: "16px 0", minHeight: "100dvh" }}>
        <Col xs={22}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "32px", fontSize: "20px" }}>
            {translate("pages.login.title", "Sign in")}
          </div>
          <Card
            style={{ ...containerStyle, backgroundColor: token.colorBgElevated }}
            styles={{ body: { padding: 0 } }}
          >
            <div style={{ padding: 24, paddingBottom: 8, textAlign: "center" }}>
              <LockOutlined style={{ fontSize: 24 }} />
              <Typography.Paragraph style={{ marginTop: 12 }}>
                {translate(
                  "pages.login.choosePodProvider",
                  "Choose the Pod provider that hosts your ActivityPods account",
                )}
              </Typography.Paragraph>
            </div>

            {podProviders.length > 0 && (
              <List
                dataSource={podProviders}
                renderItem={(provider) => (
                  <List.Item
                    style={{ cursor: "pointer", padding: "12px 24px" }}
                    onClick={() => login({ issuer: provider["apods:baseUrl"], redirect })}
                  >
                    <Space>
                      <CloudServerOutlined />
                      <div>
                        <div>{new URL(provider["apods:baseUrl"]).host}</div>
                        {provider["apods:area"] && (
                          <Typography.Text type="secondary">{provider["apods:area"]}</Typography.Text>
                        )}
                      </div>
                    </Space>
                  </List.Item>
                )}
              />
            )}

            <Form layout="vertical" style={{ padding: 24 }} onFinish={() => login({ issuer: customUrl, redirect })}>
              <Form.Item
                label={translate("pages.login.fields.issuer", "Pod provider URL")}
                rules={[{ required: true, type: "url" }]}
              >
                <Input
                  size="large"
                  placeholder="https://mypod.provider.org"
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                />
              </Form.Item>
              <Form.Item style={{ marginBottom: 0 }}>
                <Button type="primary" size="large" htmlType="submit" loading={isPending} block>
                  {translate("pages.login.signin", "Sign in")}
                </Button>
              </Form.Item>
            </Form>
          </Card>
        </Col>
      </Row>
    </Layout>
  );
};

export default AntdAuthPage;
