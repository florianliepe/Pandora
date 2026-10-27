import test from "node:test";
import { runFixedCommand } from "./fixed-command.mjs";

test("MEIDS agent routing contract", async () => {
  await runFixedCommand("actorTwinRouting");
});
