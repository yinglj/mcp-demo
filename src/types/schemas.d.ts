import { z } from "zod";

export const QueryArgsSchema = z.object({
  query: z.string().describe("需要执行的 SQL 查询语句"),
  params: z.array(z.unknown()).optional().describe("查询参数，用于防止 SQL 注入"),
});

export const TableInfoArgsSchema = z.object({
  database: z.string().describe("目标数据库名称"),
  table: z.string().describe("目标表名称"),
});

export const InsertArgsSchema = z.object({
  table: z.string().describe("目标表名"),
  data: z.record(z.unknown()).describe("要插入的数据对象"),
});

export const UpdateArgsSchema = z.object({
  table: z.string().describe("目标表名"),
  data: z.record(z.unknown()).describe("要更新的数据对象"),
  condition: z.string().describe("WHERE 条件，例如 'id = ?'"),
  params: z.array(z.unknown()).optional().describe("条件参数，用于防止 SQL 注入"),
});

export const DeleteArgsSchema = z.object({
  table: z.string().describe("目标表名"),
  condition: z.string().describe("WHERE 条件，例如 'id = ?'"),
  params: z.array(z.unknown()).optional().describe("条件参数，用于防止 SQL 注入"),
});

export const CreateTableArgsSchema = z.object({
  table: z.string().describe("要创建的表名"),
  columns: z
    .array(
      z.object({
        name: z.string().describe("列名"),
        type: z.string().describe("列类型，例如 'VARCHAR(255)' 或 'INT'"),
        constraints: z
          .string()
          .optional()
          .describe("列约束，例如 'NOT NULL' 或 'PRIMARY KEY'"),
      })
    )
    .describe("表列定义"),
});