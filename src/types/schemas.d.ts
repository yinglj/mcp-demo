// src/types/schemas.d.ts
import { z } from "zod";

// 声明 QueryArgsSchema 的类型
export declare const QueryArgsSchema: z.ZodObject<{
  query: z.ZodString;
  params: z.ZodOptional<z.ZodArray<z.ZodUnknown>>;
}>;

// 声明 TableInfoArgsSchema 的类型
export declare const TableInfoArgsSchema: z.ZodObject<{
  database: z.ZodNumber;
  table: z.ZodString;
}>;

// 声明 InsertArgsSchema 的类型
export declare const InsertArgsSchema: z.ZodObject<{
  table: z.ZodString;
  data: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}>;

// 声明 UpdateArgsSchema 的类型
export declare const UpdateArgsSchema: z.ZodObject<{
  table: z.ZodString;
  data: z.ZodRecord<z.ZodString, z.ZodUnknown>;
  condition: z.ZodString;
  params: z.ZodOptional<z.ZodArray<z.ZodUnknown>>;
}>;

// 声明 DeleteArgsSchema 的类型
export declare const DeleteArgsSchema: z.ZodObject<{
  table: z.ZodString;
  condition: z.ZodString;
  params: z.ZodOptional<z.ZodArray<z.ZodUnknown>>;
}>;

// 声明 CreateTableArgsSchema 的类型
export declare const CreateTableArgsSchema: z.ZodObject<{
  table: z.ZodString;
  columns: z.ZodArray<
    z.ZodObject<{
      name: z.ZodString;
      type: z.ZodString;
      constraints: z.ZodOptional<z.ZodString>;
    }>
  >;
}>;