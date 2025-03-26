// mcp-server/src/infra/mysqlTools.ts
import mysql from "mysql2/promise";
import { z } from "zod";
import { QueryArgsSchema, TableInfoArgsSchema, InsertArgsSchema, UpdateArgsSchema, DeleteArgsSchema, CreateTableArgsSchema } from "../types/schemas";
import { loadServerConfig } from "../common/config";

// 获取 MySQL 配置
const config = loadServerConfig();
console.log("MySQL Configuration:", config.mysql);

// 创建 MySQL 连接池
const pool = mysql.createPool({
  host: config.mysql?.host || "localhost",
  user: config.mysql?.user,
  password: config.mysql?.password,
  database: config.mysql?.database || "test_db",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 10000,
});

export const mysqlTools = {
  // 1. 执行 SQL 查询
  executeQuery: {
    name: "execute_query",
    description: "Execute a safe SQL query and return the results",
    inputSchema: QueryArgsSchema,
    handler: async ({ query, params }: z.infer<typeof QueryArgsSchema>) => {
      const connection = await pool.getConnection();
      console.log(`execute_query: ${query} params: ${params}`);
      try {
        const [rows] = await connection.execute(query, params || []);
        return { success: true, data: rows };
      } catch (error: any) {
        console.error("Query execution failed", { query, params, error });
        throw new Error(`Database error: ${error.message}`);
      } finally {
        connection.release();
      }
    },
  },

  // 2. 获取表元数据
  getTableSchema: {
    name: "get_table_schema",
    description: "Retrieve the metadata of a database table (columns, types, constraints, etc.)",
    inputSchema: TableInfoArgsSchema,
    handler: async ({ database, table }: z.infer<typeof TableInfoArgsSchema>) => {
      const connection = await pool.getConnection();
      console.log(`get_table_schema: ${database}.${table}`);
      try {
        const [rows] = await connection.query(
          `
          SELECT column_name, data_type, column_key, is_nullable
          FROM information_schema.columns
          WHERE table_schema = ? AND table_name = ?
        `,
          [database, table]
        );
        console.log(`get_table_schema result: data: ${JSON.stringify(rows)}`);
        return { success: true, data: rows };
      } catch (error: any) {
        console.error("Get table schema failed", { database, table, error });
        throw new Error(`Database error: ${error.message}`);
      } finally {
        connection.release();
      }
    },
  },

  // 3. 插入数据
  insertData: {
    name: "insert_data",
    description: "Insert data into a specific table",
    inputSchema: InsertArgsSchema,
    handler: async ({ table, data }: z.infer<typeof InsertArgsSchema>) => {
      const connection = await pool.getConnection();
      try {
        // 解析 data（假设 data 是 JSON 字符串）
        // const parsedData = JSON.parse(data);
        const columns = Object.keys(data);
        const values = Object.values(data);
        const placeholders = columns.map(() => "?").join(", ");
        const query = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`;
        console.log(`insert_data: ${query} values: ${values}`);
        const [result] = await connection.execute(query, values);
        return { success: true, affectedRows: (result as any).affectedRows };
      } catch (error: any) {
        console.error("Insert data failed", { table, data, error });
        throw new Error(`Database error: ${error.message}`);
      } finally {
        connection.release();
      }
    },
  },

  // 4. 更新数据
  updateData: {
    name: "update_data",
    description: "Update data in a specific table",
    inputSchema: UpdateArgsSchema,
    handler: async ({ table, data, condition, params }: z.infer<typeof UpdateArgsSchema>) => {
      const connection = await pool.getConnection();
      try {
        // 解析 data（假设 data 是 JSON 字符串）
        // const parsedData = JSON.parse(data);
        const columns = Object.keys(data);
        const values = Object.values(data);
        const setClause = columns.map((col) => `${col} = ?`).join(", ");
        const query = `UPDATE ${table} SET ${setClause} WHERE ${condition}`;
        const allParams = [...values, ...(params || [])];
        console.log(`update_data: ${query} params: ${allParams}`);
        const [result] = await connection.execute(query, allParams);
        return { success: true, affectedRows: (result as any).affectedRows };
      } catch (error: any) {
        console.error("Update data failed", { table, data, condition, params, error });
        throw new Error(`Database error: ${error.message}`);
      } finally {
        connection.release();
      }
    },
  },

  // 5. 删除数据
  deleteData: {
    name: "delete_data",
    description: "Delete data from a specific table",
    inputSchema: DeleteArgsSchema,
    handler: async ({ table, condition, params }: z.infer<typeof DeleteArgsSchema>) => {
      const connection = await pool.getConnection();
      try {
        const query = `DELETE FROM ${table} WHERE ${condition}`;
        console.log(`delete_data: ${query} params: ${params}`);
        const [result] = await connection.execute(query, params || []);
        return { success: true, affectedRows: (result as any).affectedRows };
      } catch (error: any) {
        console.error("Delete data failed", { table, condition, params, error });
        throw new Error(`Database error: ${error.message}`);
      } finally {
        connection.release();
      }
    },
  },

  // 6. 创建表
  createTable: {
    name: "create_table",
    description: "Create a new database table",
    inputSchema: CreateTableArgsSchema,
    handler: async ({ table, columns }: z.infer<typeof CreateTableArgsSchema>) => {
      const connection = await pool.getConnection();
      try {
        // 解析 columns（假设 columns 是 JSON 字符串）
        // const parsedColumns = JSON.parse(columns);
        const columnDefs = columns
          .map((col: { name: string; type: string; constraints?: string }) => {
            const constraints = col.constraints ? ` ${col.constraints}` : "";
            return `${col.name} ${col.type}${constraints}`;
          })
          .join(", ");
        const query = `CREATE TABLE IF NOT EXISTS ${table} (${columnDefs})`;
        console.log(`create_table: ${query}`);
        await connection.execute(query);
        return { success: true, message: `Table ${table} created successfully` };
      } catch (error: any) {
        console.error("Create table failed", { table, columns, error });
        throw new Error(`Database error: ${error.message}`);
      } finally {
        connection.release();
      }
    },
  },
};

export async function shutdownMySQL(): Promise<void> {
  console.log("Closing MySQL connection pool...");
  await pool.end();
  console.log("MySQL connection pool closed.");
}