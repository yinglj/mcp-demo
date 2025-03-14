import mysql from "mysql2/promise";
import { QueryArgsSchema, TableInfoArgsSchema, InsertArgsSchema, UpdateArgsSchema, DeleteArgsSchema, CreateTableArgsSchema } from "../types/schemas";
import { z } from "zod";
import { logger } from "./logger";
import { config } from "./config";

// 使用配置模块中的值
logger.info("MySQL Configuration", config.mysql);

const pool = mysql.createPool({
  host: config.mysql.host,
  user: config.mysql.user,
  password: config.mysql.password,
  database: config.mysql.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 10000,
});

export const mysqlTools = {
  // 1. 执行 SQL 查询
  executeQuery: {
    name: "execute_query",
    description: "执行安全的 SQL 查询并返回结果",
    inputSchema: QueryArgsSchema,
    handler: async ({ query, params }: z.infer<typeof QueryArgsSchema>) => {
      const connection = await pool.getConnection();
      logger.info(`execute_query: ${query} params: ${params}`);
      try {
        const [rows] = await connection.execute(query, params || []);
        return { success: true, data: rows };
      } catch (error: any) {
        logger.error("Query execution failed", { query, params, error });
        throw new Error(`Database error: ${error.message}`);
      } finally {
        connection.release();
      }
    },
  },

  // 2. 获取表元数据
  getTableSchema: {
    name: "get_table_schema",
    description: "获取数据库表的元数据（列名、类型、约束等）",
    inputSchema: TableInfoArgsSchema,
    handler: async ({ database, table }: z.infer<typeof TableInfoArgsSchema>) => {
      const connection = await pool.getConnection();
      try {
        const [rows] = await connection.query(
          `
          SELECT column_name, data_type, column_key, is_nullable
          FROM information_schema.columns
          WHERE table_schema = ? AND table_name = ?
        `,
          [database, table]
        );
        return { success: true, data: rows };
      } catch (error: any) {
        logger.error("Get table schema failed", { database, table, error });
        throw new Error(`Database error: ${error.message}`);
      } finally {
        connection.release();
      }
    },
  },

  // 3. 插入数据
  insertData: {
    name: "insert_data",
    description: "向指定表中插入数据",
    inputSchema: InsertArgsSchema,
    handler: async ({ table, data }: z.infer<typeof InsertArgsSchema>) => {
      const connection = await pool.getConnection();
      try {
        const columns = Object.keys(data);
        const values = Object.values(data);
        const placeholders = columns.map(() => "?").join(", ");
        const query = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`;
        logger.info(`insert_data: ${query} values: ${values}`);
        const [result] = await connection.execute(query, values);
        return { success: true, affectedRows: (result as any).affectedRows };
      } catch (error: any) {
        logger.error("Insert data failed", { table, data, error });
        throw new Error(`Database error: ${error.message}`);
      } finally {
        connection.release();
      }
    },
  },

  // 4. 更新数据
  updateData: {
    name: "update_data",
    description: "更新指定表中的数据",
    inputSchema: UpdateArgsSchema,
    handler: async ({ table, data, condition, params }: z.infer<typeof UpdateArgsSchema>) => {
      const connection = await pool.getConnection();
      try {
        const columns = Object.keys(data);
        const values = Object.values(data);
        const setClause = columns.map((col) => `${col} = ?`).join(", ");
        const query = `UPDATE ${table} SET ${setClause} WHERE ${condition}`;
        const allParams = [...values, ...(params || [])];
        logger.info(`update_data: ${query} params: ${allParams}`);
        const [result] = await connection.execute(query, allParams);
        return { success: true, affectedRows: (result as any).affectedRows };
      } catch (error: any) {
        logger.error("Update data failed", { table, data, condition, params, error });
        throw new Error(`Database error: ${error.message}`);
      } finally {
        connection.release();
      }
    },
  },

  // 5. 删除数据
  deleteData: {
    name: "delete_data",
    description: "从指定表中删除数据",
    inputSchema: DeleteArgsSchema,
    handler: async ({ table, condition, params }: z.infer<typeof DeleteArgsSchema>) => {
      const connection = await pool.getConnection();
      try {
        const query = `DELETE FROM ${table} WHERE ${condition}`;
        logger.info(`delete_data: ${query} params: ${params}`);
        const [result] = await connection.execute(query, params || []);
        return { success: true, affectedRows: (result as any).affectedRows };
      } catch (error: any) {
        logger.error("Delete data failed", { table, condition, params, error });
        throw new Error(`Database error: ${error.message}`);
      } finally {
        connection.release();
      }
    },
  },

  // 6. 创建表
  createTable: {
    name: "create_table",
    description: "创建新的数据库表",
    inputSchema: CreateTableArgsSchema,
    handler: async ({ table, columns }: z.infer<typeof CreateTableArgsSchema>) => {
      const connection = await pool.getConnection();
      try {
        const columnDefs = columns
          .map((col) => {
            const constraints = col.constraints ? ` ${col.constraints}` : "";
            return `${col.name} ${col.type}${constraints}`;
          })
          .join(", ");
        const query = `CREATE TABLE IF NOT EXISTS ${table} (${columnDefs})`;
        logger.info(`create_table: ${query}`);
        await connection.execute(query);
        return { success: true, message: `Table ${table} created successfully` };
      } catch (error: any) {
        logger.error("Create table failed", { table, columns, error });
        throw new Error(`Database error: ${error.message}`);
      } finally {
        connection.release();
      }
    },
  },
};

export async function shutdownMySQL() {
  await pool.end();
}