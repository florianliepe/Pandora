import test from "node:test";
import { join } from "node:path";
import {
  playwrightEnvironment,
  runFixedCommand,
  targetRoot,
  withPrivateTempDirectory,
} from "./fixed-command.mjs";

test("MEIDS graph relation browser interaction", async () => {
  const root = await targetRoot();
  await withPrivateTempDirectory("pandora-meids-graph-", async (output) => {
    await runFixedCommand("graphBrowser", {
      args: [join(root, "frontend"), output],
      env: playwrightEnvironment("MEIDS_QA_PORT", 23000 + (process.pid % 1000)),
      timeout: 180000,
    });
  });
});
