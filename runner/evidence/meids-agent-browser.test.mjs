import test from "node:test";
import { join } from "node:path";
import {
  playwrightEnvironment,
  runFixedCommand,
  targetRoot,
  withPrivateTempDirectory,
} from "./fixed-command.mjs";

test("MEIDS agent routing browser interaction", async () => {
  const root = await targetRoot();
  await withPrivateTempDirectory("pandora-meids-agent-", async (output) => {
    await runFixedCommand("agentBrowser", {
      args: [join(root, "frontend"), output],
      env: playwrightEnvironment("MEIDS_CHAT_URL_QA_PORT", 24000 + (process.pid % 1000)),
      timeout: 180000,
    });
  });
});
