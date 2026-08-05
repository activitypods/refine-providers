import { Refine, Authenticated } from "@refinedev/core";
import { useNotificationProvider, ThemedLayout, ErrorComponent, RefineThemes } from "@refinedev/antd";
import routerProvider, { CatchAllNavigate, UnsavedChangesNotifier, DocumentTitleHandler } from "@refinedev/react-router";
import { AntdAuthPage } from "@activitypods/refine-providers/antd-auth-page";
import { BrowserRouter, Routes, Route, Outlet } from "react-router";
import { DashboardOutlined } from "@ant-design/icons";
import { App as AntdApp, ConfigProvider } from "antd";

import "@ant-design/v5-patch-for-react-19";
import "@refinedev/antd/dist/reset.css";

import { authProvider, dataProvider, DEFAULT_POD_PROVIDER } from "./providers";
import { PostList, PostCreate, PostEdit, PostShow } from "./pages/posts";
import { DashboardPage } from "./pages/dashboard";

const App: React.FC = () => (
  <BrowserRouter basename={import.meta.env.MODE === "production" ? "/activitypods-refine-app/" : "/"}>
    <ConfigProvider theme={RefineThemes.Blue}>
      <AntdApp>
        <Refine
          authProvider={authProvider}
          dataProvider={dataProvider}
          routerProvider={routerProvider}
          resources={[
            {
              name: "dashboard",
              list: "/",
              meta: {
                label: "Dashboard",
                icon: <DashboardOutlined />,
              },
            },
            {
              name: "posts",
              list: "/posts",
              create: "/posts/create",
              show: "/posts/show/:id",
              edit: "/posts/edit/:id",
              meta: {
                canDelete: true,
              },
            },
          ]}
          notificationProvider={useNotificationProvider}
          options={{
            syncWithLocation: true,
            warnWhenUnsavedChanges: true,
            disableTelemetry: true,
          }}
        >
          <Routes>
            <Route
              element={
                <Authenticated key="authenticated-routes" fallback={<CatchAllNavigate to="/login" />}>
                  <ThemedLayout>
                    <Outlet />
                  </ThemedLayout>
                </Authenticated>
              }
            >
              <Route index element={<DashboardPage />} />

              <Route path="/posts">
                <Route index element={<PostList />} />
                <Route path="create" element={<PostCreate />} />
                <Route path="edit/:id" element={<PostEdit />} />
                <Route path="show/:id" element={<PostShow />} />
              </Route>
            </Route>

            {/*
              Not wrapped in <Authenticated>. AntdAuthPage handles every stage (provider picker,
              OAuth callback, app registration) based on URL search params (see its docstring),
              so this single route doubles as the `redirectUri` authProvider() defaults to.
            */}
            <Route
              path="/login"
              element={<AntdAuthPage authProvider={authProvider} defaultPodProvider={DEFAULT_POD_PROVIDER} />}
            />

            <Route
              element={
                <Authenticated key="catch-all">
                  <ThemedLayout>
                    <Outlet />
                  </ThemedLayout>
                </Authenticated>
              }
            >
              <Route path="*" element={<ErrorComponent />} />
            </Route>
          </Routes>
          <UnsavedChangesNotifier />
          <DocumentTitleHandler />
        </Refine>
      </AntdApp>
    </ConfigProvider>
  </BrowserRouter>
);

export default App;
