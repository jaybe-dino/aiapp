import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { registerRoutes } from "./routes.js";
import { registerAdminRoutes } from "./admin.routes.js";
import { seed } from "./db/seed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  seed(); // 첫 기동 시 데모 데이터 보장(멱등)

  const app = Fastify({
    // 로그 PII 마스킹: 토큰·서명·연락처 등 민감 헤더를 남기지 않는다(기획안 불변조건 10).
    logger: {
      level: "info",
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers["x-admin-token"]',
          'req.headers["x-signature"]',
          'req.headers["x-user-id"]',
          'req.headers.cookie',
        ],
        censor: "[redacted]",
      },
    },
    bodyLimit: 256 * 1024,
  });

  // JSON 파서를 raw body 보존형으로 교체(공급사 postback HMAC 검증에 원문 필요).
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    (req as any).rawBody = body as string;
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // CORS: 모바일 웹 빌드/별도 오리진 어드민을 위해 허용(MVP는 permissive, 운영에선 화이트리스트).
  app.addHook("onRequest", async (req, reply) => {
    reply.header("Access-Control-Allow-Origin", req.headers.origin ?? "*");
    reply.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type,Idempotency-Key,x-user-id,x-admin-token");
    if (req.method === "OPTIONS") reply.code(204).send();
  });

  await app.register(fastifyStatic, {
    root: path.join(__dirname, "web"),
    prefix: "/",
  });
  // 운영자 콘솔 정적 파일 (/admin)
  await app.register(fastifyStatic, {
    root: path.join(__dirname, "web-admin"),
    prefix: "/admin/",
    decorateReply: false,
  });

  registerRoutes(app);
  registerAdminRoutes(app);

  await app.listen({ port: config.port, host: "0.0.0.0" });
  const mode = config.anthropicApiKey ? `Claude(${config.aiModelTier})` : "mock(키 없음)";
  console.log(`\n혜택AI MVP → http://localhost:${config.port}  |  AI: ${mode}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
