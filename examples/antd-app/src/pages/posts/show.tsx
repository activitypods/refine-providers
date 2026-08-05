import { useShow } from "@refinedev/core";
import { Show, MarkdownField } from "@refinedev/antd";
import { Typography } from "antd";
import type { Note } from "./types";

const { Title, Text } = Typography;

export const PostShow = () => {
  const { query: queryResult } = useShow<Note>();
  const { data, isLoading } = queryResult;
  const record = data?.data;

  return (
    <Show isLoading={isLoading}>
      <Title level={5}>Id</Title>
      <Text copyable>{record?.id}</Text>
      <Title level={5}>Name</Title>
      <Text>{record?.name}</Text>
      <Title level={5}>Content</Title>
      <MarkdownField value={record?.content} />
    </Show>
  );
};
