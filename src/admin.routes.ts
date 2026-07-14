// 운영자 콘솔 API(기획안 17.4, 20장). 인증: x-admin-token 헤더 → admin_users.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ProblemError } from "./lib/problem.js";
import * as admin from "./modules/admin/admin.js";

function requireAdmin(req: FastifyRequest, roles?: admin.AdminUser["role"][]): admin.AdminUser {
  const token = req.headers["x-admin-token"] as string | undefined;
  let user: admin.AdminUser;
  try {
    user = admin.authAdmin(token);
  } catch {
    throw new ProblemError({ status: 401, code: "ADMIN_UNAUTHORIZED", title: "운영자 인증이 필요합니다." });
  }
  if (roles && !roles.includes(user.role) && user.role !== "owner") {
    throw new ProblemError({ status: 403, code: "ADMIN_FORBIDDEN", title: "이 작업에 대한 권한이 없습니다." });
  }
  return user;
}

export function registerAdminRoutes(app: FastifyInstance) {
  // 로그인(토큰 검증) — 콘솔이 역할/이름 표시에 사용
  app.post("/admin/v1/session", async (req) => {
    const u = requireAdmin(req);
    return { admin_id: u.admin_id, name: u.name, email: u.email, role: u.role };
  });

  app.get("/admin/v1/dashboard", async (req) => { requireAdmin(req); return admin.dashboard(); });

  // 공급사
  app.get("/admin/v1/suppliers", async (req) => { requireAdmin(req); return { suppliers: admin.listSuppliers() }; });
  app.post("/admin/v1/suppliers/:id/reward", async (req: FastifyRequest<{ Params: { id: string }; Body: { allowed: boolean } }>) => {
    const u = requireAdmin(req, ["ops"]);
    return admin.setSupplierReward(u.email, req.params.id, !!req.body?.allowed);
  });

  // 오퍼
  app.get("/admin/v1/offers", async (req) => { requireAdmin(req); return { offers: admin.listOffers() }; });
  app.post("/admin/v1/offers/:id/status", async (req: FastifyRequest<{ Params: { id: string }; Body: { status: "active" | "stopped" } }>) => {
    const u = requireAdmin(req, ["ops", "reviewer"]);
    return admin.setOfferStatus(u.email, req.params.id, req.body?.status ?? "stopped");
  });
  app.post("/admin/v1/offers/:id/versions", async (req: FastifyRequest<{ Params: { id: string }; Body: any }>) => {
    const u = requireAdmin(req, ["ops", "reviewer"]);
    return admin.addOfferVersion(u.email, req.params.id, req.body as any);
  });

  // 전환/대사
  app.get("/admin/v1/conversions", async (req: FastifyRequest<{ Querystring: { status?: string } }>) => {
    requireAdmin(req);
    return { conversions: admin.listConversions(req.query.status) };
  });
  app.post("/admin/v1/conversions/:id/attribute", async (req: FastifyRequest<{ Params: { id: string } }>) => {
    const u = requireAdmin(req, ["reviewer", "ops"]);
    return admin.attributeConversion(u.email, req.params.id);
  });
  app.post("/admin/v1/conversions/:id/reject", async (req: FastifyRequest<{ Params: { id: string }; Body: { reason?: string } }>) => {
    const u = requireAdmin(req, ["reviewer", "ops"]);
    return admin.rejectConversion(u.email, req.params.id, req.body?.reason ?? "부적격");
  });

  // 보상 상태 진행/취소
  app.post("/admin/v1/rewards/:id/advance", async (req: FastifyRequest<{ Params: { id: string } }>) => {
    const u = requireAdmin(req, ["reviewer", "ops", "finance"]);
    return admin.advanceReward(u.email, req.params.id);
  });
  app.post("/admin/v1/rewards/:id/reverse", async (req: FastifyRequest<{ Params: { id: string }; Body: { reason?: string } }>) => {
    const u = requireAdmin(req, ["reviewer", "ops", "finance"]);
    return admin.reverseReward(u.email, req.params.id, req.body?.reason ?? "취소");
  });

  // 이중 승인 수동조정
  app.get("/admin/v1/adjustments", async (req) => { requireAdmin(req); return { adjustments: admin.listAdjustments() }; });
  app.post("/admin/v1/adjustments", async (req: FastifyRequest<{ Body: any }>) => {
    const u = requireAdmin(req, ["ops", "reviewer", "finance"]);
    return admin.requestAdjustment(u, req.body as any);
  });
  app.post("/admin/v1/adjustments/:id/approve", async (req: FastifyRequest<{ Params: { id: string } }>) => {
    const u = requireAdmin(req, ["finance", "owner", "ops", "reviewer"]);
    return admin.approveAdjustment(u, req.params.id);
  });
  app.post("/admin/v1/adjustments/:id/reject", async (req: FastifyRequest<{ Params: { id: string }; Body: { reason?: string } }>) => {
    const u = requireAdmin(req, ["finance", "owner", "ops", "reviewer"]);
    return admin.rejectAdjustment(u, req.params.id, req.body?.reason ?? "반려");
  });

  // 지급/대사
  app.get("/admin/v1/payouts", async (req) => { requireAdmin(req); return { payouts: admin.listPayouts() }; });
  app.post("/admin/v1/payouts/:id/resolve", async (req: FastifyRequest<{ Params: { id: string }; Body: { resolve: "paid" | "reversed" } }>) => {
    const u = requireAdmin(req, ["finance", "ops"]);
    return admin.resolveUnknownPayout(u.email, req.params.id, req.body?.resolve ?? "reversed");
  });
  app.post("/admin/v1/reconciliation/run", async (req) => {
    const u = requireAdmin(req, ["finance", "ops"]);
    return admin.runReconciliation(u.email);
  });

  // 사용자/동의
  app.get("/admin/v1/users", async (req) => { requireAdmin(req); return { users: admin.listUsers() }; });
  app.get("/admin/v1/users/:id", async (req: FastifyRequest<{ Params: { id: string } }>) => { requireAdmin(req); return admin.userDetail(req.params.id); });

  // 원장/감사
  app.get("/admin/v1/ledger", async (req) => { requireAdmin(req); return { accounts: admin.ledgerAccounts() }; });
  app.get("/admin/v1/audit", async (req) => { requireAdmin(req); return { audit: admin.listAudit() }; });
}
