import { List, useTable, EditButton, ShowButton, DeleteButton, CreateButton } from "@refinedev/antd";
import { useNavigation } from "@refinedev/core";
import { Table, Space, Typography } from "antd";
import type { Note } from "./types";

const shortenUri = (uri: string) => {
  try {
    return decodeURIComponent(new URL(uri).pathname.split("/").pop() || uri);
  } catch {
    return uri;
  }
};

export const PostList = () => {
  const { tableProps } = useTable<Note>();
  const { show } = useNavigation();

  return (
    <List headerButtons={<CreateButton />}>
      <Table
        {...tableProps}
        rowKey="id"
        onRow={(record) => ({
          onClick: () => show("posts", record.id),
          style: { cursor: "pointer" },
        })}
      >
        <Table.Column dataIndex="id" title="ID" render={(id) => <Typography.Text code>{shortenUri(id)}</Typography.Text>} />
        <Table.Column dataIndex="name" title="Name" />
        <Table.Column<Note>
          title="Actions"
          dataIndex="actions"
          align="right"
          render={(_, record) => (
            <Space onClick={(e) => e.stopPropagation()}>
              <EditButton hideText size="small" recordItemId={record.id} />
              <ShowButton hideText size="small" recordItemId={record.id} />
              <DeleteButton hideText size="small" recordItemId={record.id} />
            </Space>
          )}
        />
      </Table>
    </List>
  );
};
