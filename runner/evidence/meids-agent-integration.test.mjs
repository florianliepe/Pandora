import test from "node:test";
import { runFixedCommand } from "./fixed-command.mjs";

test("MEIDS agent routing integration", async () => {
  await runFixedCommand("agentRuntimeHandoffs");
  await runFixedCommand("n8nAgentWorkflows");
});
