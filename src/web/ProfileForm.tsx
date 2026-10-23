import type { ReactNode } from "react";
import { Button, Card, Form, Input, Select, Space } from "antd";
import { MinusCircleOutlined, PlusOutlined, SaveOutlined } from "@ant-design/icons";
import type { Profile } from "../schemas";

// Empty inputs become null so optional fields match the server schema.
const emptyToNull = (_key: string, value: unknown) => (value === "" ? null : value);

const fieldWidth = { width: 260, marginBottom: 0 };

// Repeating section (experience, education, ...). `renderItem` gets the list index
// and must return Form.Item elements named relative to that index.
function Repeater({
  name,
  title,
  addLabel,
  blank,
  renderItem,
}: {
  name: string;
  title: string;
  addLabel: string;
  blank: Record<string, unknown>;
  renderItem: (index: number) => ReactNode;
}) {
  return (
    <Card size="small" title={title} style={{ marginBottom: 16 }}>
      <Form.List name={name}>
        {(fields, { add, remove }) => (
          <Space orientation="vertical" style={{ width: "100%" }}>
            {fields.map(field => (
              <Card
                key={field.key}
                size="small"
                type="inner"
                extra={
                  <Button
                    type="text"
                    danger
                    icon={<MinusCircleOutlined />}
                    aria-label="Remove entry"
                    onClick={() => remove(field.name)}
                  />
                }
              >
                <Space wrap align="start">
                  {renderItem(field.name)}
                </Space>
              </Card>
            ))}
            <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add(blank)}>
              {addLabel}
            </Button>
          </Space>
        )}
      </Form.List>
    </Card>
  );
}

