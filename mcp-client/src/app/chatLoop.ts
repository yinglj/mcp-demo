// mcp-client/src/app/chatLoop.ts

import * as readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { QueryProcessor } from "../core/queryProcessor";
import { TemplateLister } from "../core/templateLister";

export async function chatLoop(queryProcessor: QueryProcessor, templateLister: TemplateLister): Promise<void> {
  const rl = readline.createInterface({ input, output });

  console.log("Enter your query (or type 'exit' to quit):");
  console.log("Special commands:");
  console.log("- 'list templates': List available templates on all servers");
  console.log("- 'list templates <server_name>': List templates on a specific server");

  while (true) {
    const query = await rl.question("> ");
    const trimmedQuery = query.trim();

    if (trimmedQuery.toLowerCase() === "exit") {
      break;
    }

    if (trimmedQuery.toLowerCase().startsWith("list templates")) {
      const parts = trimmedQuery.split(/\s+/);
      const serverName = parts.length > 2 ? parts[2] : undefined;
      const result = await templateLister.listTemplates(serverName);
      console.log(result);
      continue;
    }

    const result = await queryProcessor.processQuery(trimmedQuery);
    console.log(result);
  }

  rl.close();
}