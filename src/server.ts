import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { registerRoutes } from "./routes.js";
import { seed } from "./db/seed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  seed(); // 첫 기동 시 데모 데이터 보장(멱등)

  const app = Fastify({ logger: { transport: undefined, level: "info" } });

  await app.register(fastifyStatic, {
    root: path.join(__dirname, "web"),
    prefix: "/",
  });

  registerRoutes(app);

  await app.listen({ port: config.port, host: "0.0.0.0" });
  const mode = config.anthropicApiKey ? `Claude(${config.aiModelTier})` : "mock(키 없음)";
  console.log(`\n혜택AI MVP → http://localhost:${config.port}  |  AI: ${mode}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
