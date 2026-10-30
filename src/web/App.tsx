import { useEffect, useState } from "react";
import { App as AntApp, ConfigProvider, Layout, Menu, theme } from "antd";
import { AddJobsPage } from "./AddJobsPage";
import { JobsPage } from "./JobsPage";
import { ProfilePage } from "./ProfilePage";
import { ChatPage } from "./ChatPage";
import { TasksPage } from "./TasksPage";
import { ModelSelect } from "./ModelSelect";
import { ReasoningSelect } from "./ReasoningSelect";

const tabs = ["jobs", "applied", "add", "profile", "chat", "tasks"] as const;
type Tab = (typeof tabs)[number];

const labels: Record<Tab, string> = {
  jobs: "Jobs",
  applied: "Applied",
  add: "Add jobs",
  profile: "Profile",
  chat: "Chat",
  tasks: "AI tasks",
};

function currentTab(): Tab {
  const h = location.hash.slice(1);
  return tabs.find(t => t === h) ?? "jobs";
}

export function App() {
  const [tab, setTab] = useState<Tab>(currentTab);

  useEffect(() => {
    const onHash = () => setTab(currentTab());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <ConfigProvider theme={{ algorithm: theme.defaultAlgorithm }}>
      <AntApp>
        <Layout style={{ minHeight: "100vh" }}>
          <Layout.Header style={{ display: "flex", alignItems: "center", gap: 24 }}>
            <strong style={{ color: "#fff" }}>Jobs</strong>
            <Menu
              theme="dark"
              mode="horizontal"
              selectedKeys={[tab]}
              items={tabs.map(t => ({ key: t, label: <a href={`#${t}`}>{labels[t]}</a> }))}
              style={{ flex: 1, minWidth: 0 }}
            />
            <ModelSelect />
            <ReasoningSelect />
          </Layout.Header>
          <Layout.Content style={{ padding: 24, maxWidth: 1200, width: "100%", margin: "0 auto" }}>
            {tab === "jobs" && <JobsPage />}
            {tab === "applied" && <JobsPage applied />}
            {tab === "add" && <AddJobsPage />}
            {tab === "profile" && <ProfilePage />}
            {tab === "chat" && <ChatPage />}
            {tab === "tasks" && <TasksPage />}
          </Layout.Content>
        </Layout>
      </AntApp>
    </ConfigProvider>
  );
}
