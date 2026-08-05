import { Create, useForm } from "@refinedev/antd";
import { Form, Input } from "antd";
import MDEditor from "@uiw/react-md-editor";
import type { Note } from "./types";

export const PostCreate = () => {
  const { formProps, saveButtonProps } = useForm<Note>();

  return (
    <Create saveButtonProps={saveButtonProps}>
      <Form {...formProps} layout="vertical">
        <Form.Item label="Name" name="name" rules={[{ required: true }]}>
          <Input placeholder="Enter the post's name" />
        </Form.Item>

        <Form.Item label="Content" name="content">
          <MDEditor data-color-mode="light" />
        </Form.Item>
      </Form>
    </Create>
  );
};
