// mcp-server/src/types/schemas.ts
import { z } from "zod";

// 1. 执行 SQL 查询的输入 schema
export const QueryArgsSchema = z.object({
  query: z.string().min(1, "SQL query cannot be empty"),
  params: z.array(z.any()).optional(),
});

// 2. 获取表元数据的输入 schema
export const TableInfoArgsSchema = z.object({
  database: z.string().min(1, "Database name cannot be empty"),
  table: z.string().min(1, "Table name cannot be empty"),
});

// 3. 插入数据的输入 schema
export const InsertArgsSchema = z.object({
  table: z.string().min(1, "Table name cannot be empty"),
  data: z.record(z.any(), { message: "Data must be a key-value object" }),
});

// 4. 更新数据的输入 schema
export const UpdateArgsSchema = z.object({
  table: z.string().min(1, "Table name cannot be empty"),
  data: z.record(z.any(), { message: "Data must be a key-value object" }),
  condition: z.string().min(1, "Condition cannot be empty"),
  params: z.array(z.any()).optional(),
});

// 5. 删除数据的输入 schema
export const DeleteArgsSchema = z.object({
  table: z.string().min(1, "Table name cannot be empty"),
  condition: z.string().min(1, "Condition cannot be empty"),
  params: z.array(z.any()).optional(),
});

// 6. 创建表的输入 schema
export const CreateTableArgsSchema = z.object({
  table: z.string().min(1, "Table name cannot be empty"),
  columns: z.array(
    z.object({
      name: z.string().min(1, "Column name cannot be empty"),
      type: z.string().min(1, "Column type cannot be empty"),
      constraints: z.string().optional(),
    })
  ).min(1, "At least one column must be defined"),
});