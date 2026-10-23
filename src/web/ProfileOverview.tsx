import { Card, Descriptions, Empty, Space, Tag, Timeline, Typography } from "antd";
import type { Profile } from "../schemas";

const period = (start: string | null, end: string | null) => `${start ?? "?"} – ${end ?? "present"}`;

function TagList({ items }: { items: string[] }) {
  if (items.length === 0) return <Typography.Text type="secondary">—</Typography.Text>;
  return (
    <Space wrap>
      {items.map((item, i) => (
        <Tag key={i}>{item}</Tag>
      ))}
    </Space>
  );
}

export function ProfileOverview({ p }: { p: Profile }) {
  const empty = !p.name && p.experience.length === 0 && p.skills.length === 0;
  if (empty) {
    return <Empty description="No profile yet. Use Edit, Import CV or JSON / YAML." />;
  }

  const pref = p.preferences;

  return (
    <Space orientation="vertical" size="large" style={{ width: "100%" }}>
      <div>
        <Typography.Title level={3} style={{ marginTop: 0, marginBottom: 4 }}>
          {p.name ?? "Unnamed"}
        </Typography.Title>
        {p.headline && <Typography.Text type="secondary">{p.headline}</Typography.Text>}
      </div>

      <Descriptions
        size="small"
        bordered
        column={{ xs: 1, md: 2 }}
        items={[
          { key: "email", label: "Email", children: p.email ?? "—" },
          { key: "phone", label: "Phone", children: p.phone ?? "—" },
          { key: "location", label: "Location", children: p.location ?? "—" },
          { key: "links", label: "Links", children: <TagList items={p.links} /> },
        ]}
      />

      {p.summary && <Typography.Paragraph>{p.summary}</Typography.Paragraph>}

      <Card size="small" title="Skills">
        <TagList items={p.skills} />
      </Card>

      <Card size="small" title="Experience">
        {p.experience.length === 0 ? (
          <Typography.Text type="secondary">—</Typography.Text>
        ) : (
          <Timeline
            items={p.experience.map(e => ({
              key: `${e.company}-${e.title}-${e.start}`,
              content: (
                <>
                  <Typography.Text strong>{e.title}</Typography.Text> at {e.company}
                  <br />
                  <Typography.Text type="secondary">
                    {period(e.start, e.end)}
                    {e.location ? ` · ${e.location}` : ""}
                  </Typography.Text>
                  {e.description && <Typography.Paragraph style={{ margin: "8px 0 0" }}>{e.description}</Typography.Paragraph>}
                  {e.highlights.length > 0 && (
                    <ul style={{ margin: "4px 0 0" }}>
                      {e.highlights.map((h, i) => (
                        <li key={i}>{h}</li>
                      ))}
                    </ul>
                  )}
                </>
              ),
            }))}
          />
        )}
      </Card>

      <Card size="small" title="Education">
        {p.education.length === 0 ? (
          <Typography.Text type="secondary">—</Typography.Text>
        ) : (
          <Timeline
            items={p.education.map(e => ({
              key: `${e.institution}-${e.degree}-${e.start}`,
              content: (
                <>
                  <Typography.Text strong>{e.institution}</Typography.Text>
                  <br />
                  {[e.degree, e.field].filter(Boolean).join(", ")}
                  <br />
                  <Typography.Text type="secondary">{period(e.start, e.end)}</Typography.Text>
                  {e.details && <Typography.Paragraph style={{ margin: "8px 0 0" }}>{e.details}</Typography.Paragraph>}
                </>
              ),
            }))}
          />
        )}
      </Card>

      <Card size="small" title="Projects">
        {p.projects.length === 0 ? (
          <Typography.Text type="secondary">—</Typography.Text>
        ) : (
          <Space orientation="vertical" size="small">
            {p.projects.map((pr, i) => (
              <div key={i}>
                <Typography.Text strong>{pr.name}</Typography.Text>
                {pr.link && <Typography.Text type="secondary"> · {pr.link}</Typography.Text>}
                {pr.description && <Typography.Paragraph style={{ margin: 0 }}>{pr.description}</Typography.Paragraph>}
              </div>
            ))}
          </Space>
        )}
      </Card>

      <Card size="small" title="Languages">
        <TagList items={p.languages.map(l => (l.level ? `${l.language} (${l.level})` : l.language))} />
      </Card>

      <Card size="small" title="Certifications">
        <TagList items={p.certifications} />
      </Card>

      <Card size="small" title="Preferences">
        <Descriptions
          size="small"
          column={{ xs: 1, md: 2 }}
          items={[
            { key: "roles", label: "Desired roles", children: <TagList items={pref.desired_roles} /> },
            { key: "locations", label: "Locations", children: <TagList items={pref.locations} /> },
            { key: "remote", label: "Remote", children: pref.remote ?? "—" },
            { key: "salary", label: "Salary expectation", children: pref.salary_expectation ?? "—" },
            { key: "notes", label: "Notes", children: pref.notes ?? "—" },
          ]}
        />
      </Card>
    </Space>
  );
}