export function ProfileForm({ initial, onSave }: { initial: Profile; onSave: (text: string) => void }) {
  return (
    <Form
      layout="vertical"
      initialValues={initial}
      onFinish={values => onSave(JSON.stringify(values, emptyToNull))}
    >
      <Card size="small" title="Basics" style={{ marginBottom: 16 }}>
        <Space wrap align="start">
          <Form.Item name="name" label="Name" style={fieldWidth}>
            <Input />
          </Form.Item>
          <Form.Item name="headline" label="Headline" style={fieldWidth}>
            <Input />
          </Form.Item>
          <Form.Item name="email" label="Email" style={fieldWidth}>
            <Input />
          </Form.Item>
          <Form.Item name="phone" label="Phone" style={fieldWidth}>
            <Input />
          </Form.Item>
          <Form.Item name="location" label="Location" style={fieldWidth}>
            <Input />
          </Form.Item>
          <Form.Item name="links" label="Links" style={{ width: 540, marginBottom: 0 }}>
            <Select mode="tags" placeholder="Type and press Enter" />
          </Form.Item>
        </Space>
        <Form.Item name="summary" label="Summary" style={{ marginTop: 12, marginBottom: 0 }}>
          <Input.TextArea rows={4} />
        </Form.Item>
      </Card>

      <Card size="small" title="Skills & certifications" style={{ marginBottom: 16 }}>
        <Form.Item name="skills" label="Skills" style={{ marginBottom: 12 }}>
          <Select mode="tags" placeholder="Type and press Enter" />
        </Form.Item>
        <Form.Item name="certifications" label="Certifications" style={{ marginBottom: 0 }}>
          <Select mode="tags" placeholder="Type and press Enter" />
        </Form.Item>
      </Card>

      <Repeater
        name="languages"
        title="Languages"
        addLabel="Add language"
        blank={{ language: "", level: "" }}
        renderItem={i => (
          <>
            <Form.Item name={[i, "language"]} label="Language" style={fieldWidth}>
              <Input />
            </Form.Item>
            <Form.Item name={[i, "level"]} label="Level" style={fieldWidth}>
              <Input placeholder="e.g. C1" />
            </Form.Item>
          </>
        )}
      />

      <Repeater
        name="experience"
        title="Experience"
        addLabel="Add experience"
        blank={{ company: "", title: "", highlights: [] }}
        renderItem={i => (
          <>
            <Form.Item name={[i, "company"]} label="Company" style={fieldWidth}>
              <Input />
            </Form.Item>
            <Form.Item name={[i, "title"]} label="Title" style={fieldWidth}>
              <Input />
            </Form.Item>
            <Form.Item name={[i, "location"]} label="Location" style={fieldWidth}>
              <Input />
            </Form.Item>
            <Form.Item name={[i, "start"]} label="Start" style={fieldWidth} extra="YYYY-MM or YYYY">
              <Input />
            </Form.Item>
            <Form.Item name={[i, "end"]} label="End" style={fieldWidth} extra="Empty if ongoing">
              <Input />
            </Form.Item>
            <Form.Item name={[i, "description"]} label="Description" style={{ width: 540, marginBottom: 0 }}>
              <Input.TextArea rows={3} />
            </Form.Item>
            <Form.Item name={[i, "highlights"]} label="Highlights" style={{ width: 540, marginBottom: 0 }}>
              <Select mode="tags" placeholder="Type and press Enter" />
            </Form.Item>
          </>
        )}
      />

      <Repeater
        name="education"
        title="Education"
        addLabel="Add education"
        blank={{ institution: "", degree: null, field: null }}
        renderItem={i => (
          <>
            <Form.Item name={[i, "institution"]} label="Institution" style={fieldWidth}>
              <Input />
            </Form.Item>
            <Form.Item name={[i, "degree"]} label="Degree" style={fieldWidth}>
              <Input />
            </Form.Item>
            <Form.Item name={[i, "field"]} label="Field" style={fieldWidth}>
              <Input />
            </Form.Item>
            <Form.Item name={[i, "start"]} label="Start" style={fieldWidth}>
              <Input />
            </Form.Item>
            <Form.Item name={[i, "end"]} label="End" style={fieldWidth}>
              <Input />
            </Form.Item>
            <Form.Item name={[i, "details"]} label="Details" style={{ width: 540, marginBottom: 0 }}>
              <Input.TextArea rows={2} />
            </Form.Item>
          </>
        )}
      />

      <Repeater
        name="projects"
        title="Projects"
        addLabel="Add project"
        blank={{ name: "" }}
        renderItem={i => (
          <>
            <Form.Item name={[i, "name"]} label="Name" style={fieldWidth}>
              <Input />
            </Form.Item>
            <Form.Item name={[i, "link"]} label="Link" style={fieldWidth}>
              <Input />
            </Form.Item>
            <Form.Item name={[i, "description"]} label="Description" style={{ width: 540, marginBottom: 0 }}>
              <Input.TextArea rows={2} />
            </Form.Item>
          </>
        )}
      />

      <Card size="small" title="Preferences" style={{ marginBottom: 16 }}>
        <Space wrap align="start">
          <Form.Item name={["preferences", "desired_roles"]} label="Desired roles" style={{ width: 540, marginBottom: 0 }}>
            <Select mode="tags" placeholder="Type and press Enter" />
          </Form.Item>
          <Form.Item name={["preferences", "locations"]} label="Locations" style={{ width: 540, marginBottom: 0 }}>
            <Select mode="tags" placeholder="Type and press Enter" />
          </Form.Item>
          <Form.Item name={["preferences", "remote"]} label="Remote" style={fieldWidth}>
            <Input placeholder="e.g. hybrid, full" />
          </Form.Item>
          <Form.Item name={["preferences", "salary_expectation"]} label="Salary expectation" style={fieldWidth}>
            <Input />
          </Form.Item>
          <Form.Item name={["preferences", "notes"]} label="Notes" style={{ width: 540, marginBottom: 0 }}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Space>
      </Card>

      <Button type="primary" htmlType="submit" icon={<SaveOutlined />}>
        Save profile
      </Button>
    </Form>
  );
}
