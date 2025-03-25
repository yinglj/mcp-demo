// mcp-server/src/core/promptData.ts

import { GetPromptResult, ListPromptsResult } from "@modelcontextprotocol/sdk/types.js";
import { logger } from "../infra/logger";

interface PromptData {
  description: string;
  messages: Array<{ role: "user" | "assistant"; content: { type: "text"; text: string } }>;
  arguments: Array<{ name: string; description: string; required: boolean }>;
}

const PROMPTS: Record<string, PromptData> = {
  "execute-sql-query": {
    description: "A prompt for executing a SQL query on the database",
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: "Execute the following SQL query: {{query}} with parameters {{params}}",
        },
      },
    ],
    arguments: [
      {
        name: "query",
        description: "The SQL query to execute (e.g., 'SELECT * FROM users')",
        required: true,
      },
      {
        name: "params",
        description: "Optional parameters for the SQL query to prevent SQL injection",
        required: false,
      },
    ],
  },
  "get-table-schema": {
    description: "A prompt for retrieving the schema of a specific table in a database",
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: "Retrieve the schema of table {{table}} in database {{database}}",
        },
      },
    ],
    arguments: [
      {
        name: "database",
        description: "The name of the database (e.g., 'mysql')",
        required: true,
      },
      {
        name: "table",
        description: "The name of the table (e.g., 'user')",
        required: true,
      },
    ],
  },
  "insert-data": {
    description: "A prompt for inserting data into a specific table",
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: "Insert the following data into table {{table}}: {{data}}",
        },
      },
    ],
    arguments: [
      {
        name: "table",
        description: "The name of the table to insert data into (e.g., 'users')",
        required: true,
      },
      {
        name: "data",
        description: "The data to insert as a JSON object (e.g., '{\"name\": \"John\", \"age\": 30}')",
        required: true,
      },
    ],
  },
  "update-data": {
    description: "A prompt for updating data in a specific table",
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: "Update table {{table}} with data {{data}} where {{condition}} with parameters {{params}}",
        },
      },
    ],
    arguments: [
      {
        name: "table",
        description: "The name of the table to update (e.g., 'users')",
        required: true,
      },
      {
        name: "data",
        description: "The data to update as a JSON object (e.g., '{\"age\": 31}')",
        required: true,
      },
      {
        name: "condition",
        description: "The WHERE condition for the update (e.g., 'id = ?')",
        required: true,
      },
      {
        name: "params",
        description: "Optional parameters for the condition to prevent SQL injection",
        required: false,
      },
    ],
  },
  "delete-data": {
    description: "A prompt for deleting data from a specific table",
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: "Delete data from table {{table}} where {{condition}} with parameters {{params}}",
        },
      },
    ],
    arguments: [
      {
        name: "table",
        description: "The name of the table to delete data from (e.g., 'users')",
        required: true,
      },
      {
        name: "condition",
        description: "The WHERE condition for the deletion (e.g., 'id = ?')",
        required: true,
      },
      {
        name: "params",
        description: "Optional parameters for the condition to prevent SQL injection",
        required: false,
      },
    ],
  },
  "create-table": {
    description: "A prompt for creating a new table in the database",
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: "Create a new table named {{table}} with columns {{columns}}",
        },
      },
    ],
    arguments: [
      {
        name: "table",
        description: "The name of the table to create (e.g., 'employees')",
        required: true,
      },
      {
        name: "columns",
        description: "The columns definition as a JSON array (e.g., '[{\"name\": \"id\", \"type\": \"INT\", \"constraints\": \"PRIMARY KEY\"}]')",
        required: true,
      },
    ],
  },
};

export const getPromptHandler = async (name: string): Promise<GetPromptResult> => {
  logger.info("Getting prompt", { name });

  const prompt = PROMPTS[name];
  if (!prompt) {
    logger.warn("Prompt not found", { name });
    throw new Error(`Unknown prompt: ${name}`);
  }

  return {
    description: prompt.description,
    messages: prompt.messages,
  };
};

export const listPromptsHandler = async (): Promise<ListPromptsResult> => {
  logger.info("Listing prompts");
  return {
    prompts: Object.entries(PROMPTS).map(([name, prompt]) => ({
      name,
      description: prompt.description,
      arguments: prompt.arguments,
    })),
  };
};