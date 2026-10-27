import test from "node:test";
import { runFixedCommand } from "./fixed-command.mjs";

test("MEIDS graph relation integration", async () => {
  await runFixedCommand("graphPromotions");
  await runFixedCommand("graphPostgresSchema");
  await runFixedCommand("azureSearchContracts");
});
