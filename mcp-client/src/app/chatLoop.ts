// mcp-client/src/app/chatLoop.ts

import * as readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { QueryProcessor } from "../core/queryProcessor";
import { TemplateLister } from "../core/templateLister";

export async function chatLoop(queryProcessor: QueryProcessor, templateLister: TemplateLister): Promise<void> {
  const rl = readline.createInterface({ input, output });

  console.log("Enter your query (or type 'exit' to quit):");
  console.log("Special commands:");
  console.log("- 'list templates': List all templates on all servers");
  console.log("- 'list templates <server_name>': List all templates on a specific server");
  console.log("- 'list tools': List all tools on all servers");
  console.log("- 'list tools <server_name>': List tools on a specific server");
  console.log("- 'list prompts': List all prompts on all servers");
  console.log("- 'list prompts <server_name>': List prompts on a specific server");

  while (true) {
    const query = await rl.question("> ");
    const trimmedQuery = query.trim().toLowerCase();

    if (trimmedQuery === "exit") {
      break;
    }

    const parts = trimmedQuery.split(/\s+/);
    if (parts[0] === "list") {
      const serverName = parts.length > 2 ? parts[2] : undefined;
      let result: string;

      switch (parts[1]) {
        case "templates":
          result = await templateLister.listTemplates(serverName, "all");
          break;
        case "tools":
          result = await templateLister.listTemplates(serverName, "tools");
          break;
        case "prompts":
          result = await templateLister.listTemplates(serverName, "prompts");
          break;
        default:
          result = "Unknown command. Use 'list templates', 'list tools', or 'list prompts'.";
      }
      console.log(result);
      continue;
    }

    const result = await queryProcessor.processQuery(trimmedQuery);
    console.log(result);
  }

  rl.close();
}