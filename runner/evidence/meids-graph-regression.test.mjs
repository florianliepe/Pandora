import test from "node:test";
import { runFixedCommand } from "./fixed-command.mjs";

test("MEIDS graph relation contract", async () => {
  await runFixedCommand("graphNodeDetail");
});
