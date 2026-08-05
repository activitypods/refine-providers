import { useGetIdentity, useList } from "@refinedev/core";
import { Row, Col, Card, Avatar, Typography, Space } from "antd";
const { Text, Paragraph } = Typography;

type ProfileRecord = {
  id: string;
  "vcard:given-name"?: string;
  "vcard:photo"?: string;
};

export const DashboardPage: React.FC = () => {
  const { data: identity } = useGetIdentity<{
    id: string;
    name: string;
    avatar?: string;
  }>();

  // Fetched through the data provider (see the "profile" resource in src/providers.ts) rather
  // than the auth provider's getIdentity() shortcut, to exercise the Read access granted for
  // https://shapes.activitypods.org/shapetrees/as/Profile (see public/access-need-profile.json).
  const { result: profileResult } = useList<ProfileRecord>({
    resource: "profile",
    pagination: { mode: "off" },
  });
  const profile = profileResult?.data?.[0];

  return (
    <Row gutter={20}>
      <Col span={8}>
        <Card title="Identity" style={{ borderRadius: 15 }}>
          <Space align="center" direction="horizontal">
            <Avatar size="large" src={identity?.avatar} />
            <div>
              <Text strong>{identity?.name}</Text>
              <Paragraph type="secondary" copyable style={{ margin: 0, fontSize: 12 }}>
                {identity?.id}
              </Paragraph>
            </div>
          </Space>
        </Card>
      </Col>
      <Col span={8}>
        <Card title="Profile (via data provider)" style={{ borderRadius: 15 }}>
          <Space align="center" direction="horizontal">
            <Avatar size="large" src={profile?.["vcard:photo"]} />
            <div>
              <Text strong>{profile?.["vcard:given-name"] || "—"}</Text>
              <Paragraph type="secondary" copyable style={{ margin: 0, fontSize: 12 }}>
                {profile?.id}
              </Paragraph>
            </div>
          </Space>
        </Card>
      </Col>
    </Row>
  );
};
