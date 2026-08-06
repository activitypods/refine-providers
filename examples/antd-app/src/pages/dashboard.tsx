import { useGetIdentity } from "@refinedev/core";
import { Row, Col, Card, Avatar, Typography, Space } from "antd";
const { Text, Paragraph } = Typography;

export const DashboardPage: React.FC = () => {
  const { data: identity } = useGetIdentity<{
    id: string;
    name: string;
    avatar?: string;
  }>();

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
    </Row>
  );
};
